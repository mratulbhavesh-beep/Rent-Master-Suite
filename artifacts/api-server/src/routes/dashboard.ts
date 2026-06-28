import { Router, type IRouter } from "express";
import { count, eq, sql, inArray } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, paymentsTable, maintenanceRequestsTable } from "@workspace/db";
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

router.get("/dashboard/summary", requireAuth, async (_req, res): Promise<void> => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [propertiesCount] = await db.select({ count: count() }).from(propertiesTable);
  const [pendingMaintenance] = await db.select({ count: count() }).from(maintenanceRequestsTable)
    .where(sql`${maintenanceRequestsTable.status} IN ('open', 'in_progress')`);

  // Active tenants with their rent amounts and lease start dates
  const activeTenants = await db
    .select({ id: tenantsTable.id, rentAmount: tenantsTable.rentAmount, leaseStart: tenantsTable.leaseStart })
    .from(tenantsTable)
    .where(eq(tenantsTable.status, "active"));

  // All payments for active tenants
  const activeTenantIds = activeTenants.map(t => t.id);
  const todayStr = now.toISOString().split("T")[0];
  const allPayments = activeTenantIds.length > 0
    ? await db.select({ tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year, paymentDate: paymentsTable.paymentDate })
        .from(paymentsTable)
        .where(inArray(paymentsTable.tenantId, activeTenantIds))
    : [];

  // Today's collection: sum of payments received today
  const todayCollection = allPayments
    .filter(p => p.paymentDate === todayStr)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  // Monthly income: sum of all payments received this month
  const monthlyIncome = allPayments
    .filter(p => p.month === currentMonth && p.year === currentYear)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  // Rent due this month: sum of all active tenant rents
  const rentDueThisMonth = activeTenants.reduce(
    (sum, t) => sum + parseFloat(String(t.rentAmount)), 0
  );

  // Total unpaid balance (Due): sum of (monthsElapsed × rent − totalPaid) for each active tenant
  const paymentsByTenant = new Map<number, number>();
  for (const p of allPayments) {
    paymentsByTenant.set(p.tenantId, (paymentsByTenant.get(p.tenantId) ?? 0) + parseFloat(String(p.amount)));
  }
  let totalDue = 0;
  for (const t of activeTenants) {
    const months = monthsElapsed(t.leaseStart);
    const expected = months * parseFloat(String(t.rentAmount));
    const paid = paymentsByTenant.get(t.id) ?? 0;
    const balance = Math.max(0, expected - paid);
    totalDue += balance;
  }

  res.json({
    totalProperties: propertiesCount.count,
    totalTenants: activeTenants.length,
    rentDueThisMonth,
    monthlyIncome,
    todayCollection,
    pendingMaintenance: pendingMaintenance.count,
    overdueRents: totalDue,
  });
});

export default router;
