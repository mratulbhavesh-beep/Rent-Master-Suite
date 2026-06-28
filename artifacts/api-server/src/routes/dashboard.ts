import { Router, type IRouter } from "express";
import { count, eq, sql } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, paymentsTable, maintenanceRequestsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (_req, res): Promise<void> => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [propertiesCount] = await db.select({ count: count() }).from(propertiesTable);
  const [tenantsCount] = await db.select({ count: count() }).from(tenantsTable).where(eq(tenantsTable.status, "active"));
  const [pendingMaintenance] = await db.select({ count: count() }).from(maintenanceRequestsTable)
    .where(sql`${maintenanceRequestsTable.status} IN ('open', 'in_progress')`);

  const monthlyPayments = await db.select({
    amount: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)`,
  }).from(paymentsTable)
    .where(sql`${paymentsTable.month} = ${currentMonth} AND ${paymentsTable.year} = ${currentYear} AND ${paymentsTable.status} = 'paid'`);

  const overdueRents = await db.select({ count: count() }).from(paymentsTable)
    .where(eq(paymentsTable.status, "overdue"));

  const activeTenants = await db.select({ rentAmount: tenantsTable.rentAmount }).from(tenantsTable)
    .where(eq(tenantsTable.status, "active"));
  const rentDueThisMonth = activeTenants.reduce((sum, t) => sum + parseFloat(String(t.rentAmount)), 0);

  res.json({
    totalProperties: propertiesCount.count,
    totalTenants: tenantsCount.count,
    rentDueThisMonth,
    monthlyIncome: parseFloat(String(monthlyPayments[0]?.amount ?? "0")),
    pendingMaintenance: pendingMaintenance.count,
    overdueRents: overdueRents[0]?.count ?? 0,
  });
});

export default router;
