import { Router, type IRouter } from "express";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, paymentsTable, maintenanceRequestsTable, rentAgreementsTable, tenantDocumentsTable, leaseRenewalsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

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
  const { name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd, rentAmount, status, emergencyContact, notes, securityDeposit, depositDate, depositStatus } = req.body;
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
  const [renewal] = await db.insert(leaseRenewalsTable).values({
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
    renewedBy: body.newRentAmount != null ? "manual" : (t.escalationApply ?? "manual"),
    notes: body.notes ?? null,
  }).returning();
  await db.update(tenantsTable).set({
    leaseStart: newLeaseStart,
    leaseEnd: newLeaseEnd,
    rentAmount: String(newRent),
  }).where(eq(tenantsTable.id, id));
  res.json({
    ...renewal,
    previousRent: parseFloat(String(renewal.previousRent)),
    newRent: parseFloat(String(renewal.newRent)),
    increaseAmount: parseFloat(String(renewal.increaseAmount)),
    increasePercent: parseFloat(String(renewal.increasePercent)),
    createdAt: renewal.createdAt.toISOString(),
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
  const deleted = await db.delete(tenantsTable).where(eq(tenantsTable.id, id)).returning();
  if (!deleted.length) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.sendStatus(204);
});

export default router;
