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
 * NOTE: this mirrors (does not replace) the canonical period/due-date
 * arithmetic in artifacts/api-server/src/lib/rent-generator.ts. It is used
 * ONLY to compute display totals here — it never writes to the database and
 * must never be treated as a substitute for real ledger generation.
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
};

function toNum(v: string | number): number {
  return parseFloat(String(v));
}

function addMonthsUTC(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split("T")[0];
}

function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function addYearsUTC(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().split("T")[0];
}

/**
 * Recompute the escalation schedule directly from the lease agreement's
 * terms (frequency, type, value), anchored to `leaseStart` — NOT from
 * whatever automatic `rent_revisions` rows happen to exist. Automatic
 * revisions are stamped with the date the escalation job ran, which can lag
 * (or predate cron enablement) far behind the lease's true anniversary
 * dates, so they are not reliable for historical reconstruction. This
 * produces one event per anniversary up to (and including) `today`, each
 * compounding on the previous computed amount, exactly mirroring what
 * should have happened had the lease agreement been followed to the letter.
 */
function buildEscalationSchedule(
  lease: LeaseContext,
  today: string
): Array<{ effectiveFrom: string; newRent: number }> {
  const frequencyYears = lease.escalationFrequencyYears ?? 1;
  const escalationType = lease.escalationType ?? "percentage";
  const escalationValue = toNum(lease.escalationValue ?? 0);
  if (frequencyYears <= 0 || escalationValue === 0) return [];

  const events: Array<{ effectiveFrom: string; newRent: number }> = [];
  let amount = toNum(lease.baseRentAmount);
  let anniversary = addYearsUTC(lease.leaseStart, frequencyYears);
  const MAX_ANNIVERSARIES = 100; // generous cap; a lease running 100+ escalation cycles is not realistic
  let count = 0;

  while (anniversary <= today && count < MAX_ANNIVERSARIES) {
    amount = escalationType === "fixed" ? amount + escalationValue : amount * (1 + escalationValue / 100);
    events.push({ effectiveFrom: anniversary, newRent: amount });
    anniversary = addYearsUTC(anniversary, frequencyYears);
    count++;
  }

  return events;
}

function getCycleMonths(billingCycle: string): number {
  if (billingCycle === "quarterly") return 3;
  if (billingCycle === "yearly") return 12;
  return 1; // monthly
}

function computePeriodEndForSummary(periodStart: string, billingCycle: string): string {
  if (billingCycle === "weekly") {
    return addDaysUTC(periodStart, 6);
  }
  return addDaysUTC(addMonthsUTC(periodStart, getCycleMonths(billingCycle)), -1);
}

function computeDueDateForSummary(
  period: { start: string; end: string },
  rentCollectionType: string,
  gracePeriodDays: number
): string {
  const anchor = rentCollectionType === "advance" ? period.start : period.end;
  return addDaysUTC(anchor, gracePeriodDays);
}

/**
 * Merge manual revisions (honored at their recorded date) with the
 * recomputed escalation schedule (honored at the true lease anniversary,
 * never the automatic job's stamped date) into one ascending list of
 * `{ effectiveFrom, newRent }` events. This is the single source of truth
 * for "what rent applied on date X" used by both `getActiveRent` and
 * `synthesizeBillablePeriods`.
 */
function buildRevisionEvents(
  lease: LeaseContext,
  today: string
): Array<{ effectiveFrom: string; newRent: number }> {
  // Manual revisions are explicit landlord decisions and are always honored
  // at their recorded date. Automatic revisions already in the DB are NOT
  // used here — they're superseded by `buildEscalationSchedule`, which
  // recomputes the true lease-agreement anniversaries below.
  const manualRevisionEvents = [...(lease.revisions ?? [])]
    .filter(r => (r.status ?? "active") === "active" && (r.changedBy ?? "manual") !== "automatic")
    .map(r => ({ effectiveFrom: r.effectiveFrom, newRent: toNum(r.newRent) }));

  const escalationEvents = lease.rentEscalation ? buildEscalationSchedule(lease, today) : [];

  return [...manualRevisionEvents, ...escalationEvents]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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

  const periods: Array<{ billingPeriodStart: string; dueDate: string; amount: number }> = [];
  let periodStart = lease.leaseStart;
  const MAX_PERIODS = lease.billingCycle === "weekly" ? 780 : 600; // generous cap, mirrors rent-generator's catch-up guard
  let count = 0;

  while (count < MAX_PERIODS) {
    if (periodStart > today) break;
    const periodEnd = computePeriodEndForSummary(periodStart, lease.billingCycle);
    const dueDate = computeDueDateForSummary({ start: periodStart, end: periodEnd }, lease.rentCollectionType, lease.gracePeriodDays);
    periods.push({ billingPeriodStart: periodStart, dueDate, amount: rentAt(periodStart) });
    periodStart = addDaysUTC(periodEnd, 1);
    count++;
  }

  return periods;
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
    const previousAmount = i === 0 ? toNum(lease.baseRentAmount) : escalationEvents[i - 1].newRent;
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

  const actualByStart = new Map<string, LedgerEntry>();
  for (const r of generatedRents) actualByStart.set(r.billingPeriodStart, r);

  const synthesized = synthesizeBillablePeriods(lease, today);

  const merged = synthesized.map(period => {
    const actual = actualByStart.get(period.billingPeriodStart);
    if (!actual) {
      return { billingPeriodStart: period.billingPeriodStart, dueDate: period.dueDate, amount: period.amount, status: undefined as string | undefined };
    }
    const isSettled = actual.status === "paid" || actual.status === "partial";
    return {
      billingPeriodStart: actual.billingPeriodStart,
      dueDate: actual.dueDate,
      amount: isSettled ? toNum(actual.amount) : period.amount,
      status: actual.status,
    };
  });

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
