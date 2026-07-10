import { and, eq, desc, sql } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, generatedRentsTable, businessSettingsTable, rentRevisionsTable } from "@workspace/db";
import {
  buildLeaseContext,
  getActiveRent,
  buildEscalationSchedule,
  computePeriods,
  computeDueDate,
  computeLedgerCorrections,
  type LedgerRevision,
  type LeaseContext,
} from "@workspace/rent-calc";
import { logger } from "./logger";

/**
 * ALL billing math (escalation, billing cycles, due dates, period walking,
 * ledger corrections) lives in @workspace/rent-calc — the single source of
 * truth. This module only orchestrates DB reads/writes around that engine:
 * it generates missing generated_rents rows, records automatic-escalation
 * audit rows, and resyncs unsettled ledger rows to the timeline.
 */

type DbLike = Pick<typeof db, "select" | "update">;

// Per-run catch-up caps for generation (small by design — the cron runs
// daily). Lifetime synthesis inside rent-calc uses its own generous cap.
function maxCatchUpPeriods(billingCycle: string): number {
  return billingCycle === "weekly" ? 156 : 48;
}

async function loadRevisions(dbClient: DbLike, tenantId: number): Promise<LedgerRevision[]> {
  return dbClient
    .select({
      effectiveFrom: rentRevisionsTable.effectiveFrom,
      newRent: rentRevisionsTable.newRent,
      previousRent: rentRevisionsTable.previousRent,
      status: rentRevisionsTable.status,
      changedBy: rentRevisionsTable.changedBy,
    })
    .from(rentRevisionsTable)
    .where(eq(rentRevisionsTable.tenantId, tenantId));
}

/**
 * THE single ledger-sync function. Recomputes every unsettled (not
 * paid/partial) generated_rents row for the tenant from the full merged
 * revision + escalation timeline and updates any row whose amount is stale.
 * Also keeps tenant.rentAmount synced to today's timeline-active rent.
 *
 * Every mutation that can change what rent applies to any period — rent
 * edit, escalation-settings change, manual revision create/edit/cancel,
 * lease renewal, automatic escalation — must call this instead of
 * hand-rolling its own generated_rents UPDATE. Settled (paid/partial) rows
 * are historical fact and are never touched.
 */
export async function resyncTenantLedger(dbClient: DbLike, tenantId: number): Promise<number> {
  const [tenant] = await dbClient.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return 0;

  const revisions = await loadRevisions(dbClient, tenantId);
  const lease = buildLeaseContext(tenant, revisions);

  const unsettled = await dbClient
    .select({
      id: generatedRentsTable.id,
      amount: generatedRentsTable.amount,
      billingPeriodStart: generatedRentsTable.billingPeriodStart,
    })
    .from(generatedRentsTable)
    .where(and(
      eq(generatedRentsTable.tenantId, tenantId),
      sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
    ));

  const corrections = computeLedgerCorrections(lease, unsettled);
  for (const c of corrections) {
    await dbClient.update(generatedRentsTable)
      .set({ amount: String(c.correctAmount) })
      .where(eq(generatedRentsTable.id, c.id));
  }

  // tenant.rentAmount is a denormalized snapshot of "today's active rent";
  // keep it aligned with the timeline so list screens and previews agree.
  // ONLY when at least one revision row exists: with zero revisions,
  // rentAmount IS the timeline's base-rent anchor (see buildLeaseContext),
  // and overwriting it with an escalated value would destroy the base
  // forever and double-escalate every subsequent read. Auto-apply tenants
  // without anchor rows self-heal at the next generation run, where
  // recordAutomaticEscalations writes the anchor rows before this resync.
  const today = new Date().toISOString().split("T")[0];
  const activeRent = getActiveRent(lease, today);
  if (revisions.length > 0 && Math.abs(activeRent - parseFloat(String(tenant.rentAmount))) > 0.005) {
    await dbClient.update(tenantsTable)
      .set({ rentAmount: String(activeRent) })
      .where(eq(tenantsTable.id, tenantId));
  }

  if (corrections.length > 0) {
    logger.info({ tenantId, corrections: corrections.length }, "Resynced unsettled generated_rents to billing timeline");
  }
  return corrections.length;
}

/**
 * Record automatic-escalation audit rows in rent_revisions, anniversary-
 * accurate. The balance/ledger timeline NEVER reads automatic rows (it
 * recomputes the schedule from the lease terms — see buildRevisionEvents in
 * @workspace/rent-calc), so these rows are audit/history only. This
 * function:
 *
 * 1. Normalizes legacy automatic rows (stamped with old cron run dates /
 *    one-step amounts) to the true anniversary dates and compounding
 *    amounts, matching positionally exactly like buildDisplayRevisionHistory.
 * 2. Inserts a row for any anniversary that has occurred but has no row yet
 *    (effectiveFrom = the TRUE anniversary date, never "today").
 *
 * Idempotent: once rows match the schedule, subsequent runs are no-ops.
 */
async function recordAutomaticEscalations(
  tenant: typeof tenantsTable.$inferSelect,
  lease: LeaseContext,
  today: string
): Promise<void> {
  if (!tenant.rentEscalation || tenant.escalationApply !== "automatic") return;

  const schedule = buildEscalationSchedule(lease, today);
  if (schedule.length === 0) return;

  const automaticRows = await db.select()
    .from(rentRevisionsTable)
    .where(and(
      eq(rentRevisionsTable.tenantId, tenant.id),
      eq(rentRevisionsTable.changedBy, "automatic")
    ))
    .orderBy(rentRevisionsTable.createdAt, rentRevisionsTable.id);

  const escalationType = tenant.escalationType ?? "percentage";
  const escalationValue = parseFloat(String(tenant.escalationValue ?? 0));
  const escalationLabel = escalationType === "percentage" ? `${escalationValue}%` : `+₹${escalationValue}`;

  for (let i = 0; i < schedule.length; i++) {
    const event = schedule[i];
    // previousRent comes from the canonical timeline walk — after a manual
    // raise it is the raised amount, not the prior schedule event's value.
    const previousAmount = event.previousRent;
    const stored = automaticRows[i];

    if (stored) {
      const needsFix =
        stored.effectiveFrom !== event.effectiveFrom ||
        Math.abs(parseFloat(String(stored.newRent)) - event.newRent) > 0.005 ||
        Math.abs(parseFloat(String(stored.previousRent)) - previousAmount) > 0.005;
      if (needsFix) {
        await db.update(rentRevisionsTable)
          .set({
            effectiveFrom: event.effectiveFrom,
            newRent: String(event.newRent),
            previousRent: String(previousAmount),
          })
          .where(eq(rentRevisionsTable.id, stored.id));
        logger.info(
          { tenantId: tenant.id, revisionId: stored.id, effectiveFrom: event.effectiveFrom },
          "Normalized legacy automatic escalation row to true anniversary"
        );
      }
    } else {
      await db.insert(rentRevisionsTable).values({
        tenantId: tenant.id,
        previousRent: String(previousAmount),
        newRent: String(event.newRent),
        effectiveFrom: event.effectiveFrom,
        reason: `Auto-escalation: ${escalationLabel} applied on lease anniversary`,
        changedBy: "automatic",
      });
      logger.info(
        { tenantId: tenant.id, effectiveFrom: event.effectiveFrom, newRent: event.newRent },
        "Automatic rent escalation recorded at lease anniversary"
      );
    }
  }
}

// Generates any missing rent periods for a single tenant, up to and
// including the period whose generation date has been reached. Used both by
// the batch cron (runRentGeneration) and immediately after tenant
// creation/update, so the ledger is populated without waiting for the next
// scheduled run. Advance and post-paid tenants go through the exact same
// canonical period walker in @workspace/rent-calc.
async function generateForOneTenant(
  tenant: typeof tenantsTable.$inferSelect,
  propertyUserId: number | null,
  today: string
): Promise<number> {
  let billingCycle = tenant.billingCycle;
  let rentCollectionType = tenant.rentCollectionType;
  let gracePeriodDays = tenant.gracePeriodDays;

  if (tenant.useBusinessDefault && propertyUserId != null) {
    const [settings] = await db
      .select()
      .from(businessSettingsTable)
      .where(eq(businessSettingsTable.userId, propertyUserId));
    if (settings) {
      billingCycle = settings.defaultBillingCycle;
      rentCollectionType = settings.defaultRentCollectionType;
      gracePeriodDays = settings.defaultGracePeriodDays;
    }
  }

  const revisions = await loadRevisions(db, tenant.id);
  const lease = buildLeaseContext(
    { ...tenant, billingCycle, rentCollectionType, gracePeriodDays },
    revisions
  );

  // Audit rows for automatic escalation (timeline itself never reads them).
  await recordAutomaticEscalations(tenant, lease, today);

  const [lastRent] = await db
    .select({ billingPeriodEnd: generatedRentsTable.billingPeriodEnd })
    .from(generatedRentsTable)
    .where(eq(generatedRentsTable.tenantId, tenant.id))
    .orderBy(desc(generatedRentsTable.billingPeriodEnd))
    .limit(1);

  const periods = computePeriods(
    tenant.leaseStart,
    lastRent?.billingPeriodEnd ?? null,
    billingCycle,
    rentCollectionType,
    today,
    maxCatchUpPeriods(billingCycle)
  );

  let generated = 0;
  for (const period of periods) {
    const dueDate = computeDueDate(period, rentCollectionType, gracePeriodDays);
    await db.insert(generatedRentsTable).values({
      tenantId: tenant.id,
      propertyId: tenant.propertyId,
      // Per-period amount from the shared timeline — a period that starts
      // after an escalation anniversary or revision gets that period's
      // correct rent, even within a single catch-up run.
      amount: String(getActiveRent(lease, period.start)),
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      dueDate,
      billingCycle,
      status: "pending",
      paymentId: null,
    }).onConflictDoNothing();
    generated++;
  }

  // Heal any stale unsettled rows + keep tenant.rentAmount timeline-synced.
  await resyncTenantLedger(db, tenant.id);

  return generated;
}

export async function runRentGeneration(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let generated = 0;

  const tenants = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.status, "active"));

  for (const { tenant, propertyUserId } of tenants) {
    try {
      generated += await generateForOneTenant(tenant, propertyUserId, today);
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Rent generation failed for tenant");
    }
  }

  logger.info({ generated }, "Rent generation complete");
  return generated;
}

// Immediately backfills rent periods for a single freshly-created (or
// updated) tenant, instead of waiting for the next scheduled batch run.
export async function runRentGenerationForTenant(tenantId: number): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  const [row] = await db
    .select({ tenant: tenantsTable, propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, tenantId));

  if (!row || row.tenant.status !== "active") return 0;

  try {
    const generated = await generateForOneTenant(row.tenant, row.propertyUserId, today);
    logger.info({ tenantId, generated }, "Rent generation complete for tenant");
    return generated;
  } catch (err) {
    logger.error({ err, tenantId }, "Rent generation failed for tenant");
    return 0;
  }
}
