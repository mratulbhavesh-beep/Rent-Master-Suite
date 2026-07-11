import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, paymentsTable, tenantsTable, propertiesTable, generatedRentsTable, paymentAllocationsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getUserPropertyIds } from "../lib/ownership";
import { logActivity } from "./activity-logs";
import { sendPushToUser, NOTIF_TYPES, formatAmount } from "../lib/push";
import { ensureGeneratedRentForPeriod, recomputeGeneratedRentStatus } from "../lib/rent-generator";
import { allocatePaymentFIFO, allocateToSpecificPeriod, clearAllocations } from "../lib/payment-allocator";

const router: IRouter = Router();

function formatPayment(p: typeof paymentsTable.$inferSelect, tenantName?: string | null, propertyName?: string | null, unitNumber?: string | null) {
  return {
    ...p,
    amount: parseFloat(String(p.amount)),
    tenantName: tenantName ?? null,
    propertyName: propertyName ?? null,
    unitNumber: unitNumber ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

function generateReceiptNumber(): string {
  return `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
}

router.get("/payments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { tenantId, propertyId, month, status } = req.query as { tenantId?: string; propertyId?: string; month?: string; status?: string };

  const userPropertyIds = await getUserPropertyIds(userId);
  if (userPropertyIds.length === 0) { res.json([]); return; }

  const rows = await db
    .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name, unitNumber: tenantsTable.unitNumber })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(inArray(paymentsTable.propertyId, userPropertyIds));

  let results = rows;
  if (tenantId) results = results.filter(r => r.payment.tenantId === parseInt(tenantId, 10));
  if (propertyId) results = results.filter(r => r.payment.propertyId === parseInt(propertyId, 10));
  if (status) results = results.filter(r => r.payment.status === status);
  if (month) {
    if (month.includes("-")) {
      const [y, m] = month.split("-").map(Number);
      results = results.filter(r => r.payment.year === y && r.payment.month === m);
    } else {
      const m = parseInt(month, 10);
      results = results.filter(r => r.payment.month === m);
    }
  }

  const formatted = results.map(r => formatPayment(r.payment, r.tenantName, r.propertyName, r.unitNumber));
  if (formatted.length === 0) { res.json([]); return; }

  // Batch-fetch allocations for all returned payments (same shape as GET /payments/:id)
  const paymentIds = formatted.map(p => p.id);
  const allAllocs = await db
    .select({
      paymentId: paymentAllocationsTable.paymentId,
      generatedRentId: paymentAllocationsTable.generatedRentId,
      allocatedAmount: paymentAllocationsTable.allocatedAmount,
      billingPeriodStart: generatedRentsTable.billingPeriodStart,
      billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
    })
    .from(paymentAllocationsTable)
    .leftJoin(generatedRentsTable, eq(paymentAllocationsTable.generatedRentId, generatedRentsTable.id))
    .where(inArray(paymentAllocationsTable.paymentId, paymentIds));

  const allocsByPayment = new Map<number, typeof allAllocs>();
  for (const a of allAllocs) {
    if (!allocsByPayment.has(a.paymentId)) allocsByPayment.set(a.paymentId, []);
    allocsByPayment.get(a.paymentId)!.push(a);
  }

  res.json(formatted.map(p => ({
    ...p,
    allocations: (allocsByPayment.get(p.id) ?? []).map(a => ({
      generatedRentId: a.generatedRentId,
      allocatedAmount: parseFloat(String(a.allocatedAmount)),
      billingPeriodStart: a.billingPeriodStart ?? null,
      billingPeriodEnd: a.billingPeriodEnd ?? null,
    })),
  })));
});

router.post("/payments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const {
    tenantId, propertyId, amount, paymentDate, month, year, method, status, notes,
    generatedRentId,       // backward-compat field (old mobile path)
    allocationMode,        // "auto" | "specific"  (new path)
    targetGeneratedRentId, // used when allocationMode = "specific" and period already generated
  } = req.body;

  if (!tenantId || !propertyId || !amount || !paymentDate || !month || !year || !method) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(403).json({ error: "Property not found" }); return; }

  const numericAmount = parseFloat(String(amount));
  const receiptNumber = generateReceiptNumber();

  // ── ALLOCATION MODE ROUTING ──────────────────────────────────────────────
  //
  // A. allocationMode = "auto"  →  FIFO (oldest outstanding first)
  // B. allocationMode = "specific" + targetGeneratedRentId (generated period)
  //    →  Specific period allocation
  // C. allocationMode = "specific" + no targetGeneratedRentId
  //    →  ensureGeneratedRentForPeriod for month/year
  //       "early"  → Pending Adjustment (generatedRentId = null)
  //       null     → reject 400
  //       number   → specific allocation to that period
  // D. No allocationMode (backward-compat, old mobile path)
  //    →  existing logic: use generatedRentId from body or ensureGeneratedRentForPeriod
  //       then create one allocation row.
  //
  // ─────────────────────────────────────────────────────────────────────────

  if (allocationMode === "auto") {
    // ── A: FIFO ──────────────────────────────────────────────────────────
    const [payment] = await db.insert(paymentsTable).values({
      tenantId, propertyId, amount: String(numericAmount), paymentDate,
      month, year, method, status: status ?? "paid", notes, receiptNumber,
      generatedRentId: null,
    }).returning();

    const result = await allocatePaymentFIFO(db, payment.id, tenantId, numericAmount);

    // Update primary pointer on the payment row
    if (result.firstGeneratedRentId !== null) {
      await db.update(paymentsTable)
        .set({ generatedRentId: result.firstGeneratedRentId })
        .where(eq(paymentsTable.id, payment.id));
      payment.generatedRentId = result.firstGeneratedRentId;
    }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
    await logActivity({
      userId, userEmail: req.user!.email,
      action: "payment", entity: "payment", entityId: payment.id,
      description: `Payment of ₹${numericAmount} recorded for ${tenant?.name ?? tenantId} (${receiptNumber}) — Auto FIFO, allocated to ${result.allocatedPeriods.length} period(s)`,
      newData: { amount: numericAmount, method, receiptNumber, allocationMode: "auto", allocatedPeriods: result.allocatedPeriods },
      propertyId, ipAddress: req.ip,
    });
    void sendPushToUser({
      userId, tenantId: payment.tenantId,
      type: NOTIF_TYPES.PAYMENT_RECEIVED, billingPeriod: String(payment.id),
      title: "Payment Received",
      body: `${tenant?.name ?? "Tenant"} paid ${formatAmount(payment.amount)}\n${property.name}${tenant?.unitNumber ? ` • ${tenant.unitNumber}` : ""}`,
      data: { propertyName: property.name, unitNumber: tenant?.unitNumber ?? "" },
    }).catch(() => {});
    res.status(201).json(formatPayment(payment, tenant?.name, property.name, tenant?.unitNumber));
    return;
  }

  if (allocationMode === "specific") {
    // ── B / C: Specific period ────────────────────────────────────────────
    let resolvedRentId: number | null;

    if (targetGeneratedRentId != null) {
      // B: targeting an already-generated period
      const [rentRow] = await db
        .select({ tenantId: generatedRentsTable.tenantId })
        .from(generatedRentsTable)
        .where(eq(generatedRentsTable.id, targetGeneratedRentId));
      if (!rentRow || rentRow.tenantId !== tenantId) {
        res.status(400).json({ error: "targetGeneratedRentId does not belong to this tenant" });
        return;
      }
      resolvedRentId = targetGeneratedRentId;
    } else {
      // C: targeting an ungenerated post-paid period (Pending Adjustment path)
      const ensureResult = await ensureGeneratedRentForPeriod(tenantId, month, year);
      if (ensureResult === null) {
        res.status(400).json({ error: "No billable period exists for that month — check the payment's month/year against the tenant's lease" });
        return;
      }
      resolvedRentId = ensureResult === "early" ? null : ensureResult;
    }

    const [payment] = await db.insert(paymentsTable).values({
      tenantId, propertyId, amount: String(numericAmount), paymentDate,
      month, year, method, status: status ?? "paid", notes, receiptNumber,
      generatedRentId: resolvedRentId,
    }).returning();

    if (resolvedRentId !== null) {
      await allocateToSpecificPeriod(db, payment.id, resolvedRentId, numericAmount);
    }

    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
    await logActivity({
      userId, userEmail: req.user!.email,
      action: "payment", entity: "payment", entityId: payment.id,
      description: `Payment of ₹${numericAmount} recorded for ${tenant?.name ?? tenantId} (${receiptNumber}) — Specific period${resolvedRentId ? ` #${resolvedRentId}` : " (Pending Adjustment)"}`,
      newData: { amount: numericAmount, method, receiptNumber, allocationMode: "specific", resolvedRentId },
      propertyId, ipAddress: req.ip,
    });
    void sendPushToUser({
      userId, tenantId: payment.tenantId,
      type: NOTIF_TYPES.PAYMENT_RECEIVED, billingPeriod: String(payment.id),
      title: "Payment Received",
      body: `${tenant?.name ?? "Tenant"} paid ${formatAmount(payment.amount)}\n${property.name}${tenant?.unitNumber ? ` • ${tenant.unitNumber}` : ""}`,
      data: { propertyName: property.name, unitNumber: tenant?.unitNumber ?? "" },
    }).catch(() => {});
    res.status(201).json(formatPayment(payment, tenant?.name, property.name, tenant?.unitNumber));
    return;
  }

  // ── D: Backward-compat path (no allocationMode) ──────────────────────────
  // Preserves the exact existing behavior: if generatedRentId is supplied use
  // it directly; otherwise resolve via ensureGeneratedRentForPeriod. Then
  // create one payment_allocations row (so recomputeGeneratedRentStatus reads
  // allocations correctly post-Phase-2).
  if (generatedRentId != null) {
    const [rentRow] = await db
      .select({ tenantId: generatedRentsTable.tenantId })
      .from(generatedRentsTable)
      .where(eq(generatedRentsTable.id, generatedRentId));
    if (!rentRow || rentRow.tenantId !== tenantId) {
      res.status(400).json({ error: "generatedRentId does not belong to this tenant" });
      return;
    }
  }

  const ensureResult =
    generatedRentId != null
      ? generatedRentId
      : await ensureGeneratedRentForPeriod(tenantId, month, year);

  if (ensureResult === null) {
    res.status(400).json({ error: "No billable period exists for that month — check the payment's month/year against the tenant's lease" });
    return;
  }

  const resolvedRentId: number | null = ensureResult === "early" ? null : ensureResult;

  const [payment] = await db.insert(paymentsTable).values({
    tenantId, propertyId, amount: String(numericAmount), paymentDate,
    month, year, method, status: status ?? "paid", notes, receiptNumber,
    generatedRentId: resolvedRentId,
  }).returning();

  // Create one allocation row so recomputeGeneratedRentStatus (which now
  // reads payment_allocations) correctly reflects this payment.
  if (resolvedRentId !== null) {
    await allocateToSpecificPeriod(db, payment.id, resolvedRentId, numericAmount);
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
  await logActivity({
    userId, userEmail: req.user!.email,
    action: "payment", entity: "payment", entityId: payment.id,
    description: `Payment of ₹${numericAmount} recorded for ${tenant?.name ?? tenantId} (${receiptNumber})`,
    newData: { amount: numericAmount, method, receiptNumber, month, year },
    propertyId, ipAddress: req.ip,
  });
  void sendPushToUser({
    userId, tenantId: payment.tenantId,
    type: NOTIF_TYPES.PAYMENT_RECEIVED, billingPeriod: String(payment.id),
    title: "Payment Received",
    body: `${tenant?.name ?? "Tenant"} paid ${formatAmount(payment.amount)}\n${property.name}${tenant?.unitNumber ? ` • ${tenant.unitNumber}` : ""}`,
    data: { propertyName: property.name, unitNumber: tenant?.unitNumber ?? "" },
  }).catch(() => {});
  res.status(201).json(formatPayment(payment, tenant?.name, property.name, tenant?.unitNumber));
});

router.get("/payments/:id/receipt.pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [row] = await db
    .select({
      payment: paymentsTable,
      tenantName: tenantsTable.name,
      tenantPhone: tenantsTable.phone,
      propertyName: propertiesTable.name,
      unitNumber: tenantsTable.unitNumber,
      propertyUserId: propertiesTable.userId,
    })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));

  if (!row || row.propertyUserId !== userId) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  // Fetch allocation breakdown for multi-period receipts
  const allocationRows = await db
    .select({
      allocatedAmount: paymentAllocationsTable.allocatedAmount,
      billingPeriodStart: generatedRentsTable.billingPeriodStart,
      billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
      billingCycle: generatedRentsTable.billingCycle,
    })
    .from(paymentAllocationsTable)
    .leftJoin(generatedRentsTable, eq(paymentAllocationsTable.generatedRentId, generatedRentsTable.id))
    .where(eq(paymentAllocationsTable.paymentId, id));

  const p = row.payment;
  const amount = parseFloat(String(p.amount));
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthName = MONTHS[(p.month ?? 1) - 1] ?? "";
  const formattedDate = p.paymentDate
    ? new Date(p.paymentDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require("pdfkit") as typeof import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-${p.receiptNumber}.pdf"`);
  doc.pipe(res);

  const navy = "#0a2342";
  const gold = "#c8942a";
  const light = "#f5f7fa";

  doc.rect(0, 0, doc.page.width, 100).fill(navy);
  doc.fontSize(26).fillColor("#ffffff").font("Helvetica-Bold").text("RENT RECEIPT", 50, 30);
  doc.fontSize(10).fillColor(gold).font("Helvetica").text("Gemini Rent Manager", 50, 62);
  doc.fontSize(10).fillColor("#cccccc").text(`Receipt No: ${p.receiptNumber ?? "—"}`, 50, 78);
  doc.rect(0, 100, doc.page.width, 4).fill(gold);

  doc.fillColor("#333333").font("Helvetica").fontSize(11);
  const startY = 130;
  const col1 = 50;
  const col2 = 220;
  const lineH = 30;

  // Determine period display: single vs multi-period
  const isMultiPeriod = allocationRows.length > 1;
  const periodLabel = isMultiPeriod
    ? `${allocationRows.length} periods (see below)`
    : `${monthName} ${p.year}`;

  const infoRows: [string, string][] = [
    ["Tenant", row.tenantName ?? "—"],
    ["Property", row.propertyName ?? "—"],
    ["Unit No.", row.unitNumber ?? "—"],
    ["Period", periodLabel],
    ["Payment Date", formattedDate],
    ["Payment Mode", (p.method ?? "—").toUpperCase()],
    ["Status", (p.status ?? "paid").toUpperCase()],
  ];

  infoRows.forEach(([label, value], i) => {
    const y = startY + i * lineH;
    const bg = i % 2 === 0 ? light : "#ffffff";
    doc.rect(col1 - 10, y - 6, doc.page.width - 80, lineH).fill(bg);
    doc.fillColor(navy).font("Helvetica-Bold").text(label, col1, y);
    doc.fillColor("#333333").font("Helvetica").text(value, col2, y);
  });

  const amtY = startY + infoRows.length * lineH + 20;
  doc.rect(col1 - 10, amtY, doc.page.width - 80, 54).fill(navy);
  doc.fontSize(13).fillColor(gold).font("Helvetica-Bold").text("AMOUNT PAID", col1, amtY + 10);
  doc.fontSize(22).fillColor("#ffffff").font("Helvetica-Bold")
    .text(`₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, col1, amtY + 26);

  // Multi-period allocation breakdown
  if (isMultiPeriod) {
    let allocY = amtY + 70;
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(11).text("Allocation Breakdown:", col1, allocY);
    allocY += 18;
    for (const a of allocationRows) {
      const allocAmt = parseFloat(String(a.allocatedAmount));
      const pStart = a.billingPeriodStart ? new Date(a.billingPeriodStart + "T00:00:00Z") : null;
      const periodStr = pStart
        ? `${MONTHS[pStart.getUTCMonth()]} ${pStart.getUTCFullYear()}`
        : "—";
      doc.fillColor("#333333").font("Helvetica").fontSize(10)
        .text(`${periodStr}  →  ₹${allocAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, col1 + 10, allocY);
      allocY += 16;
    }
  }

  if (p.notes) {
    const notesY = amtY + (isMultiPeriod ? 70 + allocationRows.length * 16 + 20 : 80);
    doc.fillColor("#666666").font("Helvetica").fontSize(10).text(`Notes: ${p.notes}`, col1, notesY);
  }

  const footerY = doc.page.height - 80;
  doc.rect(0, footerY, doc.page.width, 80).fill(navy);
  doc.fillColor(gold).font("Helvetica-Bold").fontSize(10).text("Thank you for your payment!", col1, footerY + 14);
  doc.fillColor("#cccccc").font("Helvetica").fontSize(9)
    .text("This is a computer-generated receipt and does not require a physical signature.", col1, footerY + 32);
  doc.fillColor("#aaaaaa").fontSize(8)
    .text(`Generated: ${new Date().toLocaleString("en-IN")}`, col1, footerY + 50);

  doc.end();
});

router.get("/payments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name, unitNumber: tenantsTable.unitNumber, propertyUserId: propertiesTable.userId })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Payment not found" }); return; }

  // Include allocations for Timeline display
  const allocations = await db
    .select({
      generatedRentId: paymentAllocationsTable.generatedRentId,
      allocatedAmount: paymentAllocationsTable.allocatedAmount,
      billingPeriodStart: generatedRentsTable.billingPeriodStart,
      billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
    })
    .from(paymentAllocationsTable)
    .leftJoin(generatedRentsTable, eq(paymentAllocationsTable.generatedRentId, generatedRentsTable.id))
    .where(eq(paymentAllocationsTable.paymentId, id));

  res.json({
    ...formatPayment(row.payment, row.tenantName, row.propertyName, row.unitNumber),
    allocations: allocations.map(a => ({
      generatedRentId: a.generatedRentId,
      allocatedAmount: parseFloat(String(a.allocatedAmount)),
      billingPeriodStart: a.billingPeriodStart ?? null,
      billingPeriodEnd: a.billingPeriodEnd ?? null,
    })),
  });
});

router.put("/payments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db
    .select({
      propertyUserId: propertiesTable.userId,
      tenantId: paymentsTable.tenantId,
      month: paymentsTable.month,
      year: paymentsTable.year,
      generatedRentId: paymentsTable.generatedRentId,
      amount: paymentsTable.amount,
    })
    .from(paymentsTable)
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Payment not found" }); return; }

  const { amount, paymentDate, month, year, method, status, notes } = req.body;

  // Run the entire edit atomically: clear → update → re-allocate → recompute
  const result = await db.transaction(async (tx) => {
    // 1. Determine how many allocation rows existed (used to decide re-alloc strategy)
    const oldAllocations = await tx
      .select({ generatedRentId: paymentAllocationsTable.generatedRentId })
      .from(paymentAllocationsTable)
      .where(eq(paymentAllocationsTable.paymentId, id));
    const wasMultiPeriod = oldAllocations.length > 1;
    const oldGenRentIds = [...new Set(oldAllocations.map(a => a.generatedRentId))];

    // 2. Clear old allocations
    if (oldAllocations.length > 0) {
      await tx.delete(paymentAllocationsTable).where(eq(paymentAllocationsTable.paymentId, id));
    }

    // 3. Build update payload
    const updates: Record<string, unknown> = {};
    if (amount !== undefined) updates.amount = String(amount);
    if (paymentDate !== undefined) updates.paymentDate = paymentDate;
    if (month !== undefined) updates.month = month;
    if (year !== undefined) updates.year = year;
    if (method !== undefined) updates.method = method;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    // 4. If billing period changed, re-resolve the generatedRentId
    const newMonth = month !== undefined ? month : existing.month;
    const newYear = year !== undefined ? year : existing.year;
    const periodMoved = newMonth !== existing.month || newYear !== existing.year;
    if (periodMoved) {
      const newRentId = await ensureGeneratedRentForPeriod(existing.tenantId, newMonth, newYear, tx);
      if (newRentId === null) {
        throw new Error("No billable period exists for that month — check the payment's month/year against the tenant's lease");
      }
      updates.generatedRentId = newRentId === "early" ? null : newRentId;
    }

    // 5. Apply payment row update
    const [payment] = await tx.update(paymentsTable).set(updates).where(eq(paymentsTable.id, id)).returning();
    if (!payment) throw new Error("Payment not found after update");

    // 6. Re-allocate based on new state
    const newAmount = parseFloat(String(payment.amount));
    if (payment.generatedRentId !== null) {
      if (wasMultiPeriod && !periodMoved) {
        // Multi-period payment: re-run FIFO with new amount
        const fifoResult = await allocatePaymentFIFO(tx, payment.id, payment.tenantId, newAmount);
        if (fifoResult.firstGeneratedRentId !== null && fifoResult.firstGeneratedRentId !== payment.generatedRentId) {
          await tx.update(paymentsTable)
            .set({ generatedRentId: fifoResult.firstGeneratedRentId })
            .where(eq(paymentsTable.id, payment.id));
          payment.generatedRentId = fifoResult.firstGeneratedRentId;
        }
      } else {
        // Single-period: re-allocate full amount to the (possibly new) period
        await allocateToSpecificPeriod(tx, payment.id, payment.generatedRentId, newAmount);
      }
    }

    // 7. Recompute status on all affected periods (old ones that lost their allocation + new)
    const allAffectedIds = new Set([
      ...oldGenRentIds,
      ...(payment.generatedRentId != null ? [payment.generatedRentId] : []),
    ]);
    for (const pid of allAffectedIds) {
      await recomputeGeneratedRentStatus(pid, tx);
    }

    return payment;
  }).catch((err: Error) => {
    if (err.message.includes("No billable period")) {
      return { error: err.message } as { error: string };
    }
    throw err;
  });

  if ("error" in result) { res.status(400).json({ error: result.error }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, result.tenantId));
  const [property2] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, result.propertyId));
  res.json(formatPayment(result, tenant?.name, property2?.name, tenant?.unitNumber));
});

router.delete("/payments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId, tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, generatedRentId: paymentsTable.generatedRentId })
    .from(paymentsTable)
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Payment not found" }); return; }

  // Collect all period IDs that had allocations from this payment BEFORE deletion
  // so we can recompute their statuses after the cascade removes the allocation rows.
  const affectedPeriodIds = await clearAllocations(db, id);
  // Also include legacy generatedRentId (safety net for any backfill gap)
  if (existing.generatedRentId != null && !affectedPeriodIds.includes(existing.generatedRentId)) {
    affectedPeriodIds.push(existing.generatedRentId);
  }

  await db.delete(paymentsTable).where(eq(paymentsTable.id, id));

  // Recompute statuses of all previously-allocated periods now that the
  // payment (and its allocation rows via CASCADE) is gone.
  for (const pid of affectedPeriodIds) {
    await recomputeGeneratedRentStatus(pid);
  }

  await logActivity({
    userId, userEmail: req.user!.email,
    action: "delete", entity: "payment", entityId: id,
    description: `Payment #${id} deleted (₹${parseFloat(String(existing.amount))})`,
    oldData: { id, amount: existing.amount },
    ipAddress: req.ip,
  });
  res.sendStatus(204);
});

export default router;
