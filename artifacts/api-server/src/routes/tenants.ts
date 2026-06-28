import { Router, type IRouter } from "express";
import { eq, ilike, or, inArray } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, paymentsTable, maintenanceRequestsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** Months from leaseStart up to and including the current month (min 1) */
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
  payments: { amount: string | number }[] = []
) {
  return {
    ...t,
    rentAmount: parseFloat(String(t.rentAmount)),
    securityDeposit: t.securityDeposit != null ? parseFloat(String(t.securityDeposit)) : null,
    depositStatus: t.depositStatus ?? "held",
    propertyName: propertyName ?? null,
    createdAt: t.createdAt.toISOString(),
    ...computeBalance(t, payments),
  };
}

router.get("/tenants", requireAuth, async (req, res): Promise<void> => {
  const { search, propertyId } = req.query as { search?: string; propertyId?: string };
  const rows = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id));

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

  // Fetch all payments for these tenants in one query for balance calculation
  const tenantIds = results.map(r => r.tenant.id);
  const allPayments = tenantIds.length > 0
    ? await db.select({ tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
        .from(paymentsTable)
        .where(inArray(paymentsTable.tenantId, tenantIds))
    : [];

  const paymentsByTenant = new Map<number, { amount: string | number; month?: number | null; year?: number | null }[]>();
  for (const p of allPayments) {
    if (!paymentsByTenant.has(p.tenantId)) paymentsByTenant.set(p.tenantId, []);
    paymentsByTenant.get(p.tenantId)!.push({ amount: p.amount, month: p.month, year: p.year });
  }

  res.json(results.map(r =>
    formatTenant(r.tenant, r.propertyName, paymentsByTenant.get(r.tenant.id) ?? [])
  ));
});

router.post("/tenants", requireAuth, async (req, res): Promise<void> => {
  const { name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd, rentAmount, status, emergencyContact, notes, securityDeposit, depositDate, depositStatus } = req.body;
  if (!name || !email || !phone || !propertyId || !unitNumber || !leaseStart || !leaseEnd || !rentAmount) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [tenant] = await db.insert(tenantsTable).values({
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd,
    rentAmount: String(rentAmount), status: status ?? "active", emergencyContact, notes,
    securityDeposit: securityDeposit != null ? String(securityDeposit) : undefined,
    depositDate: depositDate ?? undefined,
    depositStatus: depositStatus ?? "held",
  }).returning();
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, tenant.propertyId));
  res.status(201).json(formatTenant(tenant, property?.name, []));
});

router.get("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row) { res.status(404).json({ error: "Tenant not found" }); return; }
  const payments = await db
    .select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year })
    .from(paymentsTable)
    .where(eq(paymentsTable.tenantId, id));
  res.json(formatTenant(row.tenant, row.propertyName, payments));
});

router.patch("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
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
  const payments = await db.select({ amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year }).from(paymentsTable).where(eq(paymentsTable.tenantId, id));
  res.json(formatTenant(tenant, property?.name, payments));
});

router.delete("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  // Cascade: delete FK-dependent records first to avoid constraint violations
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, id));
  await db.delete(maintenanceRequestsTable).where(eq(maintenanceRequestsTable.tenantId, id));
  const deleted = await db.delete(tenantsTable).where(eq(tenantsTable.id, id)).returning();
  if (!deleted.length) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.sendStatus(204);
});

export default router;
