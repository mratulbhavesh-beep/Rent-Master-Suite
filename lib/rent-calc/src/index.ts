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
  /** Sum of every generated ledger entry to date, regardless of due date. */
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

function toNum(v: string | number): number {
  return parseFloat(String(v));
}

/**
 * Compute the aggregate balance summary for a tenant from their ledger
 * entries and payments. Used by tenants.ts, dashboard.ts, and any other
 * place that needs Total Expected / Total Paid / Balance Due.
 */
export function computeLedgerSummary(
  generatedRents: LedgerEntry[],
  payments: LedgerPayment[],
  today: string
): LedgerSummary {
  const monthsElapsed = generatedRents.length;

  const totalExpected = generatedRents.reduce((s, r) => s + toNum(r.amount), 0);

  const dueEntries = generatedRents.filter(r => r.dueDate <= today);
  const dueExpected = dueEntries.reduce((s, r) => s + toNum(r.amount), 0);

  const totalPaid = payments.reduce((s, p) => s + toNum(p.amount), 0);

  const balanceDue = Math.max(0, dueExpected - totalPaid);
  const advanceBalance = Math.max(0, totalPaid - dueExpected);

  const sorted = [...generatedRents].sort((a, b) =>
    b.billingPeriodStart.localeCompare(a.billingPeriodStart)
  );
  const latest = sorted[0];
  const currentMonthDue =
    latest && latest.status !== "paid" && latest.dueDate <= today
      ? toNum(latest.amount)
      : 0;

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
