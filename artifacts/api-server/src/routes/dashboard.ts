import { Router, type IRouter } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, propertiesTable, tenantsTable, paymentsTable, maintenanceRequestsTable, generatedRentsTable, rentRevisionsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { computeLedgerSummary, type LedgerRevision, type LeaseContext } from "@workspace/rent-calc";

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
          rentCollectionType: tenantsTable.rentCollectionType,
          gracePeriodDays: tenantsTable.gracePeriodDays,
          rentEscalation: tenantsTable.rentEscalation,
          escalationFrequencyYears: tenantsTable.escalationFrequencyYears,
          escalationType: tenantsTable.escalationType,
          escalationValue: tenantsTable.escalationValue,
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

  const allRevisions = activeTenantIds.length > 0
    ? await db
        .select({
          tenantId: rentRevisionsTable.tenantId,
          effectiveFrom: rentRevisionsTable.effectiveFrom,
          newRent: rentRevisionsTable.newRent,
          previousRent: rentRevisionsTable.previousRent,
          status: rentRevisionsTable.status,
          changedBy: rentRevisionsTable.changedBy,
        })
        .from(rentRevisionsTable)
        .where(inArray(rentRevisionsTable.tenantId, activeTenantIds))
    : [];

  const rentsByTenant = new Map<number, typeof allGeneratedRents>();
  for (const r of allGeneratedRents) {
    const list = rentsByTenant.get(r.tenantId) ?? [];
    list.push(r);
    rentsByTenant.set(r.tenantId, list);
  }

  const revisionsByTenant = new Map<number, LedgerRevision[]>();
  for (const r of allRevisions) {
    const list = revisionsByTenant.get(r.tenantId) ?? [];
    list.push({ effectiveFrom: r.effectiveFrom, newRent: r.newRent, previousRent: r.previousRent, status: r.status, changedBy: r.changedBy });
    revisionsByTenant.set(r.tenantId, list);
  }

  const paymentsForLedgerByTenant = new Map<number, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsForLedgerByTenant.get(p.tenantId) ?? [];
    list.push(p);
    paymentsForLedgerByTenant.set(p.tenantId, list);
  }

  let totalDue = 0;
  let rentDueThisMonth = 0;
  for (const t of activeTenants) {
    const entries = rentsByTenant.get(t.id) ?? [];
    const tenantPayments = paymentsForLedgerByTenant.get(t.id) ?? [];
    const revisions = [...(revisionsByTenant.get(t.id) ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    // baseRentAmount is the rent at lease inception, before ANY revision.
    // Automatic escalation revisions are recomputed from the lease
    // agreement's terms (see buildEscalationSchedule in @workspace/rent-calc),
    // so only the earliest MANUAL revision's previousRent can override the
    // tenant's current rentAmount here.
    const earliestManual = revisions.find(r => (r.changedBy ?? "manual") !== "automatic");
    const baseRentAmount = earliestManual?.previousRent != null
      ? earliestManual.previousRent
      : revisions[0]?.previousRent != null
        ? revisions[0].previousRent
        : t.rentAmount;
    const lease: LeaseContext = {
      leaseStart: t.leaseStart,
      billingCycle: t.billingCycle,
      rentCollectionType: t.rentCollectionType,
      gracePeriodDays: t.gracePeriodDays,
      baseRentAmount,
      revisions,
      rentEscalation: t.rentEscalation ?? false,
      escalationFrequencyYears: t.escalationFrequencyYears ?? 1,
      escalationType: t.escalationType ?? "percentage",
      escalationValue: t.escalationValue ?? 0,
    };
    const ledgerSummary = computeLedgerSummary(entries, tenantPayments, todayStr, lease);
    totalDue += ledgerSummary.balanceDue;
    // Sourced entirely from generated_rents-backed periods (via
    // computeLedgerSummary -> synthesizeBillablePeriods), never from
    // Months Active x Rent Amount. This is what keeps ADVANCE and
    // POST-PAID billing correctly independent:
    // - Advance: a period exists (and is due) from its first day, so this
    //   already reflects the active rent from day 1 of the cycle.
    // - Post-paid: a period does not exist at all until its LAST day is
    //   reached, so an in-progress post-paid month contributes 0 here
    //   until the generation date arrives, exactly as required.
    rentDueThisMonth += ledgerSummary.currentMonthDue;
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
