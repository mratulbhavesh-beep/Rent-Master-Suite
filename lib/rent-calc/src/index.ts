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
  /** Subset of totalExpected whose due date has already passed. */
  dueExpected: number;
  /** Sum of all recorded payments. */
  totalPaid: number;
  /** What the tenant currently owes: max(0, dueExpected - totalPaid). */
  balanceDue: number;
  /** Credit the tenant is carrying: max(0, totalPaid - dueExpected). */
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
  const revisions = [...(lease.revisions ?? [])]
    .filter(r => (r.status ?? "active") === "active")
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  const rentAt = (periodStart: string): number => {
    let amount = toNum(lease.baseRentAmount);
    for (const rev of revisions) {
      if (rev.effectiveFrom <= periodStart) amount = toNum(rev.newRent);
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
 * Compute the aggregate balance summary for a tenant from their ledger
 * entries and payments. Used by tenants.ts, dashboard.ts, and any other
 * place that needs Total Expected / Total Paid / Balance Due / Months Active.
 *
 * When `lease` is provided, Total Expected / Months Active / Balance Due are
 * derived from every billable period since lease start (honoring rent
 * revision history), not just the rows that happen to already exist in
 * `generated_rents`. Where a real generated_rents row exists for a period,
 * its actual amount/status/dueDate are authoritative (so paid/partial rows
 * and their linked payments are never recalculated). When `lease` is
 * omitted, the summary falls back to the ledger-only calculation.
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
    const balanceDue = Math.max(0, dueExpected - totalPaid);
    const advanceBalance = Math.max(0, totalPaid - dueExpected);
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
    return actual
      ? { billingPeriodStart: actual.billingPeriodStart, dueDate: actual.dueDate, amount: toNum(actual.amount), status: actual.status }
      : { billingPeriodStart: period.billingPeriodStart, dueDate: period.dueDate, amount: period.amount, status: undefined as string | undefined };
  });

  const monthsElapsed = merged.length;
  const totalExpected = merged.reduce((s, r) => s + r.amount, 0);
  const dueExpected = merged.filter(r => r.dueDate <= today).reduce((s, r) => s + r.amount, 0);
  const balanceDue = Math.max(0, dueExpected - totalPaid);
  const advanceBalance = Math.max(0, totalPaid - dueExpected);

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
