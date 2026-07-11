import { and, eq, desc, sql } from "drizzle-orm";
import { db, tenantsTable, propertiesTable, generatedRentsTable, rentRevisionsTable, paymentsTable, paymentAllocationsTable } from "@workspace/db";
import {
  buildLeaseContext,
  getBillableRent,
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

// Full read/write client — satisfied by both the root `db` and a drizzle
// transaction client, so rebuild paths can run atomically inside a tx.
type DbClient = Pick<typeof db, "select" | "update" | "insert" | "delete">;

// Caps for a full-history rebuild (must cover the whole lease lifetime,
// unlike the small incremental catch-up caps below).
function maxRebuildPeriods(billingCycle: string): number {
  return billingCycle === "weekly" ? 1560 : 480;
}

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
  const corrections = computeLedgerCorrections(lease, unsettled, today2);
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

  // tenant.rentAmount is the tenant's Current Rent — the single source of
  // truth column, always directly editable via Edit Tenant. It is NEVER
  // synced back from the timeline here: doing so would silently override a
  // landlord's Edit Tenant correction with a value derived from Rent
  // Revision History, re-coupling the two workflows this resync must keep
  // separate. Only the Revise/Renew endpoints and automatic-escalation
  // recording (which represent the rent revision itself becoming effective)
  // are allowed to update tenant.rentAmount.
  if (corrections.length > 0) {
    logger.info({ tenantId, corrections: corrections.length }, "Resynced unsettled generated_rents to billing timeline");
  }
  return corrections.length;
}

/**
 * Promote tenant.rentAmount for manual revisions whose effective date has
 * arrived since they were created. Immediate revisions are already promoted
 * (and marked appliedToCurrentRent) synchronously by the Revise endpoint —
 * this only handles the future-dated case: a revision created with a
 * future effectiveFrom must still flip Current Rent over once "today"
 * reaches it, even though no one calls Revise again on that date.
 *
 * appliedToCurrentRent (not just effectiveFrom <= today) is the guard: once
 * a revision has promoted Current Rent, it must never do so again, or a
 * landlord's later Edit Tenant correction would be silently clobbered on
 * the next cron/generation run — exactly the coupling bug this redesign
 * removed. Skipped entirely on the Edit Tenant path (skipAutomaticEscalationRecording),
 * same as recordAutomaticEscalations, since Edit Tenant must never write
 * rent_revisions state.
 */
async function promoteEffectiveManualRevisions(
  tenant: typeof tenantsTable.$inferSelect,
  today: string,
  dbClient: DbClient = db
): Promise<number | null> {
  const pending = await dbClient
    .select({ id: rentRevisionsTable.id, newRent: rentRevisionsTable.newRent, effectiveFrom: rentRevisionsTable.effectiveFrom })
    .from(rentRevisionsTable)
    .where(and(
      eq(rentRevisionsTable.tenantId, tenant.id),
      eq(rentRevisionsTable.changedBy, "manual"),
      eq(rentRevisionsTable.status, "active"),
      eq(rentRevisionsTable.appliedToCurrentRent, false),
      sql`${rentRevisionsTable.effectiveFrom} <= ${today}`
    ))
    .orderBy(desc(rentRevisionsTable.effectiveFrom));

  if (pending.length === 0) return null;

  // Multiple could theoretically have become effective since the last run
  // (e.g. server was down); only the latest one's newRent should win.
  const latest = pending[0];
  await dbClient.update(tenantsTable)
    .set({ rentAmount: String(latest.newRent) })
    .where(eq(tenantsTable.id, tenant.id));
  await dbClient.update(rentRevisionsTable)
    .set({ appliedToCurrentRent: true })
    .where(sql`${rentRevisionsTable.id} IN (${sql.join(pending.map((p) => sql`${p.id}`), sql`, `)})`);

  logger.info(
    { tenantId: tenant.id, revisionId: latest.id, effectiveFrom: latest.effectiveFrom, newRent: latest.newRent },
    "Promoted tenant.rentAmount for manual revision that became effective"
  );

  return parseFloat(String(latest.newRent));
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
  today: string,
  dbClient: DbClient = db
): Promise<number | null> {
  if (!tenant.rentEscalation || tenant.escalationApply !== "automatic") return null;

  const schedule = buildEscalationSchedule(lease, today);
  if (schedule.length === 0) return null;

  const automaticRows = await dbClient.select()
    .from(rentRevisionsTable)
    .where(and(
      eq(rentRevisionsTable.tenantId, tenant.id),
      eq(rentRevisionsTable.changedBy, "automatic")
    ))
    .orderBy(rentRevisionsTable.createdAt, rentRevisionsTable.id);

  const escalationType = tenant.escalationType ?? "percentage";
  const escalationValue = parseFloat(String(tenant.escalationValue ?? 0));
  const escalationLabel = escalationType === "percentage" ? `${escalationValue}%` : `+₹${escalationValue}`;

  // Automatic-apply mode means the tenant's Current Rent is intentionally
  // schedule-driven: once an anniversary has genuinely occurred (schedule
  // entries only include events with effectiveFrom <= today), promote
  // tenant.rentAmount to that event's newRent so Current Rent reflects it.
  // This is the ONE place besides Revise/Renew allowed to write
  // tenant.rentAmount — it is the schedule event becoming effective, not a
  // timeline-derived resync.
  const latestScheduleRent = schedule[schedule.length - 1].newRent;
  if (Math.abs(latestScheduleRent - parseFloat(String(tenant.rentAmount))) > 0.005) {
    await dbClient.update(tenantsTable)
      .set({ rentAmount: String(latestScheduleRent) })
      .where(eq(tenantsTable.id, tenant.id));
  }

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
        await dbClient.update(rentRevisionsTable)
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
      await dbClient.insert(rentRevisionsTable).values({
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

  return latestScheduleRent;
}

// Generates any missing rent periods for a single tenant, up to and
// including the period whose generation date has been reached. Used both by
// the batch cron (runRentGeneration) and immediately after tenant
// creation/update, so the ledger is populated without waiting for the next
// scheduled run. Advance and post-paid tenants go through the exact same
// canonical period walker in @workspace/rent-calc.
async function generateForOneTenant(
  tenant: typeof tenantsTable.$inferSelect,
  today: string,
  dbClient: DbClient = db,
  maxPeriodsOverride?: number,
  skipAutomaticEscalationRecording = false
): Promise<number> {
  // The tenant row IS the source of truth for billing settings. Business
  // defaults are materialized into these columns at write time (tenant
  // create/update and business-settings update) — never resolved here.
  const billingCycle = tenant.billingCycle;
  const rentCollectionType = tenant.rentCollectionType;
  const gracePeriodDays = tenant.gracePeriodDays;

  const revisions = await loadRevisions(dbClient, tenant.id);
  const lease = buildLeaseContext(tenant, revisions);

  // Audit rows for automatic escalation (timeline itself never reads them —
  // amounts below come purely from the lease/revision timeline, so skipping
  // this never affects billing correctness). Skipped when called from the
  // Edit Tenant path: Edit Tenant must never write/normalize rent_revisions
  // rows, even automatic ones — only the cron generator, Revise, and Renew
  // workflows own that table.
  if (!skipAutomaticEscalationRecording) {
    const promotedRent = await recordAutomaticEscalations(tenant, lease, today, dbClient);
    // Keep the in-memory lease's Current Rent in sync with the DB write
    // above so period amounts generated later in THIS run already reflect
    // the anniversary that just became effective, instead of lagging one
    // run behind.
    if (promotedRent !== null) lease.currentRentAmount = promotedRent;

    // Same idea for manual revisions created with a future effectiveFrom:
    // once that date arrives, promote Current Rent so it doesn't lag behind
    // the revision that already governs the timeline.
    const manualPromotedRent = await promoteEffectiveManualRevisions(tenant, today, dbClient);
    if (manualPromotedRent !== null) lease.currentRentAmount = manualPromotedRent;
  }

  const [lastRent] = await dbClient
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
    maxPeriodsOverride ?? maxCatchUpPeriods(billingCycle)
  );

  let generated = 0;
  for (const period of periods) {
    const dueDate = computeDueDate(period, rentCollectionType, gracePeriodDays);
    const [inserted] = await dbClient.insert(generatedRentsTable).values({
      tenantId: tenant.id,
      propertyId: tenant.propertyId,
      // Per-period amount from the shared timeline — a period that starts
      // after an escalation anniversary or revision gets that period's
      // correct rent, even within a single catch-up run.
      amount: String(getBillableRent(lease, period.start, today)),
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
    // Phase 2: also insert payment_allocations rows for adopted payments so
    // recomputeGeneratedRentStatus (which now reads allocations) is correct.
    if (inserted) {
      const startDate = new Date(period.start + "T00:00:00Z");
      const adopted = await dbClient.update(paymentsTable)
        .set({ generatedRentId: inserted.id })
        .where(and(
          eq(paymentsTable.tenantId, tenant.id),
          sql`${paymentsTable.generatedRentId} IS NULL`,
          eq(paymentsTable.month, startDate.getUTCMonth() + 1),
          eq(paymentsTable.year, startDate.getUTCFullYear())
        ))
        .returning({ id: paymentsTable.id, amount: paymentsTable.amount });
      if (adopted.length > 0) {
        // Insert allocation rows for all adopted payments (idempotent via
        // ON CONFLICT DO NOTHING — safe if the payment was already linked
        // by a prior rebuild run that partially completed).
        for (const p of adopted) {
          await dbClient.insert(paymentAllocationsTable).values({
            paymentId: p.id,
            generatedRentId: inserted.id,
            allocatedAmount: String(p.amount),
          }).onConflictDoNothing();
        }
        await recomputeGeneratedRentStatus(inserted.id, dbClient);
        logger.info({ tenantId: tenant.id, periodStart: period.start, payments: adopted.length }, "Adopted unlinked payments into newly generated period row");
      }
    }
  }

  // Heal any stale unsettled rows + keep tenant.rentAmount timeline-synced.
  await resyncTenantLedger(dbClient, tenant.id);

  return generated;
}

/**
 * FULL billing rebuild for one tenant — used after edits to billing-defining
 * fields (rent amount, lease dates, billing cycle, collection type, grace
 * period, escalation settings). Editing must produce the same ledger a
 * freshly created tenant with these settings would have, so instead of
 * patching rows in place this:
 *
 * 1. Unlinks every payment from its ledger row (payments/receipts are
 *    historical fact and are NEVER modified beyond the link column).
 * 2. Deletes ALL generated_rents rows (old period boundaries, amounts, due
 *    dates and future schedules are obsolete under the new settings).
 * 3. When `preserveRevisionHistory` is false (the cron/creation path):
 *    deletes ALL automatic-escalation audit rows and lets them be rebuilt
 *    below from the new escalation settings; manual revisions are user data
 *    and are always kept regardless.
 * 4. Regenerates the canonical period rows over the whole lease lifetime
 *    and re-adopts payments by month/year (same adoption path as creation).
 * 5. Allocates any still-unlinked payments (in-progress post-paid period /
 *    future months paid in advance) via the shared allocation engine.
 *
 * MUST run inside a transaction — pass the tx client — so a failure leaves
 * the previous ledger fully intact.
 *
 * @param preserveRevisionHistory When true, rent_revisions is never
 *   touched — no deletes, no automatic-row inserts/normalization. Billing
 *   amounts are still computed correctly because the timeline reads the
 *   lease + manual revisions directly, never the automatic audit rows (see
 *   recordAutomaticEscalations). MUST be true for every Edit Tenant call:
 *   that workflow may only correct tenant settings, never touch Rent
 *   Revision History (manual or automatic) — history is owned exclusively
 *   by the Revise/Renew workflows and the scheduled generator.
 */
export async function rebuildTenantBilling(
  dbClient: DbClient,
  tenantId: number,
  preserveRevisionHistory = false
): Promise<void> {
  const [tenant] = await dbClient.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return;
  const today = new Date().toISOString().split("T")[0];

  await dbClient.update(paymentsTable)
    .set({ generatedRentId: null })
    .where(eq(paymentsTable.tenantId, tenantId));
  // Clear allocations before deleting generated_rents rows — the soft
  // reference (no DB FK on generated_rent_id) means we must clean up
  // explicitly, same pattern as payments.generatedRentId above.
  await dbClient.delete(paymentAllocationsTable)
    .where(sql`${paymentAllocationsTable.paymentId} IN (
      SELECT id FROM payments WHERE tenant_id = ${tenantId}
    )`);
  await dbClient.delete(generatedRentsTable)
    .where(eq(generatedRentsTable.tenantId, tenantId));
  if (!preserveRevisionHistory) {
    await dbClient.delete(rentRevisionsTable)
      .where(and(
        eq(rentRevisionsTable.tenantId, tenantId),
        eq(rentRevisionsTable.changedBy, "automatic")
      ));
  }

  if (tenant.status === "active") {
    await generateForOneTenant(
      tenant, today, dbClient, maxRebuildPeriods(tenant.billingCycle), preserveRevisionHistory
    );
  }

  // Re-allocate payments whose month/year didn't match any generated period
  // (in-progress post-paid period, future month paid in advance) through the
  // SAME shared allocation path used by payment creation.
  const unlinked = await dbClient
    .select({ id: paymentsTable.id, month: paymentsTable.month, year: paymentsTable.year })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.tenantId, tenantId),
      sql`${paymentsTable.generatedRentId} IS NULL`
    ));
  const byPeriod = new Map<string, { month: number; year: number; ids: number[] }>();
  for (const p of unlinked) {
    const key = `${p.year}-${p.month}`;
    const entry = byPeriod.get(key) ?? { month: p.month, year: p.year, ids: [] };
    entry.ids.push(p.id);
    byPeriod.set(key, entry);
  }
  for (const entry of byPeriod.values()) {
    const rentId = await ensureGeneratedRentForPeriod(tenantId, entry.month, entry.year, dbClient);
    if (rentId == null || rentId === "early") {
      // null  = no billable period under the NEW settings (e.g. payment predates
      //          the moved lease start) — payment stays unlinked, still counts
      //          in Total Paid.
      // "early" = post-paid period still in progress — payment stays unlinked,
      //          cron adoption will link it when the period generates normally.
      logger.warn(
        { tenantId, month: entry.month, year: entry.year, payments: entry.ids.length, reason: rentId ?? "no_period" },
        "Rebuild: payments left unlinked (no billable period or post-paid in-progress)"
      );
      continue;
    }
    // Fetch amounts so we can build allocation rows alongside the link update
    const paymentRows = await dbClient
      .select({ id: paymentsTable.id, amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(sql`${paymentsTable.id} IN (${sql.join(entry.ids.map(id => sql`${id}`), sql`, `)})`);
    await dbClient.update(paymentsTable)
      .set({ generatedRentId: rentId })
      .where(sql`${paymentsTable.id} IN (${sql.join(entry.ids.map(id => sql`${id}`), sql`, `)})`);
    for (const p of paymentRows) {
      await dbClient.insert(paymentAllocationsTable).values({
        paymentId: p.id,
        generatedRentId: rentId,
        allocatedAmount: String(p.amount),
      }).onConflictDoNothing();
    }
    await recomputeGeneratedRentStatus(rentId, dbClient);
  }

  logger.info({ tenantId }, "Rebuilt tenant billing from scratch after settings edit");
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
/**
 * "early" means the billing period exists on the lease timeline but has not
 * yet reached its normal post-paid generation eligibility date (periodEnd >
 * today). The caller must save the payment with generatedRentId = null and
 * let the cron's adoption block link it when the period is legitimately
 * generated.
 *
 * null means no billing period exists for that month/year on this lease at
 * all (e.g. before leaseStart). The caller must reject the payment with 400.
 *
 * number means the row was found or created; link the payment to it.
 */
export async function ensureGeneratedRentForPeriod(
  tenantId: number,
  month: number,
  year: number,
  dbClient: DbClient = db
): Promise<number | null | "early"> {
  const [tenant] = await dbClient.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) return null;

  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  // An existing row for a period starting in that month always wins — this
  // mirrors computeMonthHistory's month/year fallback matching exactly.
  const existing = await dbClient
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

  const revisions = await loadRevisions(dbClient, tenantId);
  const lease = buildLeaseContext(tenant, revisions);
  const today = new Date().toISOString().split("T")[0];
  const period = findBillablePeriodForMonth(lease, month, year, today);
  if (!period) return null;

  // CRITICAL: For post-paid tenants, do NOT generate the period row early.
  // Recording a payment must never cause an unfinished billing period to
  // become generated. The payment is saved with generatedRentId = null and
  // the cron's adoption block will link it once the period is legitimately
  // generated (periodEnd <= today on a future run).
  if (tenant.rentCollectionType === "post_paid" && period.end > today) {
    logger.info(
      { tenantId, month, year, periodEnd: period.end, today },
      "Post-paid period not yet billable — payment will be saved as unlinked for later adoption"
    );
    return "early";
  }

  const [inserted] = await dbClient.insert(generatedRentsTable).values({
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
    logger.info({ tenantId, periodStart: period.start }, "Generated period row for payment allocation");
    return inserted.id;
  }

  // Lost a race to a concurrent insert — fetch the winner.
  const [row] = await dbClient
    .select({ id: generatedRentsTable.id })
    .from(generatedRentsTable)
    .where(and(
      eq(generatedRentsTable.tenantId, tenantId),
      eq(generatedRentsTable.billingPeriodStart, period.start)
    ));
  return row?.id ?? null;
}

/**
 * Recompute a generated_rents row's status from the payment_allocations
 * rows that reference it. This is the single source of truth for
 * allocation after Phase 2 migration — recomputeGeneratedRentStatus no
 * longer reads payments.generatedRentId; it reads payment_allocations
 * instead, so one payment can span multiple periods.
 */
export async function recomputeGeneratedRentStatus(generatedRentId: number, dbClient: DbClient = db): Promise<void> {
  const [rent] = await dbClient
    .select({ id: generatedRentsTable.id, amount: generatedRentsTable.amount, dueDate: generatedRentsTable.dueDate })
    .from(generatedRentsTable)
    .where(eq(generatedRentsTable.id, generatedRentId));
  if (!rent) return;

  const allocations = await dbClient
    .select({ paymentId: paymentAllocationsTable.paymentId, allocatedAmount: paymentAllocationsTable.allocatedAmount })
    .from(paymentAllocationsTable)
    .where(eq(paymentAllocationsTable.generatedRentId, generatedRentId));

  const today = new Date().toISOString().split("T")[0];
  let status: string;
  if (allocations.length === 0) {
    status = rent.dueDate < today ? "overdue" : "pending";
  } else {
    const paid = allocations.reduce((s, a) => s + parseFloat(String(a.allocatedAmount)), 0);
    status = paid >= parseFloat(String(rent.amount)) - 0.005 ? "paid" : "partial";
  }
  await dbClient.update(generatedRentsTable)
    .set({ status, paymentId: allocations[0]?.paymentId ?? null })
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
