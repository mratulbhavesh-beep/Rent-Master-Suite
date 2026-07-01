import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, paymentsTable, maintenanceRequestsTable, rentAgreementsTable, tenantDocumentsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function monthsElapsed(leaseStart: string): number {
  const start = new Date(leaseStart);
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) + 1;
  return Math.max(1, months);
}

function computeBalance(
  tenant: typeof tenantsTable.$inferSelect,
  payments: { amount: string | number; month?: number | null; year?: number | null }[]
) {
  const months = monthsElapsed(tenant.leaseStart);
  const rentAmount = parseFloat(String(tenant.rentAmount));
  const totalExpected = months * rentAmount;
  const totalPaid = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
  const balanceDue = Math.max(0, totalExpected - totalPaid);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const thisMonthPaid = payments
    .filter(p => p.month === currentMonth && p.year === currentYear)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);
  const currentMonthDue = Math.max(0, rentAmount - thisMonthPaid);

  return { monthsElapsed: months, totalExpected, totalPaid, balanceDue, currentMonthDue };
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
  for (const key of ["name", "email", "phone", "propertyId", "unitNumber", "leaseStart", "leaseEnd", "status", "emergencyContact", "notes", "depositDate", "depositStatus"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.rentAmount !== undefined) updates.rentAmount = String(body.rentAmount);
  if (body.securityDeposit !== undefined) updates.securityDeposit = body.securityDeposit != null ? String(body.securityDeposit) : null;
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
