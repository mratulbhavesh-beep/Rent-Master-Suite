/**
 * Single source of truth for all rent-ledger balance and history calculations.
 *
 * Every screen that shows "Total Expected", "Total Paid", "Balance Due",
 * "Advance Balance", or a month-by-month history (Dashboard, Reports, Tenant
 * Details, Rent Ledger list, Rent Ledger detail / Month History) MUST derive
 * its numbers from these functions instead of re-deriving them locally.
 *
 * Ground truth is the `generated_rents` ledger, never a periodsElapsed x
 * rentAmount formula. Collection type (advance vs post-paid) is already
 * baked into each entry's `dueDate` by the rent generator, so this module
 * never needs to know about billing cycles or collection types itself.
 */

export type LedgerEntry = {
  id?: number;
  amount: string | number;
  dueDate: string;
  status: string;
  billingPeriodStart: string;
  /** Required only for computeMonthHistory; not needed for computeLedgerSummary. */
  billingPeriodEnd?: string;
};

export type LedgerPayment = {
  amount: string | number;
  generatedRentId?: number | null;
  month?: number | null;
  year?: number | null;
  paymentDate?: string;
};

export type LedgerSummary = {
  monthsElapsed: number;
  /** Sum of every billable period to date (generated or not), regardless of due date. */
  totalExpected: number;
  /** Subset of totalExpected whose due date has already passed. Informational only — NOT used for balanceDue. */
  dueExpected: number;
  /** Sum of all recorded payments. */
  totalPaid: number;
  /** What the tenant currently owes: max(0, totalExpected - totalPaid). Always consistent with totalExpected/totalPaid. */
  balanceDue: number;
  /** Credit the tenant is carrying: max(0, totalPaid - totalExpected). */
  advanceBalance: number;
  /** Amount owed for the most recent billing period, 0 if not yet due or already paid. */
  currentMonthDue: number;
};

/**
 * A rent revision as needed by the summary layer to know which rent amount
 * applied to which stretch of the lease. Mirrors rent_revisions rows.
 */
export type LedgerRevision = {
  effectiveFrom: string;
  newRent: string | number;
  previousRent?: string | number;
  status?: string;
  /** "manual" | "automatic" (defaults to "manual" when omitted, for backward compat). */
  changedBy?: string;
};

/**
 * Lease-level context needed to reconstruct every billable period from lease
 * start to today, independent of how many `generated_rents` rows currently
 * exist. This lets the summary layer correctly reflect the full lease
 * history and every rent revision even when the ledger hasn't (yet) been
 * generated/backfilled for every past period.
 *
 * The period/due-date arithmetic used here (computePeriods/computePeriodEnd/
 * computeDueDate) is the canonical, ONLY implementation in the app — the
 * rent generator imports it from this module too.
 */
export type LeaseContext = {
  leaseStart: string;
  billingCycle: string;
  rentCollectionType: string;
  gracePeriodDays: number;
  /** Rent amount that applied before the first revision (or the current rent, if none). */
  baseRentAmount: string | number;
  revisions?: LedgerRevision[];
  /**
   * Escalation terms from the lease agreement. When `rentEscalation` is true,
   * the summary layer recomputes the escalation schedule directly from these
   * terms (every `escalationFrequencyYears` from `leaseStart`) instead of
   * relying on whatever automatic `rent_revisions` rows happen to exist —
   * those rows are stamped with the date the escalation job happened to run,
   * not the lease's true anniversary date, so they cannot be trusted for
   * historical reconstruction. Manual revisions (see `LedgerRevision.changedBy`)
   * are still honored as explicit overrides.
   */
  rentEscalation?: boolean;
  escalationFrequencyYears?: number;
  /** "percentage" | "fixed" */
  escalationType?: string;
  escalationValue?: string | number;
  /**
   * Whether escalation anniversaries auto-apply to the rent timeline
   * (tenant.escalationApply === "automatic"). When false ("manual" apply
   * mode), the schedule is NEVER applied automatically — the timeline is
   * base rent + manual revisions only, and the anniversary merely drives
   * reminders/previews (see nextEscalationEvent). Defaults to true when
   * omitted for backward compatibility with contexts built before this
   * field existed.
   */
  escalationAutoApply?: boolean;
};

function toNum(v: string | number): number {
  return parseFloat(String(v));
}

/** Canonical UTC date arithmetic used by every billing computation in the app. */
export function addMonthsUTC(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split("T")[0];
}

export function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function addYearsUTC(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().split("T")[0];
}

/**
 * Apply ONE escalation step (per the lease's type/value) to a running rent
 * amount. The single place the +fixed / +percentage arithmetic lives.
 */
export function applyEscalationStep(amount: number, lease: LeaseContext): number {
  const escalationType = lease.escalationType ?? "percentage";
  const escalationValue = toNum(lease.escalationValue ?? 0);
  return escalationType === "fixed" ? amount + escalationValue : amount * (1 + escalationValue / 100);
}

type TimelineEvent = {
  effectiveFrom: string;
  newRent: number;
  previousRent: number;
  source: "manual" | "escalation";
};

/**
 * THE canonical rent timeline: a single chronological walk that starts at
 * `baseRentAmount` and processes every event in date order —
 *
 * - a MANUAL revision (explicit landlord decision) sets the running amount
 *   to its recorded newRent, honored at its recorded date;
 * - an escalation ANNIVERSARY (true lease anniversary, recomputed from the
 *   lease terms — never from automatic rent_revisions rows, whose stamped
 *   dates lag the anniversary) applies one escalation step to the RUNNING
 *   amount. Anniversaries are only walked when escalation is enabled AND
 *   auto-apply mode is on ("manual" apply mode never changes the timeline).
 *
 * Because anniversaries step the running amount (not an independent
 * compounding from base), an escalation after a manual raise or a lease
 * renewal escalates ON TOP of that raise — rent can never silently drop
 * back at the next anniversary. When both land on the same date, the
 * escalation step is applied first so the manual revision wins.
 */
function walkTimeline(lease: LeaseContext, today: string): TimelineEvent[] {
  const raw: Array<{ effectiveFrom: string; newRent?: number; source: "manual" | "escalation" }> = [];

  for (const r of lease.revisions ?? []) {
    if ((r.status ?? "active") === "active" && (r.changedBy ?? "manual") !== "automatic" && r.effectiveFrom <= today) {
      raw.push({ effectiveFrom: r.effectiveFrom, newRent: toNum(r.newRent), source: "manual" });
    }
  }

  const frequencyYears = lease.escalationFrequencyYears ?? 1;
  const escalationValue = toNum(lease.escalationValue ?? 0);
  const autoApply = lease.escalationAutoApply ?? true;
  if (lease.rentEscalation && autoApply && frequencyYears > 0 && escalationValue !== 0) {
    let anniversary = addYearsUTC(lease.leaseStart, frequencyYears);
    const MAX_ANNIVERSARIES = 100; // generous cap; a lease running 100+ escalation cycles is not realistic
    let count = 0;
    while (anniversary <= today && count < MAX_ANNIVERSARIES) {
      raw.push({ effectiveFrom: anniversary, source: "escalation" });
      anniversary = addYearsUTC(anniversary, frequencyYears);
      count++;
    }
  }

  raw.sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom) ||
    (a.source === b.source ? 0 : a.source === "escalation" ? -1 : 1)
  );

  let amount = toNum(lease.baseRentAmount);
  const events: TimelineEvent[] = [];
  for (const e of raw) {
    const previousRent = amount;
    amount = e.source === "manual" ? e.newRent! : applyEscalationStep(amount, lease);
    events.push({ effectiveFrom: e.effectiveFrom, newRent: amount, previousRent, source: e.source });
  }
  return events;
}

/**
 * The escalation anniversaries that have occurred up to (and including)
 * `today`, with timeline-consistent amounts: each event's newRent is the
 * running timeline amount after that anniversary's step (so an anniversary
 * following a manual raise compounds on the raised amount), and
 * previousRent is the running amount just before it. Derived from the same
 * canonical walk as getActiveRent — never diverges from the ledger.
 * Empty when escalation is off, in "manual" apply mode, or terms are inert.
 */
export function buildEscalationSchedule(
  lease: LeaseContext,
  today: string
): Array<{ effectiveFrom: string; newRent: number; previousRent: number }> {
  return walkTimeline(lease, today)
    .filter(e => e.source === "escalation")
    .map(e => ({ effectiveFrom: e.effectiveFrom, newRent: e.newRent, previousRent: e.previousRent }));
}

export function getCycleMonths(billingCycle: string): number {
  if (billingCycle === "quarterly") return 3;
  if (billingCycle === "yearly") return 12;
  return 1; // monthly
}

/**
 * Canonical billing-cycle engine: the ONE implementation of "when does a
 * billing period end" for the whole app. Weekly periods span 7 days (day 0
 * through day 6); monthly/quarterly/yearly span whole calendar cycles.
 */
export function computePeriodEnd(periodStart: string, billingCycle: string): string {
  if (billingCycle === "weekly") {
    return addDaysUTC(periodStart, 6); // 7-day period: day 0 to day 6
  }
  return addDaysUTC(addMonthsUTC(periodStart, getCycleMonths(billingCycle)), -1);
}

/**
 * Canonical due-date engine: ADVANCE billing anchors the due date to the
 * period's first day (rent owed up front); POST-PAID anchors to the last day
 * (billed in arrears). Grace days are added on top in both cases.
 */
export function computeDueDate(
  period: { start: string; end: string },
  rentCollectionType: string,
  gracePeriodDays: number
): string {
  const anchor = rentCollectionType === "advance" ? period.start : period.end;
  return addDaysUTC(anchor, gracePeriodDays);
}

/**
 * Canonical period walker: enumerate billing periods from `leaseStart` (or
 * the day after `lastPeriodEnd` when the ledger already has rows) whose
 * generation date has been reached:
 *
 * - ADVANCE billing: a period exists once its first day has arrived
 *   (`periodStart <= today`) — rent is billed up front.
 * - POST-PAID billing: a period does NOT exist until its LAST day has been
 *   reached (`periodEnd <= today`) — rent is billed in arrears.
 *
 * `maxPeriods` bounds the walk: the rent generator passes a small per-run
 * catch-up cap, while lifetime synthesis uses a generous lifetime cap.
 */
export function computePeriods(
  leaseStart: string,
  lastPeriodEnd: string | null,
  billingCycle: string,
  rentCollectionType: string,
  today: string,
  maxPeriods: number
): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = [];
  let periodStart: string = lastPeriodEnd ? addDaysUTC(lastPeriodEnd, 1) : leaseStart;
  let count = 0;

  while (count < maxPeriods) {
    const periodEnd = computePeriodEnd(periodStart, billingCycle);
    const isGenerationDateReached =
      rentCollectionType === "advance" ? periodStart <= today : periodEnd <= today;
    if (!isGenerationDateReached) break;
    periods.push({ start: periodStart, end: periodEnd });
    periodStart = addDaysUTC(periodEnd, 1);
    count++;
  }

  return periods;
}

/**
 * Locate the billing period a payment for `month`/`year` belongs to, using
 * the same canonical period walker as generation/synthesis. Returns the
 * period (with its timeline-correct amount and due date) whose START falls
 * in that calendar month.
 *
 * Allocation gate: any period on the lease timeline for the requested
 * month/year is allocatable — past, in-progress, or future. This is
 * deliberately looser than the generation gate: a post-paid tenant may pay
 * for the in-progress period before it ends, and an advance payment may
 * target a future month; either way the payment must land on a real ledger
 * row rather than float unallocated (invariant: every payment belongs to
 * exactly one ledger row). Returns null only when the lease timeline has no
 * period in that month (e.g. before lease start).
 */
export function findBillablePeriodForMonth(
  lease: LeaseContext,
  month: number,
  year: number,
  _today: string
): { start: string; end: string; dueDate: string; amount: number } | null {
  const MAX_PERIODS = lease.billingCycle === "weekly" ? 780 : 600;
  let periodStart: string = lease.leaseStart;
  let count = 0;

  while (count < MAX_PERIODS) {
    const periodEnd = computePeriodEnd(periodStart, lease.billingCycle);
    const d = new Date(periodStart + "T00:00:00Z");
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) {
      return {
        start: periodStart,
        end: periodEnd,
        dueDate: computeDueDate({ start: periodStart, end: periodEnd }, lease.rentCollectionType, lease.gracePeriodDays),
        amount: getActiveRent(lease, periodStart),
      };
    }
    if (d.getUTCFullYear() > year || (d.getUTCFullYear() === year && d.getUTCMonth() + 1 > month)) break;
    periodStart = addDaysUTC(periodEnd, 1);
    count++;
  }
  return null;
}

/**
 * The ascending `{ effectiveFrom, newRent }` event list from the canonical
 * timeline walk (manual revisions + auto-applied escalation anniversaries).
 * This is the single source of truth for "what rent applied on date X" used
 * by both `getActiveRent` and `synthesizeBillablePeriods`.
 */
function buildRevisionEvents(
  lease: LeaseContext,
  today: string
): Array<{ effectiveFrom: string; newRent: number }> {
  return walkTimeline(lease, today).map(e => ({ effectiveFrom: e.effectiveFrom, newRent: e.newRent }));
}

/**
 * The rent amount actually in effect on `date`, per the lease's revision and
 * escalation history — i.e. what should be charged for a billing period
 * starting on that date. Used for both period synthesis and for showing the
 * tenant's "Current Rent" (which must reflect today's active rate, not
 * whatever the last stored revision row happens to say).
 */
export function getActiveRent(lease: LeaseContext, date: string): number {
  const revisionEvents = buildRevisionEvents(lease, date);
  let amount = toNum(lease.baseRentAmount);
  for (const rev of revisionEvents) {
    if (rev.effectiveFrom <= date) amount = rev.newRent;
    else break;
  }
  return amount;
}

/**
 * Reconstruct every billable period from lease start through today, purely
 * for display/summary purposes. Returns one entry per period with the rent
 * amount that was actually in effect for that period (per rent-revision
 * history), the period's due date, and its billingPeriodStart (used to match
 * against any real `generated_rents` row for that period).
 *
 * This must mirror the rent generator's own "has this period actually been
 * generated yet" gate exactly (see `computePeriods` in
 * artifacts/api-server/src/lib/rent-generator.ts), or the synthesized
 * summary and the real ledger rows would disagree about which periods exist:
 *
 * - ADVANCE billing: a period exists once its first day has arrived
 *   (`periodStart <= today`) — rent is billed up front.
 * - POST-PAID billing: a period does NOT exist until its LAST day has been
 *   reached (`periodEnd <= today`) — rent is billed in arrears, so an
 *   in-progress month must not appear in Outstanding Balance, Total
 *   Expected, dashboards, or reports until the cycle actually ends.
 */
function synthesizeBillablePeriods(
  lease: LeaseContext,
  today: string
): Array<{ billingPeriodStart: string; dueDate: string; amount: number }> {
  const revisionEvents = buildRevisionEvents(lease, today);

  const rentAt = (periodStart: string): number => {
    let amount = toNum(lease.baseRentAmount);
    for (const rev of revisionEvents) {
      if (rev.effectiveFrom <= periodStart) amount = rev.newRent;
      else break;
    }
    return amount;
  };

  // Lifetime cap for synthesis (vs the generator's small per-run catch-up cap).
  const MAX_PERIODS = lease.billingCycle === "weekly" ? 780 : 600;
  return computePeriods(
    lease.leaseStart,
    null,
    lease.billingCycle,
    lease.rentCollectionType,
    today,
    MAX_PERIODS
  ).map(period => ({
    billingPeriodStart: period.start,
    dueDate: computeDueDate(period, lease.rentCollectionType, lease.gracePeriodDays),
    amount: rentAt(period.start),
  }));
}

/**
 * Tenant-row shape (DB or API) from which a LeaseContext can be built.
 * Matches the tenants table columns without depending on the DB package.
 */
export type TenantLeaseFields = {
  leaseStart: string;
  billingCycle: string;
  rentCollectionType: string;
  gracePeriodDays: number;
  rentAmount: string | number;
  rentEscalation?: boolean | null;
  escalationFrequencyYears?: number | null;
  escalationType?: string | null;
  escalationValue?: string | number | null;
  /** "automatic" | "manual" — whether anniversaries auto-apply to the timeline. */
  escalationApply?: string | null;
};

/**
 * The ONE shared LeaseContext builder. Every server module (tenants,
 * dashboard, reports, generator, cron) must build its LeaseContext here —
 * never inline — so baseRentAmount derivation stays identical everywhere.
 *
 * baseRentAmount is the rent in effect at lease inception — i.e. before ANY
 * revision (manual or automatic). The CHRONOLOGICALLY EARLIEST revision's
 * previousRent is the anchor: whatever kind of event came first, its
 * previousRent is by definition the rent before anything changed. (An
 * earlier automatic row must never be skipped in favor of a later manual
 * one — a manual revision recorded after escalations carries a
 * schedule-inclusive previousRent, which would recompound the schedule.)
 * Absent any revisions, the tenant's current rentAmount IS the base.
 */
export function buildLeaseContext(
  t: TenantLeaseFields,
  revisions: LedgerRevision[] = []
): LeaseContext {
  const sorted = [...revisions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const baseRentAmount = sorted[0]?.previousRent != null ? sorted[0].previousRent : t.rentAmount;
  return {
    leaseStart: t.leaseStart,
    billingCycle: t.billingCycle,
    rentCollectionType: t.rentCollectionType,
    gracePeriodDays: t.gracePeriodDays,
    baseRentAmount,
    revisions: sorted,
    rentEscalation: t.rentEscalation ?? false,
    escalationFrequencyYears: t.escalationFrequencyYears ?? 1,
    escalationType: t.escalationType ?? "percentage",
    escalationValue: t.escalationValue ?? 0,
    // Absent field (legacy/partial callers) = auto-apply, matching contexts
    // built before apply-mode awareness existed.
    escalationAutoApply: t.escalationApply == null ? true : t.escalationApply === "automatic",
  };
}

/**
 * The next FUTURE escalation anniversary for this lease (strictly after
 * `today`), with the rent tied to that date. Gated only on escalation being
 * enabled with non-inert terms — NOT on apply mode, because "manual" apply
 * landlords need the reminder/preview most:
 *
 * - auto-apply mode: newRent is the rent that WILL be active on that date
 *   per the canonical timeline walk (the anniversary's step included);
 * - manual apply mode: nothing auto-applies, so newRent is the SUGGESTED
 *   amount — one escalation step on top of the rent active on that date.
 *
 * Used by cron notifications and the mobile renewal preview — never
 * re-derive anniversaries or escalation formulas locally.
 */
export function nextEscalationEvent(
  lease: LeaseContext,
  today: string
): { effectiveFrom: string; newRent: number } | null {
  if (!lease.rentEscalation) return null;
  const frequencyYears = lease.escalationFrequencyYears ?? 1;
  const escalationValue = toNum(lease.escalationValue ?? 0);
  if (frequencyYears <= 0 || escalationValue === 0) return null;

  let anniversary = addYearsUTC(lease.leaseStart, frequencyYears);
  const MAX_ANNIVERSARIES = 100;
  let count = 0;
  while (anniversary <= today && count < MAX_ANNIVERSARIES) {
    anniversary = addYearsUTC(anniversary, frequencyYears);
    count++;
  }
  if (count >= MAX_ANNIVERSARIES) return null;

  const rentAtEvent = getActiveRent(lease, anniversary);
  const autoApply = lease.escalationAutoApply ?? true;
  return {
    effectiveFrom: anniversary,
    newRent: autoApply ? rentAtEvent : applyEscalationStep(rentAtEvent, lease),
  };
}

/**
 * The ONE shared ledger-sync computation: given the lease timeline and the
 * tenant's unsettled (not paid/partial) generated_rents rows, return the
 * corrections needed so every unsettled row carries the escalation- and
 * revision-correct amount for its own billing period. Pure function — the
 * caller applies the updates. Settled rows must never be passed in.
 */
export function computeLedgerCorrections(
  lease: LeaseContext,
  unsettledRows: Array<{
    id: number;
    amount: string | number;
    billingPeriodStart: string;
    billingPeriodEnd?: string;
    dueDate?: string;
  }>
): Array<{ id: number; correctAmount?: number; correctDueDate?: string }> {
  const corrections: Array<{ id: number; correctAmount?: number; correctDueDate?: string }> = [];
  for (const row of unsettledRows) {
    // Periods that predate the (possibly re-anchored, post-renewal)
    // leaseStart cannot be priced by the current timeline — leave them
    // untouched rather than rewriting pre-renewal history.
    if (row.billingPeriodStart < lease.leaseStart) continue;
    const entry: { id: number; correctAmount?: number; correctDueDate?: string } = { id: row.id };
    const correctAmount = getActiveRent(lease, row.billingPeriodStart);
    if (Math.abs(correctAmount - toNum(row.amount)) > 0.005) {
      entry.correctAmount = correctAmount;
    }
    // When the caller supplies the stored period end and due date, also
    // correct due dates that no longer match the lease's collection type /
    // grace period (e.g. after switching advance <-> post_paid). Same
    // canonical computeDueDate used at generation time — never a second
    // implementation.
    if (row.billingPeriodEnd != null && row.dueDate != null) {
      const correctDueDate = computeDueDate(
        { start: row.billingPeriodStart, end: row.billingPeriodEnd },
        lease.rentCollectionType,
        lease.gracePeriodDays
      );
      if (correctDueDate !== row.dueDate) {
        entry.correctDueDate = correctDueDate;
      }
    }
    if (entry.correctAmount !== undefined || entry.correctDueDate !== undefined) {
      corrections.push(entry);
    }
  }
  return corrections;
}

/**
 * A rent revision as stored in the DB, for display-correction purposes.
 * Mirrors `LedgerRevision` but also carries the fields the UI shows
 * (id/reason/createdAt) so the corrected list can be returned as-is.
 */
export type DisplayRevision = {
  id?: number;
  effectiveFrom: string;
  newRent: string | number;
  previousRent?: string | number;
  status?: string;
  changedBy?: string;
  reason?: string | null;
  createdAt?: string;
};

/**
 * Build the Rent Revision History exactly as it should be displayed: manual
 * revisions are passed through untouched, but automatic (escalation)
 * revisions have their `effectiveFrom` corrected to the true lease
 * anniversary date (and `previousRent`/`newRent` corrected to the
 * compounding schedule amount), instead of the date the cron job happened to
 * run. This never writes to the database — it is purely a read-time
 * correction so historical automatic revisions display consistently with
 * the escalation schedule used for balance calculations.
 *
 * The displayed automatic-revision list is driven by the *computed*
 * escalation schedule, not by how many automatic rows happen to exist in
 * the DB — the schedule is the source of truth for how many anniversaries
 * have occurred, and every one of them must show up in the history. Stored
 * automatic rows are matched positionally (sorted oldest-created-first) to
 * the schedule events (oldest-anniversary-first) purely to borrow display
 * metadata (`id`/`reason`/`createdAt`) for the rows that do have one; any
 * anniversary with no matching stored row still gets a synthesized display
 * entry so it isn't silently missing from history. If there happen to be
 * more stored automatic rows than computed anniversaries (e.g. escalation
 * was disabled after some rows were created), the excess rows are passed
 * through unmodified rather than dropped.
 */
export function buildDisplayRevisionHistory<T extends DisplayRevision>(
  lease: LeaseContext,
  revisions: T[],
  today: string
): T[] {
  const escalationEvents = lease.rentEscalation ? buildEscalationSchedule(lease, today) : [];

  const manual = revisions.filter(r => (r.changedBy ?? "manual") !== "automatic");
  const automatic = [...revisions.filter(r => (r.changedBy ?? "manual") === "automatic")]
    .sort((a, b) => (a.createdAt ?? a.effectiveFrom).localeCompare(b.createdAt ?? b.effectiveFrom));

  const correctedAutomatic: T[] = escalationEvents.map((event, i) => {
    // previousRent comes from the canonical walk — after a manual raise it
    // is the raised amount, not the prior schedule event's value.
    const previousAmount = event.previousRent;
    const stored = automatic[i];
    if (stored) {
      return { ...stored, effectiveFrom: event.effectiveFrom, newRent: event.newRent, previousRent: previousAmount };
    }
    // No stored row for this anniversary yet — synthesize a display-only
    // entry so the event still appears; this is never persisted anywhere.
    return {
      effectiveFrom: event.effectiveFrom,
      newRent: event.newRent,
      previousRent: previousAmount,
      status: "active",
      changedBy: "automatic",
      reason: `Auto-escalation: applied on ${event.effectiveFrom}`,
      createdAt: `${event.effectiveFrom}T00:00:00.000Z`,
    } as unknown as T;
  });

  // Any stored automatic rows beyond the computed schedule length (should be
  // rare — e.g. escalation disabled after rows already existed) are kept
  // as-is rather than dropped.
  const leftoverStoredAutomatic = automatic.slice(escalationEvents.length);

  return [...manual, ...correctedAutomatic, ...leftoverStoredAutomatic]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/**
 * Compute the aggregate balance summary for a tenant from their ledger
 * entries and payments. Used by tenants.ts, dashboard.ts, and any other
 * place that needs Total Expected / Total Paid / Balance Due / Months Active.
 *
 * When `lease` is provided, Total Expected / Months Active / Balance Due are
 * derived from every billable period since lease start (honoring rent
 * revision and escalation history), not just the rows that happen to already
 * exist in `generated_rents`. A real generated_rents row's actual `dueDate`
 * and `status` are always authoritative. Its `amount` is authoritative too
 * ONLY once the period is settled (`status` is "paid" or "partial") — paid
 * history must never be recalculated after the fact. For a period that is
 * still pending/overdue/upcoming, the recomputed (revision- and
 * escalation-aware) amount is used instead, since an un-synced ledger row
 * may still carry a stale pre-escalation amount that hasn't been backfilled
 * yet; the tenant's true outstanding balance must reflect the lease
 * agreement, not that staleness. When `lease` is omitted, the summary falls
 * back to the ledger-only calculation.
 */
export function computeLedgerSummary(
  generatedRents: LedgerEntry[],
  payments: LedgerPayment[],
  today: string,
  lease?: LeaseContext
): LedgerSummary {
  const totalPaid = payments.reduce((s, p) => s + toNum(p.amount), 0);

  if (!lease) {
    const monthsElapsed = generatedRents.length;
    const totalExpected = generatedRents.reduce((s, r) => s + toNum(r.amount), 0);
    const dueEntries = generatedRents.filter(r => r.dueDate <= today);
    const dueExpected = dueEntries.reduce((s, r) => s + toNum(r.amount), 0);
    // Balance Due is always Total Expected - Total Paid (never dueExpected),
    // so the two numbers displayed together on Tenant Details are never
    // internally inconsistent. `dueExpected` is retained only as a
    // "how much is currently overdue" signal for currentMonthDue below.
    const balanceDue = Math.max(0, totalExpected - totalPaid);
    const advanceBalance = Math.max(0, totalPaid - totalExpected);
    const sorted = [...generatedRents].sort((a, b) => b.billingPeriodStart.localeCompare(a.billingPeriodStart));
    const latest = sorted[0];
    const currentMonthDue =
      latest && latest.status !== "paid" && latest.dueDate <= today ? toNum(latest.amount) : 0;
    return { monthsElapsed, totalExpected, dueExpected, totalPaid, balanceDue, advanceBalance, currentMonthDue };
  }

  const mergedAll = computeEffectivePeriods(generatedRents, lease, today);

  // Strictly-future periods (start after today) are excluded from the
  // summary's expected-side totals. Such rows only exist when an advance
  // payment was allocated to a coming month — the payment itself already
  // counts in totalPaid (netting against balanceDue exactly as it did
  // before the row existed), so also adding the future period's expected
  // rent would inflate Balance Due by rent that isn't owed yet.
  const merged = mergedAll.filter(r => r.billingPeriodStart <= today);

  const monthsElapsed = merged.length;
  const totalExpected = merged.reduce((s, r) => s + r.amount, 0);
  const dueExpected = merged.filter(r => r.dueDate <= today).reduce((s, r) => s + r.amount, 0);
  // Balance Due is always Total Expected - Total Paid (never dueExpected),
  // so the two numbers displayed together on Tenant Details are never
  // internally inconsistent. `dueExpected` is retained only as a
  // "how much is currently overdue" signal for currentMonthDue below.
  const balanceDue = Math.max(0, totalExpected - totalPaid);
  const advanceBalance = Math.max(0, totalPaid - totalExpected);

  const sorted = [...merged].sort((a, b) => b.billingPeriodStart.localeCompare(a.billingPeriodStart));
  const latest = sorted[0];
  const currentMonthDue =
    latest && latest.status !== "paid" && latest.dueDate <= today ? latest.amount : 0;

  return { monthsElapsed, totalExpected, dueExpected, totalPaid, balanceDue, advanceBalance, currentMonthDue };
}

export type EffectivePeriod = {
  billingPeriodStart: string;
  dueDate: string;
  amount: number;
  /** Status of the real generated_rents row for this period, if one exists. */
  status?: string;
};

/**
 * The ONE merged view of a tenant's billable periods: every period from
 * lease start through today (per the canonical period walker), overlaid
 * with any real `generated_rents` rows. A real row's `dueDate` and `status`
 * are always authoritative; its `amount` is authoritative only once settled
 * (paid/partial) — unsettled rows use the timeline-correct amount. Real rows
 * outside the synthesis window are always included: generated_rents is the
 * single source of truth; synthesis only fills gaps, it never hides a period
 * that has actually been generated. Used by computeLedgerSummary and by
 * Reports for expected-income breakdowns.
 */
export function computeEffectivePeriods(
  generatedRents: LedgerEntry[],
  lease: LeaseContext,
  today: string
): EffectivePeriod[] {
  const actualByStart = new Map<string, LedgerEntry>();
  for (const r of generatedRents) actualByStart.set(r.billingPeriodStart, r);

  const synthesized = synthesizeBillablePeriods(lease, today);
  const synthesizedStarts = new Set(synthesized.map(p => p.billingPeriodStart));

  const merged: EffectivePeriod[] = synthesized.map(period => {
    const actual = actualByStart.get(period.billingPeriodStart);
    if (!actual) {
      return { billingPeriodStart: period.billingPeriodStart, dueDate: period.dueDate, amount: period.amount, status: undefined };
    }
    const isSettled = actual.status === "paid" || actual.status === "partial";
    return {
      billingPeriodStart: actual.billingPeriodStart,
      dueDate: actual.dueDate,
      amount: isSettled ? toNum(actual.amount) : period.amount,
      status: actual.status,
    };
  });

  for (const r of generatedRents) {
    if (!synthesizedStarts.has(r.billingPeriodStart)) {
      merged.push({ billingPeriodStart: r.billingPeriodStart, dueDate: r.dueDate, amount: toNum(r.amount), status: r.status });
    }
  }

  return merged;
}

export type MonthHistoryRow = {
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  expected: number;
  paid: number;
  runningBalance: number;
  status: "paid" | "partial" | "overdue" | "upcoming";
};

/**
 * Build the period-by-period ledger history (Month History / Rent Ledger
 * detail screens) directly from `generated_rents` entries — never by
 * re-walking billing periods client-side. Each entry's own amount, dueDate,
 * and status are authoritative.
 *
 * Payments are matched to an entry first via the `generatedRentId` FK when
 * present; unlinked payments fall back to a month/year match so legacy
 * payments recorded before that FK existed still show up correctly.
 */
export function computeMonthHistory(
  generatedRents: LedgerEntry[],
  payments: LedgerPayment[],
  today: string
): MonthHistoryRow[] {
  const sorted = [...generatedRents].sort((a, b) =>
    a.billingPeriodStart.localeCompare(b.billingPeriodStart)
  );

  const usedPaymentIndexes = new Set<number>();
  let runningBalance = 0;

  const rows: MonthHistoryRow[] = sorted.map(entry => {
    const linked = payments.filter((p, idx) => {
      if (p.generatedRentId != null && entry.id != null && p.generatedRentId === entry.id) {
        usedPaymentIndexes.add(idx);
        return true;
      }
      return false;
    });

    let matched = linked;
    if (linked.length === 0) {
      const periodStartDate = new Date(entry.billingPeriodStart + "T00:00:00");
      const periodMonth = periodStartDate.getMonth() + 1;
      const periodYear = periodStartDate.getFullYear();
      matched = payments.filter((p, idx) => {
        if (usedPaymentIndexes.has(idx)) return false;
        if (p.generatedRentId != null) return false;
        if (p.month === periodMonth && p.year === periodYear) {
          usedPaymentIndexes.add(idx);
          return true;
        }
        return false;
      });
    }

    const expected = toNum(entry.amount);
    const paid = matched.reduce((s, p) => s + toNum(p.amount), 0);
    runningBalance += expected - paid;

    let status: MonthHistoryRow["status"];
    if (entry.status === "paid" || paid >= expected) status = "paid";
    else if (paid > 0) status = "partial";
    else if (entry.dueDate <= today) status = "overdue";
    else status = "upcoming";

    return {
      billingPeriodStart: entry.billingPeriodStart,
      billingPeriodEnd: entry.billingPeriodEnd ?? entry.billingPeriodStart,
      dueDate: entry.dueDate,
      expected,
      paid,
      runningBalance,
      status,
    };
  });

  return rows.reverse();
}
