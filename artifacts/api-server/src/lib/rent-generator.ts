import { and, eq, desc, sql } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, generatedRentsTable, rentRevisionsTable, paymentsTable } from "@workspace/db";
import {
  buildLeaseContext,
  getActiveRent,
  buildEscalationSchedule,
  computePeriods,
  computeDueDate,
  computeLedgerCorrections,
  findBillablePeriodForMonth,
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
      billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
      dueDate: generatedRentsTable.dueDate,
    })
    .from(generatedRentsTable)
    .where(and(
      eq(generatedRentsTable.tenantId, tenantId),
      sql`${generatedRentsTable.status} NOT IN ('paid', 'partial')`
    ));

  // Corrections cover both stale amounts (escalations/revisions) AND stale
  // due dates (collection type / grace period changes) — one shared path.
  // When a due date moves, the pending/overdue status is recomputed from the
  // NEW due date: the overdue marker elsewhere only ever flips pending →
  // overdue, so without this a due date pushed into the future would leave
  // the row stuck on a stale "overdue".
  const today2 = new Date().toISOString().split("T")[0];
  const corrections = computeLedgerCorrections(lease, unsettled);
  for (const c of corrections) {
    const patch: Record<string, string> = {};
    if (c.correctAmount !== undefined) patch.amount = String(c.correctAmount);
    if (c.correctDueDate !== undefined) {
      patch.dueDate = c.correctDueDate;
      patch.status = c.correctDueDate < today2 ? "overdue" : "pending";
    }
    await dbClient.update(generatedRentsTable)
      .set(patch)
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
  today: string
): Promise<number> {
  // The tenant row IS the source of truth for billing settings. Business
  // defaults are materialized into these columns at write time (tenant
  // create/update and business-settings update) — never resolved here.
  const billingCycle = tenant.billingCycle;
  const rentCollectionType = tenant.rentCollectionType;
  const gracePeriodDays = tenant.gracePeriodDays;

  const revisions = await loadRevisions(db, tenant.id);
  const lease = buildLeaseContext(tenant, revisions);

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
    const [inserted] = await db.insert(generatedRentsTable).values({
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
    }).onConflictDoNothing().returning({ id: generatedRentsTable.id });
    generated++;

    // Adopt any still-unlinked payments recorded for this period's month
    // (e.g. rent paid in advance of a future period, before its row could
    // exist) so every payment ends up on exactly one ledger row.
    if (inserted) {
      const startDate = new Date(period.start + "T00:00:00Z");
      const adopted = await db.update(paymentsTable)
        .set({ generatedRentId: inserted.id })
        .where(and(
          eq(paymentsTable.tenantId, tenant.id),
          sql`${paymentsTable.generatedRentId} IS NULL`,
          eq(paymentsTable.month, startDate.getUTCMonth() + 1),
          eq(paymentsTable.year, startDate.getUTCFullYear())
        ))
        .returning({ id: paymentsTable.id });
      if (adopted.length > 0) {
        await recomputeGeneratedRentStatus(inserted.id);
        logger.info({ tenantId: tenant.id, periodStart: period.start, payments: adopted.length }, "Adopted unlinked payments into newly generated period row");
      }
    }
  }

  // Heal any stale unsettled rows + keep tenant.rentAmount timeline-synced.
  await resyncTenantLedger(db, tenant.id);

  return generated;
}

/**
 * Ensure a generated_rents row exists for the billing period a payment for
 * `month`/`year` belongs to, and return its id. Uses the SAME shared billing
 * engine as generation/synthesis (findBillablePeriodForMonth) — never a
 * separate allocation computation.
 *
 * This exists because POST-PAID periods are (correctly) not generated until
 * the period ends, but a tenant may pay for the in-progress period early.
 * That payment must land on a real ledger row so Month History, Ledger,
 * Timeline, Receipts and Summary all read the same rows. Returns null when
 * no started period matches (e.g. a future month).
 */
export async function ensureGeneratedRentForPeriod(
  tenantId: number,
  month: number,
  year: number
): Promise<number | null> {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return null;

  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  // An existing row for a period starting in that month always wins — this
  // mirrors computeMonthHistory's month/year fallback matching exactly.
  const existing = await db
    .select({ id: generatedRentsTable.id, billingPeriodStart: generatedRentsTable.billingPeriodStart })
    .from(generatedRentsTable)
    .where(and(
      eq(generatedRentsTable.tenantId, tenantId),
      sql`${generatedRentsTable.billingPeriodStart} >= ${monthPrefix + "-01"}::date`,
      sql`${generatedRentsTable.billingPeriodStart} < (${monthPrefix + "-01"}::date + interval '1 month')`
    ))
    .orderBy(generatedRentsTable.billingPeriodStart)
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const revisions = await loadRevisions(db, tenantId);
  const lease = buildLeaseContext(tenant, revisions);
  const today = new Date().toISOString().split("T")[0];
  const period = findBillablePeriodForMonth(lease, month, year, today);
  if (!period) return null;

  const [inserted] = await db.insert(generatedRentsTable).values({
    tenantId,
    propertyId: tenant.propertyId,
    amount: String(period.amount),
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    dueDate: period.dueDate,
    billingCycle: tenant.billingCycle,
    status: "pending",
    paymentId: null,
  }).onConflictDoNothing().returning({ id: generatedRentsTable.id });

  if (inserted) {
    logger.info({ tenantId, periodStart: period.start }, "Generated in-progress period row for payment allocation");
    return inserted.id;
  }

  // Lost a race to a concurrent insert — fetch the winner.
  const [row] = await db
    .select({ id: generatedRentsTable.id })
    .from(generatedRentsTable)
    .where(and(
      eq(generatedRentsTable.tenantId, tenantId),
      eq(generatedRentsTable.billingPeriodStart, period.start)
    ));
  return row?.id ?? null;
}

/**
 * Recompute a generated_rents row's status from the payments actually
 * linked to it (the single source of truth for allocation). Used after a
 * payment is created, deleted, or re-allocated so the ledger row never
 * carries a stale paid/partial marker.
 */
export async function recomputeGeneratedRentStatus(generatedRentId: number): Promise<void> {
  const [rent] = await db
    .select({ id: generatedRentsTable.id, amount: generatedRentsTable.amount, dueDate: generatedRentsTable.dueDate })
    .from(generatedRentsTable)
    .where(eq(generatedRentsTable.id, generatedRentId));
  if (!rent) return;

  const linked = await db
    .select({ id: paymentsTable.id, amount: paymentsTable.amount })
    .from(paymentsTable)
    .where(eq(paymentsTable.generatedRentId, generatedRentId));

  const today = new Date().toISOString().split("T")[0];
  let status: string;
  if (linked.length === 0) {
    status = rent.dueDate < today ? "overdue" : "pending";
  } else {
    const paid = linked.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
    status = paid >= parseFloat(String(rent.amount)) - 0.005 ? "paid" : "partial";
  }
  await db.update(generatedRentsTable)
    .set({ status, paymentId: linked[0]?.id ?? null })
    .where(eq(generatedRentsTable.id, generatedRentId));
}

export async function runRentGeneration(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  let generated = 0;

  const tenants = await db
    .select({ tenant: tenantsTable })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.status, "active"));

  for (const { tenant } of tenants) {
    try {
      generated += await generateForOneTenant(tenant, today);
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
    .select({ tenant: tenantsTable })
    .from(tenantsTable)
    .innerJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, tenantId));

  if (!row || row.tenant.status !== "active") return 0;

  try {
    const generated = await generateForOneTenant(row.tenant, today);
    logger.info({ tenantId, generated }, "Rent generation complete for tenant");
    return generated;
  } catch (err) {
    logger.error({ err, tenantId }, "Rent generation failed for tenant");
    return 0;
  }
}
