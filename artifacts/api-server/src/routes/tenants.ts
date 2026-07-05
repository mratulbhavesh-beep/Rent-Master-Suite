import { Router, type IRouter } from "express";
import { and, eq, inArray, desc, gte, lte, lt, gt, asc, sql } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, paymentsTable, maintenanceRequestsTable, rentAgreementsTable, tenantDocumentsTable, leaseRenewalsTable, rentRevisionsTable, generatedRentsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function nextDayAfter(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

function periodsElapsed(leaseStart: string, billingCycle: string): number {
  const start = new Date(leaseStart);
  const now = new Date();

  if (billingCycle === "weekly") {
    const diffMs = now.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
  }

  const totalMonths =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) + 1;

  if (billingCycle === "quarterly") return Math.max(1, Math.ceil(totalMonths / 3));
  if (billingCycle === "yearly") return Math.max(1, Math.ceil(totalMonths / 12));
  return Math.max(1, totalMonths); // monthly
}

function computeBalance(
  tenant: typeof tenantsTable.$inferSelect,
  payments: { amount: string | number; month?: number | null; year?: number | null }[]
) {
  const billingCycle = tenant.billingCycle ?? "monthly";
  const periods = periodsElapsed(tenant.leaseStart, billingCycle);
  const rentAmount = parseFloat(String(tenant.rentAmount));
  const totalExpected = periods * rentAmount;
  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
  const balanceDue = Math.max(0, totalExpected - totalPaid);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const thisMonthPaid = payments
    .filter(p => p.month === currentMonth && p.year === currentYear)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);
  const currentMonthDue = Math.max(0, rentAmount - thisMonthPaid);

  return { monthsElapsed: periods, totalExpected, totalPaid, balanceDue, currentMonthDue };
}

function formatTenant(
  t: typeof tenantsTable.$inferSelect,
  propertyName: string | null | undefined,
  payments: { amount: string | number; month?: number | null; year?: number | null }[] = [],
  latestAgreement?: { endDate: string } | null
) {
  const today = new Date().toISOString().split("T")[0];
  return {
    ...t,
    rentAmount: parseFloat(String(t.rentAmount)),
    securityDeposit: t.securityDeposit != null ? parseFloat(String(t.securityDeposit)) : null,
    depositStatus: t.depositStatus ?? "held",
    propertyName: propertyName ?? null,
    createdAt: t.createdAt.toISOString(),
    ...computeBalance(t, payments),
    activeAgreementEndDate: latestAgreement?.endDate ?? null,
    activeAgreementStatus: latestAgreement
      ? (latestAgreement.endDate >= today ? "active" : "expired")
      : null,
  };
}

async function getUserPropertyIds(userId: number): Promise<number[]> {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  return props.map(p => p.id);
}

router.get("/tenants", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { search, propertyId, expiringIn30Days } = req.query as {
    search?: string;
    propertyId?: string;
    expiringIn30Days?: string;
  };

  const userPropertyIds = await getUserPropertyIds(userId);
  if (userPropertyIds.length === 0) { res.json([]); return; }

  const rows = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(inArray(tenantsTable.propertyId, userPropertyIds));

  let results = rows;
  if (propertyId) results = results.filter(r => r.tenant.propertyId === parseInt(propertyId, 10));
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(r =>
      r.tenant.name.toLowerCase().includes(s) ||
      r.tenant.email.toLowerCase().includes(s) ||
      r.tenant.phone.includes(s)
    );
  }

  const tenantIds = results.map(r => r.tenant.id);

  const allPayments = tenantIds.length > 0
    ? await db.select({ tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
        .from(paymentsTable).where(inArray(paymentsTable.tenantId, tenantIds))
    : [];

  const paymentsByTenant = new Map<number, { amount: string | number; month?: number | null; year?: number | null }[]>();
  for (const p of allPayments) {
    if (!paymentsByTenant.has(p.tenantId)) paymentsByTenant.set(p.tenantId, []);
    paymentsByTenant.get(p.tenantId)!.push({ amount: p.amount, month: p.month, year: p.year });
  }

  const allAgreements = tenantIds.length > 0
    ? await db.select({ tenantId: rentAgreementsTable.tenantId, endDate: rentAgreementsTable.endDate })
        .from(rentAgreementsTable)
        .where(inArray(rentAgreementsTable.tenantId, tenantIds))
    : [];

  const agreementByTenant = new Map<number, { endDate: string }>();
  for (const a of allAgreements) {
    const existing = agreementByTenant.get(a.tenantId);
    if (!existing || a.endDate > existing.endDate) {
      agreementByTenant.set(a.tenantId, { endDate: a.endDate });
    }
  }

  if (expiringIn30Days === "true") {
    const today = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    results = results.filter(r => {
      const agr = agreementByTenant.get(r.tenant.id);
      return agr && agr.endDate >= today && agr.endDate <= in30Days;
    });
  }

  res.json(results.map(r =>
    formatTenant(r.tenant, r.propertyName, paymentsByTenant.get(r.tenant.id) ?? [], agreementByTenant.get(r.tenant.id))
  ));
});

router.post("/tenants", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const {
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd, rentAmount, status,
    emergencyContact, notes, securityDeposit, depositDate, depositStatus,
    billingCycle, rentCollectionType, gracePeriodDays, useBusinessDefault,
    rentEscalation, escalationFrequencyYears, escalationType, escalationValue, escalationApply,
    autoRenewal, renewalDuration, customRenewalValue, customRenewalUnit, renewalNotice,
  } = req.body;
  if (!name || !email || !phone || !propertyId || !unitNumber || !leaseStart || !leaseEnd || !rentAmount) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(403).json({ error: "Property not found" }); return; }

  const [tenant] = await db.insert(tenantsTable).values({
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd,
    rentAmount: String(rentAmount), status: status ?? "active", emergencyContact, notes,
    securityDeposit: securityDeposit != null ? String(securityDeposit) : undefined,
    depositDate: depositDate ?? undefined,
    depositStatus: depositStatus ?? "held",
    billingCycle: billingCycle ?? "monthly",
    rentCollectionType: rentCollectionType ?? "post_paid",
    gracePeriodDays: gracePeriodDays ?? 5,
    useBusinessDefault: useBusinessDefault ?? true,
    rentEscalation: rentEscalation ?? false,
    escalationFrequencyYears: escalationFrequencyYears ?? undefined,
    escalationType: escalationType ?? undefined,
    escalationValue: escalationValue != null ? String(escalationValue) : undefined,
    escalationApply: escalationApply ?? undefined,
    autoRenewal: autoRenewal ?? false,
    renewalDuration: renewalDuration ?? undefined,
    customRenewalValue: customRenewalValue ?? undefined,
    customRenewalUnit: customRenewalUnit ?? undefined,
    renewalNotice: renewalNotice ?? undefined,
  }).returning();
  res.status(201).json(formatTenant(tenant, property.name, []));
});

router.get("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const payments = await db
    .select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
    .from(paymentsTable).where(eq(paymentsTable.tenantId, id));

  const agreements = await db
    .select({ endDate: rentAgreementsTable.endDate })
    .from(rentAgreementsTable)
    .where(eq(rentAgreementsTable.tenantId, id));
  const latestAgreement = agreements.length > 0
    ? agreements.reduce((best, a) => a.endDate > best.endDate ? a : best)
    : null;

  res.json(formatTenant(row.tenant, row.propertyName, payments, latestAgreement));
});

router.patch("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["name", "email", "phone", "propertyId", "unitNumber", "leaseStart", "leaseEnd", "status", "emergencyContact", "notes", "depositDate", "depositStatus",
    "billingCycle", "rentCollectionType", "gracePeriodDays", "useBusinessDefault",
    "autoRenewal", "renewalDuration", "customRenewalUnit", "rentEscalation",
    "escalationFrequencyYears", "escalationType", "escalationApply", "renewalNotice"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.rentAmount !== undefined) updates.rentAmount = String(body.rentAmount);
  if (body.securityDeposit !== undefined) updates.securityDeposit = body.securityDeposit != null ? String(body.securityDeposit) : null;
  if (body.escalationValue !== undefined) updates.escalationValue = String(body.escalationValue);
  if (body.customRenewalValue !== undefined) updates.customRenewalValue = body.customRenewalValue != null ? parseInt(String(body.customRenewalValue), 10) : null;
  const [tenant] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id)).returning();
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, tenant.propertyId));
  const payments = await db.select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
    .from(paymentsTable).where(eq(paymentsTable.tenantId, id));
  const agreements = await db.select({ endDate: rentAgreementsTable.endDate })
    .from(rentAgreementsTable).where(eq(rentAgreementsTable.tenantId, id));
  const latestAgreement = agreements.length > 0
    ? agreements.reduce((best, a) => a.endDate > best.endDate ? a : best)
    : null;
  res.json(formatTenant(tenant, property?.name, payments, latestAgreement));
});

router.get("/tenants/:id/renewals", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const renewals = await db.select().from(leaseRenewalsTable)
    .where(eq(leaseRenewalsTable.tenantId, id))
    .orderBy(desc(leaseRenewalsTable.createdAt));
  res.json(renewals.map(r => ({
    ...r,
    previousRent: parseFloat(String(r.previousRent)),
    newRent: parseFloat(String(r.newRent)),
    increaseAmount: parseFloat(String(r.increaseAmount)),
    increasePercent: parseFloat(String(r.increasePercent)),
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/tenants/:id/renew", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const t = row.tenant;
  const body = req.body as { newRentAmount?: number; notes?: string };
  const previousLeaseStart = t.leaseStart;
  const previousLeaseEnd = t.leaseEnd;
  const previousRent = parseFloat(String(t.rentAmount));

  const endDate = new Date(previousLeaseEnd + "T00:00:00");
  const newStart = new Date(endDate);
  newStart.setDate(newStart.getDate() + 1);
  const newEnd = new Date(newStart);

  const renewalMethod = t.renewalDuration ?? "same";
  if (renewalMethod === "custom" && t.customRenewalValue && t.customRenewalValue > 0) {
    const unit = t.customRenewalUnit ?? "months";
    if (unit === "years") newEnd.setFullYear(newEnd.getFullYear() + t.customRenewalValue);
    else newEnd.setMonth(newEnd.getMonth() + t.customRenewalValue);
  } else {
    // Same lease duration: compute original length in days and apply
    const origStart = new Date(previousLeaseStart + "T00:00:00");
    const origEnd = new Date(previousLeaseEnd + "T00:00:00");
    const origDays = Math.round((origEnd.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24));
    newEnd.setDate(newEnd.getDate() + origDays);
  }

  const newLeaseStart = newStart.toISOString().split("T")[0];
  const newLeaseEnd = newEnd.toISOString().split("T")[0];

  // Determine if rent escalation is due based on frequency
  const freqYears = t.escalationFrequencyYears ?? 1;
  const allRenewals = await db.select().from(leaseRenewalsTable)
    .where(eq(leaseRenewalsTable.tenantId, id))
    .orderBy(desc(leaseRenewalsTable.createdAt));

  // Find most recent escalation date; fall back to tenant's original leaseStart
  let lastEscalationDate: string | null = null;
  for (const r of allRenewals) {
    if (parseFloat(String(r.increaseAmount)) > 0) { lastEscalationDate = r.renewalDate; break; }
  }
  const originalLeaseStart = allRenewals.length > 0
    ? allRenewals[allRenewals.length - 1].previousLeaseStart
    : t.leaseStart;
  const referenceDate = lastEscalationDate ?? originalLeaseStart;
  const refMs = new Date(referenceDate + "T00:00:00").getTime();
  const todayMs = Date.now();
  const yearsSinceLastEscalation = (todayMs - refMs) / (1000 * 60 * 60 * 24 * 365.25);
  const escalationDue = yearsSinceLastEscalation >= freqYears;

  let newRent = previousRent;
  let increaseAmount = 0;
  let increasePercent = 0;

  if (body.newRentAmount != null && body.newRentAmount > 0) {
    newRent = body.newRentAmount;
    increaseAmount = newRent - previousRent;
    increasePercent = previousRent > 0 ? (increaseAmount / previousRent) * 100 : 0;
  } else if (t.rentEscalation && t.escalationApply === "automatic" && escalationDue) {
    const escalationType = t.escalationType ?? "percentage";
    const escalationValue = parseFloat(String(t.escalationValue ?? 0));
    if (escalationType === "percentage") {
      increaseAmount = previousRent * (escalationValue / 100);
      increasePercent = escalationValue;
      newRent = previousRent + increaseAmount;
    } else {
      increaseAmount = escalationValue;
      increasePercent = previousRent > 0 ? (escalationValue / previousRent) * 100 : 0;
      newRent = previousRent + increaseAmount;
    }
  }

  const renewalDate = new Date().toISOString().split("T")[0];
  const renewedBy = body.newRentAmount != null ? "manual" : (t.escalationApply ?? "manual");

  const renewal = await db.transaction(async (tx) => {
    const [ren] = await tx.insert(leaseRenewalsTable).values({
      tenantId: id,
      renewalDate,
      previousLeaseStart,
      previousLeaseEnd,
      newLeaseStart,
      newLeaseEnd,
      previousRent: String(previousRent),
      newRent: String(newRent),
      increaseAmount: String(increaseAmount),
      increasePercent: String(increasePercent),
      renewedBy,
      notes: body.notes ?? null,
    }).returning();

    await tx.update(tenantsTable).set({
      leaseStart: newLeaseStart,
      leaseEnd: newLeaseEnd,
      rentAmount: String(newRent),
    }).where(eq(tenantsTable.id, id));

    // Update future unpaid generated rents to the new rent amount
    if (newRent !== previousRent) {
      const today = renewalDate;
      await tx.update(generatedRentsTable)
        .set({ amount: String(newRent) })
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          gte(generatedRentsTable.billingPeriodStart, today),
          sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
        ));
    }

    return ren;
  });

  res.json({
    ...renewal,
    previousRent: parseFloat(String(renewal.previousRent)),
    newRent: parseFloat(String(renewal.newRent)),
    increaseAmount: parseFloat(String(renewal.increaseAmount)),
    increasePercent: parseFloat(String(renewal.increasePercent)),
    createdAt: renewal.createdAt.toISOString(),
  });
});

router.get("/tenants/:id/revisions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row || row.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  const revisions = await db.select().from(rentRevisionsTable)
    .where(eq(rentRevisionsTable.tenantId, id))
    .orderBy(desc(rentRevisionsTable.createdAt));
  res.json(revisions.map(r => ({
    ...r,
    previousRent: parseFloat(String(r.previousRent)),
    newRent: parseFloat(String(r.newRent)),
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/tenants/:id/revise", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as { newRent: number; effectiveFrom: string; reason?: string; currentRent?: number };
  if (!body.newRent || body.newRent <= 0) { res.status(400).json({ error: "newRent must be a positive number" }); return; }
  if (!body.effectiveFrom) { res.status(400).json({ error: "effectiveFrom is required (YYYY-MM-DD)" }); return; }

  let revision: typeof rentRevisionsTable.$inferSelect;

  try {
    revision = await db.transaction(async (tx) => {
      // Re-read tenant inside transaction for consistent snapshot
      const [row] = await tx
        .select({ tenant: tenantsTable })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, id));

      const t = row.tenant;

      // ── Concurrency guard ─────────────────────────────────────────────────
      // If the client sent the rent they were looking at, verify it hasn't changed.
      if (body.currentRent != null) {
        const actualRent = parseFloat(String(t.rentAmount));
        if (Math.abs(actualRent - body.currentRent) > 0.005) {
          throw Object.assign(new Error("STALE_RENT"), { code: "STALE_RENT" });
        }
      }

      // Validate: effectiveFrom must not be before lease start
      if (body.effectiveFrom < t.leaseStart) {
        throw Object.assign(
          new Error(`Effective date cannot be before the lease start date (${t.leaseStart})`),
          { code: "VALIDATION", statusCode: 400 }
        );
      }

      // Validate: no duplicate active effectiveFrom for this tenant
      const [dupCheck] = await tx
        .select({ id: rentRevisionsTable.id })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.effectiveFrom, body.effectiveFrom),
          eq(rentRevisionsTable.status, "active")
        ));
      if (dupCheck) {
        throw Object.assign(
          new Error("A revision already exists for this effective date. Use a different date."),
          { code: "VALIDATION", statusCode: 409 }
        );
      }

      // Determine previousRent: closest prior active revision, or current rent
      const [priorRevision] = await tx
        .select({ newRent: rentRevisionsTable.newRent })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          lt(rentRevisionsTable.effectiveFrom, body.effectiveFrom)
        ))
        .orderBy(desc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      const previousRent = priorRevision
        ? parseFloat(String(priorRevision.newRent))
        : parseFloat(String(t.rentAmount));

      const [rev] = await tx.insert(rentRevisionsTable).values({
        tenantId: id,
        previousRent: String(previousRent),
        newRent: String(body.newRent),
        effectiveFrom: body.effectiveFrom,
        reason: body.reason ?? null,
        changedBy: "manual",
      }).returning();

      const today = new Date().toISOString().split("T")[0];

      // Sync tenant.rentAmount if revision is effective today or in the past
      if (body.effectiveFrom <= today) {
        await tx.update(tenantsTable).set({ rentAmount: String(body.newRent) }).where(eq(tenantsTable.id, id));
      }

      // Period boundary: don't split an already-generated billing period
      const [overlappingPeriod] = await tx
        .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
        .from(generatedRentsTable)
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          lte(generatedRentsTable.billingPeriodStart, body.effectiveFrom),
          gte(generatedRentsTable.billingPeriodEnd, body.effectiveFrom)
        ))
        .limit(1);

      const updateFromDate = overlappingPeriod
        ? nextDayAfter(overlappingPeriod.billingPeriodEnd)
        : body.effectiveFrom;

      // Limit updates to the gap before the next active revision
      const [nextActiveRevision] = await tx
        .select({ effectiveFrom: rentRevisionsTable.effectiveFrom })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          gt(rentRevisionsTable.effectiveFrom, body.effectiveFrom)
        ))
        .orderBy(asc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      // Update unpaid future generated rents only — never touches paid or partial entries
      const updatedRents = await tx.update(generatedRentsTable)
        .set({ amount: String(body.newRent) })
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          gte(generatedRentsTable.billingPeriodStart, updateFromDate),
          nextActiveRevision ? lt(generatedRentsTable.billingPeriodStart, nextActiveRevision.effectiveFrom) : undefined,
          sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
        ))
        .returning({ id: generatedRentsTable.id });

      logger.info(
        { tenantId: id, effectiveFrom: body.effectiveFrom, newRent: body.newRent, updatedRentRows: updatedRents.length },
        "Manual revision applied — unpaid future rents updated"
      );

      return rev;
    });
  } catch (err: any) {
    if (err.code === "STALE_RENT") {
      res.status(409).json({ error: "This tenant's rent has been updated by another user. Please refresh and review the latest rent before creating a new revision." }); return;
    }
    if (err.code === "VALIDATION") {
      res.status(err.statusCode ?? 400).json({ error: err.message }); return;
    }
    throw err;
  }

  res.json({
    ...revision,
    previousRent: parseFloat(String(revision.previousRent)),
    newRent: parseFloat(String(revision.newRent)),
    createdAt: revision.createdAt.toISOString(),
  });
});

// ── Edit a pending (future) manual revision ───────────────────────────────
router.put("/tenants/:id/revisions/:revId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const revId = parseInt(Array.isArray(req.params.revId) ? req.params.revId[0] : req.params.revId, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const body = req.body as { newRent?: number; effectiveFrom?: string; reason?: string };
  const today = new Date().toISOString().split("T")[0];

  let updated: typeof rentRevisionsTable.$inferSelect;

  try {
    updated = await db.transaction(async (tx) => {
      // Re-read revision inside transaction for consistent snapshot
      const [revision] = await tx.select().from(rentRevisionsTable)
        .where(and(eq(rentRevisionsTable.id, revId), eq(rentRevisionsTable.tenantId, id)));
      if (!revision) throw Object.assign(new Error("Revision not found"), { code: "NOT_FOUND" });

      if (revision.effectiveFrom <= today) {
        throw Object.assign(new Error("This revision is already effective and cannot be edited."), { code: "CONFLICT" });
      }
      if (revision.status === "cancelled") {
        throw Object.assign(new Error("A cancelled revision cannot be edited."), { code: "CONFLICT" });
      }
      if (revision.changedBy !== "manual") {
        throw Object.assign(new Error("Automatic escalation entries cannot be edited manually."), { code: "CONFLICT" });
      }

      const newEffectiveFrom = body.effectiveFrom ?? revision.effectiveFrom;
      const newRentAmount = body.newRent != null ? body.newRent : parseFloat(String(revision.newRent));

      if (newRentAmount <= 0) throw Object.assign(new Error("newRent must be a positive number"), { code: "VALIDATION", statusCode: 400 });
      if (newEffectiveFrom < authRow.tenant.leaseStart) {
        throw Object.assign(
          new Error(`Effective date cannot be before the lease start date (${authRow.tenant.leaseStart})`),
          { code: "VALIDATION", statusCode: 400 }
        );
      }
      if (newEffectiveFrom <= today) {
        throw Object.assign(new Error("New effective date must be in the future."), { code: "VALIDATION", statusCode: 400 });
      }

      // Duplicate check (excluding self)
      if (newEffectiveFrom !== revision.effectiveFrom) {
        const [dupCheck] = await tx
          .select({ id: rentRevisionsTable.id })
          .from(rentRevisionsTable)
          .where(and(
            eq(rentRevisionsTable.tenantId, id),
            eq(rentRevisionsTable.effectiveFrom, newEffectiveFrom),
            eq(rentRevisionsTable.status, "active"),
            sql`${rentRevisionsTable.id} != ${revId}`
          ));
        if (dupCheck) {
          throw Object.assign(
            new Error("A revision already exists for this effective date. Use a different date."),
            { code: "VALIDATION", statusCode: 409 }
          );
        }
      }

      // Revert old effect: roll back unpaid rents in the gap this revision covered
      const [nextAfterOld] = await tx
        .select({ effectiveFrom: rentRevisionsTable.effectiveFrom })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          gt(rentRevisionsTable.effectiveFrom, revision.effectiveFrom),
          sql`${rentRevisionsTable.id} != ${revId}`
        ))
        .orderBy(asc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      const [oldOverlap] = await tx
        .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
        .from(generatedRentsTable)
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          lte(generatedRentsTable.billingPeriodStart, revision.effectiveFrom),
          gte(generatedRentsTable.billingPeriodEnd, revision.effectiveFrom)
        ))
        .limit(1);

      const oldUpdateFrom = oldOverlap ? nextDayAfter(oldOverlap.billingPeriodEnd) : revision.effectiveFrom;

      await tx.update(generatedRentsTable)
        .set({ amount: String(revision.previousRent) })
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          gte(generatedRentsTable.billingPeriodStart, oldUpdateFrom),
          nextAfterOld ? lt(generatedRentsTable.billingPeriodStart, nextAfterOld.effectiveFrom) : undefined,
          sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
        ));

      // Apply new effect with period boundary detection
      const [nextAfterNew] = await tx
        .select({ effectiveFrom: rentRevisionsTable.effectiveFrom })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          gt(rentRevisionsTable.effectiveFrom, newEffectiveFrom),
          sql`${rentRevisionsTable.id} != ${revId}`
        ))
        .orderBy(asc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      const [newOverlap] = await tx
        .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
        .from(generatedRentsTable)
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          lte(generatedRentsTable.billingPeriodStart, newEffectiveFrom),
          gte(generatedRentsTable.billingPeriodEnd, newEffectiveFrom)
        ))
        .limit(1);

      const newUpdateFrom = newOverlap ? nextDayAfter(newOverlap.billingPeriodEnd) : newEffectiveFrom;

      await tx.update(generatedRentsTable)
        .set({ amount: String(newRentAmount) })
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          gte(generatedRentsTable.billingPeriodStart, newUpdateFrom),
          nextAfterNew ? lt(generatedRentsTable.billingPeriodStart, nextAfterNew.effectiveFrom) : undefined,
          sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
        ));

      const [upd] = await tx.update(rentRevisionsTable)
        .set({
          newRent: String(newRentAmount),
          effectiveFrom: newEffectiveFrom,
          reason: body.reason !== undefined ? (body.reason || null) : revision.reason,
        })
        .where(eq(rentRevisionsTable.id, revId))
        .returning();

      logger.info({ tenantId: id, revId, newRentAmount, newEffectiveFrom }, "Rent revision edited");
      return upd;
    });
  } catch (err: any) {
    if (err.code === "NOT_FOUND") { res.status(404).json({ error: err.message }); return; }
    if (err.code === "CONFLICT") { res.status(409).json({ error: err.message }); return; }
    if (err.code === "VALIDATION") { res.status(err.statusCode ?? 400).json({ error: err.message }); return; }
    throw err;
  }

  res.json({
    ...updated,
    previousRent: parseFloat(String(updated.previousRent)),
    newRent: parseFloat(String(updated.newRent)),
    createdAt: updated.createdAt.toISOString(),
  });
});

// ── Cancel a pending (future) manual revision ─────────────────────────────
router.delete("/tenants/:id/revisions/:revId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const revId = parseInt(Array.isArray(req.params.revId) ? req.params.revId[0] : req.params.revId, 10);

  // Auth check (read-only, outside transaction)
  const [authRow] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!authRow || authRow.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }

  const today = new Date().toISOString().split("T")[0];
  let cancelled: typeof rentRevisionsTable.$inferSelect;

  try {
    cancelled = await db.transaction(async (tx) => {
      // Re-read revision inside transaction for consistent snapshot
      const [revision] = await tx.select().from(rentRevisionsTable)
        .where(and(eq(rentRevisionsTable.id, revId), eq(rentRevisionsTable.tenantId, id)));
      if (!revision) throw Object.assign(new Error("Revision not found"), { code: "NOT_FOUND" });

      if (revision.effectiveFrom <= today) {
        throw Object.assign(new Error("This revision is already effective and cannot be cancelled."), { code: "CONFLICT" });
      }
      if (revision.status === "cancelled") {
        throw Object.assign(new Error("This revision is already cancelled."), { code: "CONFLICT" });
      }
      if (revision.changedBy !== "manual") {
        throw Object.assign(new Error("Automatic escalation entries cannot be cancelled manually."), { code: "CONFLICT" });
      }

      // Find the next active revision to bound the revert range
      const [nextRevision] = await tx
        .select({ effectiveFrom: rentRevisionsTable.effectiveFrom })
        .from(rentRevisionsTable)
        .where(and(
          eq(rentRevisionsTable.tenantId, id),
          eq(rentRevisionsTable.status, "active"),
          gt(rentRevisionsTable.effectiveFrom, revision.effectiveFrom)
        ))
        .orderBy(asc(rentRevisionsTable.effectiveFrom))
        .limit(1);

      // Period boundary: if effectiveFrom falls inside a generated period, revert starts at next period
      const [overlapPeriod] = await tx
        .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
        .from(generatedRentsTable)
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          lte(generatedRentsTable.billingPeriodStart, revision.effectiveFrom),
          gte(generatedRentsTable.billingPeriodEnd, revision.effectiveFrom)
        ))
        .limit(1);

      const revertFromDate = overlapPeriod ? nextDayAfter(overlapPeriod.billingPeriodEnd) : revision.effectiveFrom;

      // Revert unpaid rents back to previousRent — never touches paid or partial entries
      await tx.update(generatedRentsTable)
        .set({ amount: String(revision.previousRent) })
        .where(and(
          eq(generatedRentsTable.tenantId, id),
          gte(generatedRentsTable.billingPeriodStart, revertFromDate),
          nextRevision ? lt(generatedRentsTable.billingPeriodStart, nextRevision.effectiveFrom) : undefined,
          sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
        ));

      // Soft-cancel: preserve the audit trail
      const [can] = await tx.update(rentRevisionsTable)
        .set({ status: "cancelled" })
        .where(eq(rentRevisionsTable.id, revId))
        .returning();

      logger.info({ tenantId: id, revId, revertFromDate }, "Rent revision cancelled — unpaid rents reverted to previousRent");
      return can;
    });
  } catch (err: any) {
    if (err.code === "NOT_FOUND") { res.status(404).json({ error: err.message }); return; }
    if (err.code === "CONFLICT") { res.status(409).json({ error: err.message }); return; }
    throw err;
  }

  res.json({
    ...cancelled,
    previousRent: parseFloat(String(cancelled.previousRent)),
    newRent: parseFloat(String(cancelled.newRent)),
    createdAt: cancelled.createdAt.toISOString(),
  });
});

router.delete("/tenants/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!existing || existing.propertyUserId !== userId) { res.status(404).json({ error: "Tenant not found" }); return; }
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, id));
  await db.delete(maintenanceRequestsTable).where(eq(maintenanceRequestsTable.tenantId, id));
  await db.delete(rentAgreementsTable).where(eq(rentAgreementsTable.tenantId, id));
  await db.delete(tenantDocumentsTable).where(eq(tenantDocumentsTable.tenantId, id));
  await db.delete(rentRevisionsTable).where(eq(rentRevisionsTable.tenantId, id));
  const deleted = await db.delete(tenantsTable).where(eq(tenantsTable.id, id)).returning();
  if (!deleted.length) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.sendStatus(204);
});

export default router;
