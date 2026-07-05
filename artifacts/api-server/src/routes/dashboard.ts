import { Router, type IRouter } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, paymentsTable, maintenanceRequestsTable } from "@workspace/db";
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

router.get("/dashboard/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const userProperties = await db
    .select({ id: propertiesTable.id, totalUnits: propertiesTable.totalUnits })
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));

  const userPropertyIds = userProperties.map(p => p.id);
  const totalProperties = userProperties.length;
  const propTotalUnits = userProperties.reduce((s, p) => s + p.totalUnits, 0);

  const pendingMaintenanceCount = userPropertyIds.length > 0
    ? (await db.select({ count: sql<number>`count(*)::int` }).from(maintenanceRequestsTable)
        .where(
          sql`${maintenanceRequestsTable.propertyId} = ANY(${sql.raw(`ARRAY[${userPropertyIds.join(",")}]::int[]`)}) AND ${maintenanceRequestsTable.status} IN ('open', 'in_progress')`
        ))[0]?.count ?? 0
    : 0;

  const activeTenants = userPropertyIds.length > 0
    ? await db
        .select({
          id: tenantsTable.id,
          rentAmount: tenantsTable.rentAmount,
          leaseStart: tenantsTable.leaseStart,
          billingCycle: tenantsTable.billingCycle,
        })
        .from(tenantsTable)
        .where(sql`${tenantsTable.status} = 'active' AND ${tenantsTable.propertyId} = ANY(${sql.raw(`ARRAY[${userPropertyIds.join(",")}]::int[]`)})`)
    : [];

  const activeTenantIds = activeTenants.map(t => t.id);
  const todayStr = now.toISOString().split("T")[0];
  const allPayments = activeTenantIds.length > 0
    ? await db.select({ tenantId: paymentsTable.tenantId, amount: paymentsTable.amount, month: paymentsTable.month, year: paymentsTable.year, paymentDate: paymentsTable.paymentDate })
        .from(paymentsTable)
        .where(inArray(paymentsTable.tenantId, activeTenantIds))
    : [];

  const todayCollection = allPayments
    .filter(p => p.paymentDate === todayStr)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  const monthlyIncome = allPayments
    .filter(p => p.month === currentMonth && p.year === currentYear)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0);

  const rentDueThisMonth = activeTenants.reduce(
    (sum, t) => sum + parseFloat(String(t.rentAmount)), 0
  );

  const paymentsByTenant = new Map<number, number>();
  for (const p of allPayments) {
    paymentsByTenant.set(p.tenantId, (paymentsByTenant.get(p.tenantId) ?? 0) + parseFloat(String(p.amount)));
  }
  let totalDue = 0;
  for (const t of activeTenants) {
    const cycle = t.billingCycle ?? "monthly";
    const periods = periodsElapsed(t.leaseStart, cycle);
    const expected = periods * parseFloat(String(t.rentAmount));
    const paid = paymentsByTenant.get(t.id) ?? 0;
    totalDue += Math.max(0, expected - paid);
  }

  const totalVacantUnits = Math.max(0, propTotalUnits - activeTenants.length);
  const occupancyPercentage = propTotalUnits > 0 ? Math.round((activeTenants.length / propTotalUnits) * 100) : 0;
  const collectionRate = rentDueThisMonth > 0 ? Math.round((monthlyIncome / rentDueThisMonth) * 100) : 0;

  res.json({
    totalProperties,
    totalTenants: activeTenants.length,
    rentDueThisMonth,
    monthlyIncome,
    todayCollection,
    pendingMaintenance: pendingMaintenanceCount,
    overdueRents: totalDue,
    totalVacantUnits,
    occupancyPercentage,
    collectionRate,
  });
});

export default router;
