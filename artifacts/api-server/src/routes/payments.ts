import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, paymentsTable, tenantsTable, propertiesTable, generatedRentsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getUserPropertyIds } from "../lib/ownership";
import { logActivity } from "./activity-logs";
import { sendPushToUser, NOTIF_TYPES, formatAmount } from "../lib/push";

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
  res.json(results.map(r => formatPayment(r.payment, r.tenantName, r.propertyName, r.unitNumber)));
});

router.post("/payments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { tenantId, propertyId, amount, paymentDate, month, year, method, status, notes, generatedRentId } = req.body;
  if (!tenantId || !propertyId || !amount || !paymentDate || !month || !year || !method) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(403).json({ error: "Property not found" }); return; }

  const receiptNumber = generateReceiptNumber();
  const [payment] = await db.insert(paymentsTable).values({
    tenantId, propertyId, amount: String(amount), paymentDate,
    month, year, method, status: status ?? "paid", notes, receiptNumber,
    generatedRentId: generatedRentId ?? null,
  }).returning();

  if (generatedRentId != null) {
    const rentStatus = payment.status === "partial" ? "partial" : "paid";
    await db.update(generatedRentsTable)
      .set({ status: rentStatus, paymentId: payment.id })
      .where(eq(generatedRentsTable.id, generatedRentId));
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
  await logActivity({
    userId, userEmail: req.user!.email,
    action: "payment", entity: "payment", entityId: payment.id,
    description: `Payment of ₹${amount} recorded for ${tenant?.name ?? tenantId} (${receiptNumber})`,
    newData: { amount, method, receiptNumber, month, year },
    propertyId,
    ipAddress: req.ip,
  });

  // Fire-and-forget push notification — does not block the HTTP response
  void sendPushToUser({
    userId,
    tenantId: payment.tenantId,
    type: NOTIF_TYPES.PAYMENT_RECEIVED,
    billingPeriod: String(payment.id),
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

  // Header band
  doc.rect(0, 0, doc.page.width, 100).fill(navy);
  doc.fontSize(26).fillColor("#ffffff").font("Helvetica-Bold").text("RENT RECEIPT", 50, 30);
  doc.fontSize(10).fillColor(gold).font("Helvetica").text("Gemini Rent Manager", 50, 62);
  doc.fontSize(10).fillColor("#cccccc").text(`Receipt No: ${p.receiptNumber ?? "—"}`, 50, 78);

  // Gold accent line
  doc.rect(0, 100, doc.page.width, 4).fill(gold);

  // Body
  doc.fillColor("#333333").font("Helvetica").fontSize(11);
  const startY = 130;
  const col1 = 50;
  const col2 = 220;
  const lineH = 30;

  const rows: [string, string][] = [
    ["Tenant", row.tenantName ?? "—"],
    ["Property", row.propertyName ?? "—"],
    ["Unit No.", row.unitNumber ?? "—"],
    ["Period", `${monthName} ${p.year}`],
    ["Payment Date", formattedDate],
    ["Payment Mode", (p.method ?? "—").toUpperCase()],
    ["Status", (p.status ?? "paid").toUpperCase()],
  ];

  rows.forEach(([label, value], i) => {
    const y = startY + i * lineH;
    const bg = i % 2 === 0 ? light : "#ffffff";
    doc.rect(col1 - 10, y - 6, doc.page.width - 80, lineH).fill(bg);
    doc.fillColor(navy).font("Helvetica-Bold").text(label, col1, y);
    doc.fillColor("#333333").font("Helvetica").text(value, col2, y);
  });

  // Amount box
  const amtY = startY + rows.length * lineH + 20;
  doc.rect(col1 - 10, amtY, doc.page.width - 80, 54).fill(navy);
  doc.fontSize(13).fillColor(gold).font("Helvetica-Bold").text("AMOUNT PAID", col1, amtY + 10);
  doc.fontSize(22).fillColor("#ffffff").font("Helvetica-Bold")
    .text(`₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, col1, amtY + 26);

  // Notes
  if (p.notes) {
    doc.fillColor("#666666").font("Helvetica").fontSize(10)
      .text(`Notes: ${p.notes}`, col1, amtY + 80);
  }

  // Footer
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
  res.json(formatPayment(row.payment, row.tenantName, row.propertyName, row.unitNumber));
});

router.put("/payments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(paymentsTable)
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Payment not found" }); return; }

  const { amount, paymentDate, month, year, method, status, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (amount !== undefined) updates.amount = String(amount);
  if (paymentDate !== undefined) updates.paymentDate = paymentDate;
  if (month !== undefined) updates.month = month;
  if (year !== undefined) updates.year = year;
  if (method !== undefined) updates.method = method;
  if (status !== undefined) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  const [payment] = await db.update(paymentsTable).set(updates).where(eq(paymentsTable.id, id)).returning();
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, payment.tenantId));
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, payment.propertyId));
  res.json(formatPayment(payment, tenant?.name, property?.name, tenant?.unitNumber));
});

router.delete("/payments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId, tenantId: paymentsTable.tenantId, amount: paymentsTable.amount })
    .from(paymentsTable)
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(eq(paymentsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Payment not found" }); return; }
  await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
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
