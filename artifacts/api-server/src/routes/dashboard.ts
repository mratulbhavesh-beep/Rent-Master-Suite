import { Router, type IRouter } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, paymentsTable, maintenanceRequestsTable, generatedRentsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { computeLedgerSummary } from "@workspace/rent-calc";

const router: IRouter = Router();

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

  // Outstanding balance is computed via the shared @workspace/rent-calc
  // ledger service — the single source of truth also used by the tenant
  // detail and ledger endpoints, so figures always agree across the app.
  const allGeneratedRents = activeTenantIds.length > 0
    ? await db
        .select({
          tenantId: generatedRentsTable.tenantId,
          amount: generatedRentsTable.amount,
          dueDate: generatedRentsTable.dueDate,
          status: generatedRentsTable.status,
          billingPeriodStart: generatedRentsTable.billingPeriodStart,
        })
        .from(generatedRentsTable)
        .where(inArray(generatedRentsTable.tenantId, activeTenantIds))
    : [];

  const rentsByTenant = new Map<number, typeof allGeneratedRents>();
  for (const r of allGeneratedRents) {
    const list = rentsByTenant.get(r.tenantId) ?? [];
    list.push(r);
    rentsByTenant.set(r.tenantId, list);
  }

  const paymentsForLedgerByTenant = new Map<number, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsForLedgerByTenant.get(p.tenantId) ?? [];
    list.push(p);
    paymentsForLedgerByTenant.set(p.tenantId, list);
  }

  let totalDue = 0;
  for (const t of activeTenants) {
    const entries = rentsByTenant.get(t.id) ?? [];
    const tenantPayments = paymentsForLedgerByTenant.get(t.id) ?? [];
    totalDue += computeLedgerSummary(entries, tenantPayments, todayStr).balanceDue;
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
