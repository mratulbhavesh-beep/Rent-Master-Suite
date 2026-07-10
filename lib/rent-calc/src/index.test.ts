import { describe, it, expect } from "vitest";
import {
  computeLedgerSummary,
  getActiveRent,
  buildDisplayRevisionHistory,
  buildLeaseContext,
  nextEscalationEvent,
  computeLedgerCorrections,
  computeEffectivePeriods,
  findBillablePeriodForMonth,
  type LeaseContext,
  type LedgerRevision,
  type DisplayRevision,
} from "./index";

/**
 * Yearly fixed escalation regression coverage — Mehul's exact scenario:
 * Lease Start 2024-01-01, Rent ₹10,000, Fixed ₹750/year, Auto Apply enabled.
 * Expected: 2024 @ 10000, 2025 @ 10750, 2026 @ 11500 (2027 not yet reached).
 */
function mehulLease(revisions: LedgerRevision[] = []): LeaseContext {
  return {
    leaseStart: "2024-01-01",
    billingCycle: "monthly",
    rentCollectionType: "post_paid",
    gracePeriodDays: 5,
    baseRentAmount: 10000,
    revisions,
    rentEscalation: true,
    escalationFrequencyYears: 1,
    escalationType: "fixed",
    escalationValue: 750,
  };
}

describe("yearly fixed escalation — active rent by date", () => {
  it("stays at the base rent before the first anniversary", () => {
    expect(getActiveRent(mehulLease(), "2024-01-01")).toBe(10000);
    expect(getActiveRent(mehulLease(), "2024-12-31")).toBe(10000);
  });

  it("escalates exactly on the true lease anniversary, not a day earlier", () => {
    expect(getActiveRent(mehulLease(), "2024-12-31")).toBe(10000);
    expect(getActiveRent(mehulLease(), "2025-01-01")).toBe(10750);
  });

  it("compounds year over year: 2025 @ 10750, 2026 @ 11500", () => {
    expect(getActiveRent(mehulLease(), "2025-06-15")).toBe(10750);
    expect(getActiveRent(mehulLease(), "2026-01-01")).toBe(11500);
    expect(getActiveRent(mehulLease(), "2026-07-09")).toBe(11500);
  });

  it("does not apply a future anniversary early", () => {
    expect(getActiveRent(mehulLease(), "2026-12-31")).toBe(11500);
    expect(getActiveRent(mehulLease(), "2027-01-01")).toBe(12250);
  });

  it("is unaffected by a stray automatic revision row stamped with the cron run date instead of the anniversary", () => {
    const staleAutomaticRevision: LedgerRevision = {
      effectiveFrom: "2026-07-09", // cron run date — should be ignored entirely
      newRent: 10750,
      previousRent: 10000,
      status: "active",
      changedBy: "automatic",
    };
    expect(getActiveRent(mehulLease([staleAutomaticRevision]), "2026-07-09")).toBe(11500);
  });

  it("honors an explicit manual revision at its recorded date, layered on top of escalation", () => {
    const manualRevision: LedgerRevision = {
      effectiveFrom: "2025-06-01",
      newRent: 11000,
      previousRent: 10750,
      status: "active",
      changedBy: "manual",
    };
    const lease = mehulLease([manualRevision]);
    expect(getActiveRent(lease, "2025-05-31")).toBe(10750);
    expect(getActiveRent(lease, "2025-06-01")).toBe(11000);
    // The timeline is a single chronological walk: the 2026-01-01
    // anniversary applies one +750 step to the RUNNING amount (the manual
    // 11000), so rent moves to 11750 — it never drops back to a
    // base-compounded value below the landlord's explicit raise.
    expect(getActiveRent(lease, "2026-01-01")).toBe(11750);
  });

  it("fixed vs percentage escalation types compound correctly across 3 years", () => {
    const percentageLease: LeaseContext = {
      leaseStart: "2024-01-01",
      billingCycle: "monthly",
      rentCollectionType: "advance",
      gracePeriodDays: 0,
      baseRentAmount: 10000,
      rentEscalation: true,
      escalationFrequencyYears: 1,
      escalationType: "percentage",
      escalationValue: 10,
    };
    expect(getActiveRent(percentageLease, "2024-06-01")).toBe(10000);
    expect(getActiveRent(percentageLease, "2025-01-01")).toBe(11000);
    expect(getActiveRent(percentageLease, "2026-01-01")).toBeCloseTo(12100, 5);
  });
});

describe("yearly fixed escalation — Total Expected / Balance Due (Mehul scenario)", () => {
  it("matches the exact expected total for 30 elapsed (fully-ended) months as of 2026-07-09 — post-paid, so the in-progress July cycle doesn't count yet", () => {
    const lease = mehulLease();
    const summary = computeLedgerSummary([], [], "2026-07-09", lease);
    // 12mo * 10000 + 12mo * 10750 + 6mo * 11500 = 318000 (Jan 2024 - Jun 2026;
    // July 2026 hasn't ended yet, so post-paid must not generate/count it).
    expect(summary.totalExpected).toBe(318000);
    expect(summary.monthsElapsed).toBe(30);
  });

  it("keeps Balance Due = Total Expected - Total Paid exactly, even with partial payments", () => {
    const lease = mehulLease();
    const summary = computeLedgerSummary([], [{ amount: 2000 }], "2026-07-09", lease);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
    expect(summary.balanceDue).toBe(316000);
  });

  it("never lets a stale (pre-escalation) ledger row understate the balance for an unpaid, already-ended period", () => {
    const lease = mehulLease();
    const staleLedgerRows = [
      { amount: "10000.00", dueDate: "2026-07-05", status: "overdue", billingPeriodStart: "2026-06-01" },
    ];
    const summary = computeLedgerSummary(staleLedgerRows, [], "2026-07-09", lease);
    // June has already ended, so it's a valid post-paid period. Its amount
    // must be recomputed to 11500, not the stale stored 10000.
    expect(summary.totalExpected).toBe(318000);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
  });

  it("keeps a paid period's historical amount untouched even if it predates the correct escalation", () => {
    const lease = mehulLease();
    const settledLedgerRows = [
      { amount: "10000.00", dueDate: "2026-07-05", status: "paid", billingPeriodStart: "2026-06-01" },
    ];
    const summary = computeLedgerSummary(settledLedgerRows, [{ amount: 10000 }], "2026-07-09", lease);
    // The settled row's stored 10000 must be preserved — not silently bumped to 11500.
    const juneAmount = 10000;
    const restOfMonthsExpected = 318000 - 11500; // total minus what June would have contributed at 11500
    expect(summary.totalExpected).toBe(restOfMonthsExpected + juneAmount);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
  });

  it("balanceDue and advanceBalance are mutually exclusive and both derive from totalExpected", () => {
    const lease = mehulLease();
    const overpaid = computeLedgerSummary([], [{ amount: 400000 }], "2026-07-09", lease);
    expect(overpaid.balanceDue).toBe(0);
    expect(overpaid.advanceBalance).toBe(400000 - overpaid.totalExpected);
  });

  it("excludes strictly-future generated rows from expected-side totals (advance payment to a coming month)", () => {
    const lease = mehulLease();
    // Baseline: no rows at all.
    const baseline = computeLedgerSummary([], [{ amount: 11500 }], "2026-07-09", lease);
    // An advance payment allocated to August created a real future row.
    const withFutureRow = computeLedgerSummary(
      [{ amount: "11500.00", dueDate: "2026-09-05", status: "paid", billingPeriodStart: "2026-08-01" }],
      [{ amount: 11500 }],
      "2026-07-09",
      lease
    );
    // The future row must not change any expected-side total: the payment
    // already nets against balanceDue via totalPaid.
    expect(withFutureRow.totalExpected).toBe(baseline.totalExpected);
    expect(withFutureRow.monthsElapsed).toBe(baseline.monthsElapsed);
    expect(withFutureRow.dueExpected).toBe(baseline.dueExpected);
    expect(withFutureRow.balanceDue).toBe(baseline.balanceDue);
  });
});

describe("Advance vs Post-paid billing generation gating", () => {
  const advanceLease: LeaseContext = {
    leaseStart: "2026-05-01",
    billingCycle: "monthly",
    rentCollectionType: "advance",
    gracePeriodDays: 0,
    baseRentAmount: 5000,
    revisions: [],
    rentEscalation: false,
    escalationFrequencyYears: 1,
    escalationType: "percentage",
    escalationValue: 0,
  };
  const postPaidLease: LeaseContext = { ...advanceLease, rentCollectionType: "post_paid" };

  it("advance: counts the in-progress current-month period immediately (from day 1 of the cycle)", () => {
    // As of 2026-07-09, May/Jun/Jul periods have all *started* — advance
    // bills on the first day of the cycle, so all 3 must be expected already.
    const summary = computeLedgerSummary([], [], "2026-07-09", advanceLease);
    expect(summary.monthsElapsed).toBe(3);
    expect(summary.totalExpected).toBe(15000);
  });

  it("post-paid: never counts the in-progress current-month period, only fully-ended ones", () => {
    // As of 2026-07-09, only May and June have fully ENDED; July is still
    // in progress and must not be billed or counted until 2026-07-31.
    const summary = computeLedgerSummary([], [], "2026-07-09", postPaidLease);
    expect(summary.monthsElapsed).toBe(2);
    expect(summary.totalExpected).toBe(10000);
  });

  it("post-paid: the moment the cycle ends, that period becomes expected", () => {
    const dayBefore = computeLedgerSummary([], [], "2026-07-30", postPaidLease);
    const cycleEndDay = computeLedgerSummary([], [], "2026-07-31", postPaidLease);
    expect(dayBefore.monthsElapsed).toBe(2);
    expect(cycleEndDay.monthsElapsed).toBe(3);
    expect(cycleEndDay.totalExpected).toBe(15000);
  });

  it("post-paid: currentMonthDue never reflects an ungenerated in-progress period (no Months Active x Rent Amount fallback)", () => {
    const summary = computeLedgerSummary([], [], "2026-07-09", postPaidLease);
    // Nothing due for the not-yet-ended July period; only June (already
    // ended, past its grace-adjusted due date) could contribute here.
    expect(summary.currentMonthDue).toBeLessThanOrEqual(5000);
    expect(summary.totalExpected).not.toBe(3 * 5000);
  });
});

describe("Rent Revision History display correction", () => {
  it("corrects an automatic revision's effectiveFrom to the true anniversary, not the cron run date", () => {
    const staleRow: DisplayRevision = {
      id: 1,
      effectiveFrom: "2026-07-09",
      newRent: "10750.00",
      previousRent: "10000.00",
      status: "active",
      changedBy: "automatic",
      reason: "Auto-escalation: +₹750 applied",
      createdAt: "2026-07-09T14:44:14.987Z",
    };
    const lease = mehulLease();
    const corrected = buildDisplayRevisionHistory(lease, [staleRow], "2026-07-09");
    // Only one stored automatic row exists, but two anniversaries have
    // occurred by 2026-07-09 (2025-01-01 and 2026-01-01) — both must show.
    const sortedAsc = [...corrected].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(sortedAsc).toHaveLength(2);
    expect(sortedAsc[0].effectiveFrom).toBe("2025-01-01");
    expect(sortedAsc[0].newRent).toBe(10750);
    expect(sortedAsc[1].effectiveFrom).toBe("2026-01-01");
    expect(sortedAsc[1].newRent).toBe(11500);
  });

  it("synthesizes a display-only entry for an anniversary that has no stored row at all", () => {
    const lease = mehulLease();
    // No revision rows in the DB whatsoever — both anniversaries must still
    // be synthesized for display purposes (no DB writes happen here).
    const corrected = buildDisplayRevisionHistory(lease, [] as DisplayRevision[], "2026-07-09");
    const sortedAsc = [...corrected].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(sortedAsc).toHaveLength(2);
    expect(sortedAsc[0]).toMatchObject({ effectiveFrom: "2025-01-01", newRent: 10750, previousRent: 10000, changedBy: "automatic" });
    expect(sortedAsc[1]).toMatchObject({ effectiveFrom: "2026-01-01", newRent: 11500, previousRent: 10750, changedBy: "automatic" });
  });

  it("leaves manual revisions untouched while correcting automatic ones", () => {
    const manualRow: DisplayRevision = {
      id: 2,
      effectiveFrom: "2025-06-01",
      newRent: 11000,
      previousRent: 10750,
      status: "active",
      changedBy: "manual",
      reason: "Negotiated increase",
      createdAt: "2025-06-01T00:00:00.000Z",
    };
    const lease = mehulLease();
    const corrected = buildDisplayRevisionHistory(lease, [manualRow], "2026-07-09");
    const manual = corrected.find(r => r.changedBy === "manual");
    expect(manual?.effectiveFrom).toBe("2025-06-01");
    expect(manual?.newRent).toBe(11000);
  });

  it("maps multiple automatic rows to multiple anniversaries in creation order", () => {
    const rows: DisplayRevision[] = [
      {
        id: 1,
        effectiveFrom: "2025-03-15", // cron ran late — wrong date
        newRent: "10750.00",
        previousRent: "10000.00",
        status: "active",
        changedBy: "automatic",
        createdAt: "2025-03-15T00:00:00.000Z",
      },
      {
        id: 2,
        effectiveFrom: "2026-02-20", // cron ran late again — wrong date
        newRent: "11500.00",
        previousRent: "10750.00",
        status: "active",
        changedBy: "automatic",
        createdAt: "2026-02-20T00:00:00.000Z",
      },
    ];
    const lease = mehulLease();
    const corrected = buildDisplayRevisionHistory(lease, rows, "2026-07-09");
    const sortedAsc = [...corrected].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(sortedAsc[0].effectiveFrom).toBe("2025-01-01");
    expect(sortedAsc[0].newRent).toBe(10750);
    expect(sortedAsc[1].effectiveFrom).toBe("2026-01-01");
    expect(sortedAsc[1].newRent).toBe(11500);
  });
});

describe("buildLeaseContext — the ONE shared LeaseContext builder", () => {
  const tenant = {
    leaseStart: "2024-01-01",
    billingCycle: "monthly",
    rentCollectionType: "post_paid",
    gracePeriodDays: 5,
    rentAmount: "11500.00", // current (already escalated) rent snapshot
    rentEscalation: true,
    escalationFrequencyYears: 1,
    escalationType: "fixed",
    escalationValue: "750.00",
  };

  it("uses tenant.rentAmount as base when there are no revisions", () => {
    const lease = buildLeaseContext({ ...tenant, rentAmount: "10000.00" });
    expect(lease.baseRentAmount).toBe("10000.00");
    expect(lease.revisions).toEqual([]);
    expect(lease.rentEscalation).toBe(true);
  });

  it("derives base rent from the chronologically earliest revision's previousRent", () => {
    const lease = buildLeaseContext(tenant, [
      { effectiveFrom: "2026-03-01", newRent: "13000.00", previousRent: "11500.00", status: "active", changedBy: "manual" },
      { effectiveFrom: "2025-01-05", newRent: "10750.00", previousRent: "10000.00", status: "active", changedBy: "manual" },
    ]);
    expect(lease.baseRentAmount).toBe("10000.00");
    // Revisions come back sorted ascending by effectiveFrom
    expect(lease.revisions!.map(r => r.effectiveFrom)).toEqual(["2025-01-05", "2026-03-01"]);
  });

  it("anchors base on an earlier AUTOMATIC row over a later manual one", () => {
    // A manual revision recorded after escalations carries a
    // schedule-inclusive previousRent (11500) — using it as base would
    // recompound the schedule. The earliest row of ANY kind is the anchor.
    const lease = buildLeaseContext(tenant, [
      { effectiveFrom: "2025-02-10", newRent: "10750.00", previousRent: "10000.00", status: "active", changedBy: "automatic" },
      { effectiveFrom: "2026-05-01", newRent: "12500.00", previousRent: "11500.00", status: "active", changedBy: "manual" },
    ]);
    expect(lease.baseRentAmount).toBe("10000.00");
  });

  it("maps escalationApply to escalationAutoApply (default true when absent)", () => {
    expect(buildLeaseContext({ ...tenant, escalationApply: "manual" }).escalationAutoApply).toBe(false);
    expect(buildLeaseContext({ ...tenant, escalationApply: "automatic" }).escalationAutoApply).toBe(true);
    expect(buildLeaseContext({ ...tenant, escalationApply: null }).escalationAutoApply).toBe(true);
    expect(buildLeaseContext(tenant).escalationAutoApply).toBe(true);
  });

  it("falls back to the earliest revision of any kind when no manual exists", () => {
    const lease = buildLeaseContext(tenant, [
      { effectiveFrom: "2025-02-10", newRent: "10750.00", previousRent: "10000.00", status: "active", changedBy: "automatic" },
    ]);
    expect(lease.baseRentAmount).toBe("10000.00");
  });

  it("normalizes null escalation fields to safe defaults", () => {
    const lease = buildLeaseContext({
      ...tenant,
      rentEscalation: null,
      escalationFrequencyYears: null,
      escalationType: null,
      escalationValue: null,
    });
    expect(lease.rentEscalation).toBe(false);
    expect(lease.escalationFrequencyYears).toBe(1);
    expect(lease.escalationType).toBe("percentage");
    expect(lease.escalationValue).toBe(0);
  });
});

describe("nextEscalationEvent — future anniversary + engine-computed new rent", () => {
  it("returns the first anniversary strictly after today with the escalated rent", () => {
    const evt = nextEscalationEvent(mehulLease(), "2026-07-09");
    expect(evt).toEqual({ effectiveFrom: "2027-01-01", newRent: 12250 });
  });

  it("treats an anniversary landing ON today as already applied (strictly after)", () => {
    const evt = nextEscalationEvent(mehulLease(), "2026-01-01");
    expect(evt).toEqual({ effectiveFrom: "2027-01-01", newRent: 12250 });
  });

  it("returns null when escalation is disabled or value is zero", () => {
    expect(nextEscalationEvent({ ...mehulLease(), rentEscalation: false }, "2026-07-09")).toBeNull();
    expect(nextEscalationEvent({ ...mehulLease(), escalationValue: 0 }, "2026-07-09")).toBeNull();
    expect(nextEscalationEvent({ ...mehulLease(), escalationFrequencyYears: 0 }, "2026-07-09")).toBeNull();
  });

  it("respects multi-year frequency", () => {
    const evt = nextEscalationEvent({ ...mehulLease(), escalationFrequencyYears: 2 }, "2026-07-09");
    expect(evt?.effectiveFrom).toBe("2028-01-01");
    expect(evt?.newRent).toBe(11500); // two 2-year steps: 2026 @ +750, 2028 @ +750
  });

  it("escalates ON TOP of a manual raise — rent never drops back at the next anniversary", () => {
    const lease = mehulLease([
      { effectiveFrom: "2026-06-01", newRent: 15000, previousRent: 11500, status: "active", changedBy: "manual" },
    ]);
    // Timeline walk: 2025 → 10750, 2026 → 11500, manual 2026-06-01 → 15000,
    // then the 2027 anniversary steps the RUNNING amount: 15000 + 750.
    expect(getActiveRent(lease, "2026-12-31")).toBe(15000);
    expect(getActiveRent(lease, "2027-01-01")).toBe(15750);
    const evt = nextEscalationEvent(lease, "2026-07-09");
    expect(evt).toEqual({ effectiveFrom: "2027-01-01", newRent: 15750 });
  });

  it("manual revision wins when it lands exactly on an anniversary", () => {
    const lease = mehulLease([
      { effectiveFrom: "2026-01-01", newRent: 20000, previousRent: 11500, status: "active", changedBy: "manual" },
    ]);
    // Same-date tie: escalation step first, then the manual decision overrides.
    expect(getActiveRent(lease, "2026-01-01")).toBe(20000);
    expect(getActiveRent(lease, "2027-01-01")).toBe(20750);
  });

  it("manual apply mode: schedule never auto-applies; next event is a suggestion", () => {
    const lease = { ...mehulLease(), escalationAutoApply: false };
    // Timeline stays flat at base — anniversaries do not apply automatically.
    expect(getActiveRent(lease, "2025-06-15")).toBe(10000);
    expect(getActiveRent(lease, "2026-07-09")).toBe(10000);
    // But the reminder/preview still fires, suggesting one step on top.
    const evt = nextEscalationEvent(lease, "2026-07-09");
    expect(evt).toEqual({ effectiveFrom: "2027-01-01", newRent: 10750 });
  });

  it("manual apply mode: manual revisions still shape the timeline and the suggestion", () => {
    const lease = {
      ...mehulLease([
        { effectiveFrom: "2025-03-01", newRent: 12000, previousRent: 10000, status: "active", changedBy: "manual" },
      ]),
      escalationAutoApply: false,
    };
    expect(getActiveRent(lease, "2026-07-09")).toBe(12000);
    const evt = nextEscalationEvent(lease, "2026-07-09");
    expect(evt).toEqual({ effectiveFrom: "2027-01-01", newRent: 12750 });
  });
});

describe("computeLedgerCorrections — the ONE ledger-sync computation", () => {
  it("corrects unsettled rows to the timeline amount for their own period", () => {
    const corrections = computeLedgerCorrections(mehulLease(), [
      { id: 1, amount: "10000.00", billingPeriodStart: "2024-06-01" }, // correct already
      { id: 2, amount: "10000.00", billingPeriodStart: "2025-06-01" }, // stale, should be 10750
      { id: 3, amount: "10750.00", billingPeriodStart: "2026-06-01" }, // stale, should be 11500
    ]);
    expect(corrections).toEqual([
      { id: 2, correctAmount: 10750 },
      { id: 3, correctAmount: 11500 },
    ]);
  });

  it("tolerates sub-paisa float noise (0.005)", () => {
    const corrections = computeLedgerCorrections(mehulLease(), [
      { id: 1, amount: 10750.004, billingPeriodStart: "2025-06-01" },
    ]);
    expect(corrections).toEqual([]);
  });

  it("returns no corrections for an empty row set", () => {
    expect(computeLedgerCorrections(mehulLease(), [])).toEqual([]);
  });

  it("corrects a stale due date after a collection-type flip (advance -> post_paid)", () => {
    // Row generated under ADVANCE rules (due at period start + grace) while
    // the lease is POST-PAID (due at period end + grace).
    const corrections = computeLedgerCorrections(mehulLease(), [
      {
        id: 1,
        amount: "10000.00", // timeline-correct, so only the due date moves
        billingPeriodStart: "2024-06-01",
        billingPeriodEnd: "2024-06-30",
        dueDate: "2024-06-06",
      },
    ]);
    expect(corrections).toEqual([{ id: 1, correctDueDate: "2024-07-05" }]);
  });

  it("corrects amount and due date together in a single entry", () => {
    const corrections = computeLedgerCorrections(mehulLease(), [
      {
        id: 1,
        amount: "10000.00", // stale: 2025-06 period is 10750 after escalation
        billingPeriodStart: "2025-06-01",
        billingPeriodEnd: "2025-06-30",
        dueDate: "2025-06-06", // stale advance-style due date
      },
    ]);
    expect(corrections).toEqual([
      { id: 1, correctAmount: 10750, correctDueDate: "2025-07-05" },
    ]);
  });

  it("leaves a row alone when amount and due date both already match", () => {
    const corrections = computeLedgerCorrections(mehulLease(), [
      {
        id: 1,
        amount: "10000.00",
        billingPeriodStart: "2024-06-01",
        billingPeriodEnd: "2024-06-30",
        dueDate: "2024-07-05",
      },
    ]);
    expect(corrections).toEqual([]);
  });

  it("never touches rows from periods before the (re-anchored) leaseStart", () => {
    // Post-renewal, leaseStart moves forward; pre-renewal unsettled rows
    // cannot be priced by the current timeline and must be left alone.
    const lease = { ...mehulLease(), leaseStart: "2026-01-01" };
    const corrections = computeLedgerCorrections(lease, [
      { id: 1, amount: "9000.00", billingPeriodStart: "2025-06-01" }, // pre-leaseStart: skipped
      { id: 2, amount: "9000.00", billingPeriodStart: "2026-06-01" }, // in-lease: corrected
    ]);
    expect(corrections).toEqual([{ id: 2, correctAmount: getActiveRent(lease, "2026-06-01") }]);
  });
});

describe("findBillablePeriodForMonth — payment-allocation period lookup", () => {
  it("returns the in-progress period for a post-paid tenant (before period end)", () => {
    // mehulLease is post_paid; July 2026 period runs 07-01..07-31 and would
    // NOT be generated until 07-31 — but a payment made mid-month must
    // still find it.
    const p = findBillablePeriodForMonth(mehulLease(), 7, 2026, "2026-07-10");
    expect(p).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
      dueDate: "2026-08-05",
      amount: getActiveRent(mehulLease(), "2026-07-01"),
    });
  });

  it("returns the future period for an advance payment targeting a coming month", () => {
    // Advance payments may target months whose period hasn't started yet;
    // they must still land on a real ledger row (one payment, one row).
    const p = findBillablePeriodForMonth(mehulLease(), 8, 2026, "2026-07-10");
    expect(p).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      dueDate: "2026-09-05",
      amount: getActiveRent(mehulLease(), "2026-08-01"),
    });
  });

  it("returns null for a month before lease start", () => {
    expect(findBillablePeriodForMonth(mehulLease(), 12, 2023, "2026-07-10")).toBeNull();
  });

  it("uses the timeline-correct escalated amount for past periods", () => {
    // 2025-06 period: after the 2025-01-01 anniversary (+750) => 10750
    const p = findBillablePeriodForMonth(mehulLease(), 6, 2025, "2026-07-10");
    expect(p?.start).toBe("2025-06-01");
    expect(p?.amount).toBe(10750);
    expect(p?.dueDate).toBe("2025-07-05"); // post_paid: period end + 5 grace days
  });

  it("anchors the due date to period start for advance tenants", () => {
    const lease = { ...mehulLease(), rentCollectionType: "advance" };
    const p = findBillablePeriodForMonth(lease, 7, 2026, "2026-07-10");
    expect(p?.dueDate).toBe("2026-07-06"); // period start + 5 grace days
  });
});

describe("computeEffectivePeriods — merged synthesized + real periods", () => {
  it("overlays real rows: settled amount authoritative, unsettled recomputed", () => {
    const periods = computeEffectivePeriods(
      [
        // Settled at the old (pre-escalation) amount — must be preserved
        { billingPeriodStart: "2024-12-01", dueDate: "2025-01-05", amount: "10000.00", status: "paid" },
        // Unsettled with a stale amount — must be recomputed to 10750
        { billingPeriodStart: "2025-01-01", dueDate: "2025-02-05", amount: "10000.00", status: "pending" },
      ],
      mehulLease(),
      "2025-02-15"
    );
    const byStart = new Map(periods.map(p => [p.billingPeriodStart, p]));
    expect(byStart.get("2024-12-01")?.amount).toBe(10000);
    expect(byStart.get("2024-12-01")?.status).toBe("paid");
    expect(byStart.get("2025-01-01")?.amount).toBe(10750);
    // Synthesized gap periods carry timeline amounts
    expect(byStart.get("2024-06-01")?.amount).toBe(10000);
  });

  it("never hides a real row outside the synthesis window", () => {
    const periods = computeEffectivePeriods(
      [
        // A future-period row that synthesis (through today) would not produce
        { billingPeriodStart: "2025-06-01", dueDate: "2025-07-05", amount: "10750.00", status: "pending" },
      ],
      mehulLease(),
      "2025-02-15"
    );
    expect(periods.some(p => p.billingPeriodStart === "2025-06-01")).toBe(true);
  });

  it("summary totals equal the sum of effective periods (engine self-consistency)", () => {
    const rents = [
      { billingPeriodStart: "2024-12-01", dueDate: "2025-01-05", amount: "10000.00", status: "paid" },
      { billingPeriodStart: "2025-01-01", dueDate: "2025-02-05", amount: "10000.00", status: "pending" },
    ];
    const today = "2025-02-15";
    const periods = computeEffectivePeriods(rents, mehulLease(), today);
    const summary = computeLedgerSummary(rents, [], today, mehulLease());
    expect(summary.totalExpected).toBeCloseTo(periods.reduce((s, p) => s + p.amount, 0), 6);
    expect(summary.monthsElapsed).toBe(periods.length);
  });
});

describe("lease renewal re-anchoring — carried rent must survive the leaseStart move", () => {
  // Bug regression: renewing an auto-apply tenant whose rent had escalated
  // (base 10000 → anchor rows → 11500) moves leaseStart to the new lease's
  // first day. The walk then has no anniversaries yet, so WITHOUT a renewal
  // revision the active rent collapses back to base. The renew route now
  // ALWAYS records the renewal revision (even when the amount is unchanged),
  // plus a carry-over revision when renewal happens before newLeaseStart.
  const anchorRows: LedgerRevision[] = [
    { effectiveFrom: "2025-01-01", newRent: 10750, previousRent: 10000, status: "active", changedBy: "automatic" },
    { effectiveFrom: "2026-01-01", newRent: 11500, previousRent: 10750, status: "active", changedBy: "automatic" },
  ];

  function renewedLease(extraRevisions: LedgerRevision[]): LeaseContext {
    // leaseStart re-anchored to the renewed lease's first day (2026-09-01);
    // anchor rows from the previous lease are still in the table.
    return { ...mehulLease([...anchorRows, ...extraRevisions]), leaseStart: "2026-09-01" };
  }

  it("same-amount renewal revision carries the escalated rent across the re-anchor", () => {
    const lease = renewedLease([
      { effectiveFrom: "2026-09-01", newRent: 11500, previousRent: 11500, status: "active", changedBy: "manual" },
    ]);
    expect(getActiveRent(lease, "2026-09-01")).toBe(11500);
    expect(getActiveRent(lease, "2026-12-31")).toBe(11500);
    // Next anniversary is anchored to the NEW leaseStart and steps the carried rent
    expect(nextEscalationEvent(lease, "2026-09-02")).toEqual({ effectiveFrom: "2027-09-01", newRent: 12250 });
  });

  it("documents the failure mode: without the renewal revision the rent collapses to base", () => {
    const lease = renewedLease([]);
    // Automatic rows are excluded from the walk and no anniversary of the
    // new lease has passed — this is exactly why the route must always
    // record the renewal revision.
    expect(getActiveRent(lease, "2026-09-01")).toBe(10000);
  });

  it("early renewal: carry-over revision at the renewal date keeps the gap window at the carried rent", () => {
    // Renewal executed 2026-07-10, new lease starts 2026-09-01.
    const lease = renewedLease([
      { effectiveFrom: "2026-07-10", newRent: 11500, previousRent: 11500, status: "active", changedBy: "manual" },
      { effectiveFrom: "2026-09-01", newRent: 11500, previousRent: 11500, status: "active", changedBy: "manual" },
    ]);
    // Gap window between renewal date and new lease start
    expect(getActiveRent(lease, "2026-07-10")).toBe(11500);
    expect(getActiveRent(lease, "2026-08-15")).toBe(11500);
    // And after the new lease begins
    expect(getActiveRent(lease, "2026-10-01")).toBe(11500);
    // Base anchor unchanged: earliest revision previousRent is still 10000
    expect(buildLeaseContext({
      leaseStart: "2026-09-01",
      billingCycle: "monthly",
      rentCollectionType: "post_paid",
      gracePeriodDays: 5,
      rentAmount: "11500.00",
      rentEscalation: true,
      escalationFrequencyYears: 1,
      escalationType: "fixed",
      escalationValue: "750.00",
    }, [
      { effectiveFrom: "2025-01-01", newRent: "10750.00", previousRent: "10000.00", status: "active", changedBy: "automatic" },
      { effectiveFrom: "2026-07-10", newRent: "11500.00", previousRent: "11500.00", status: "active", changedBy: "manual" },
    ]).baseRentAmount).toBe("10000.00");
  });

  it("renewal WITH a rent change records the new amount from the new lease start", () => {
    const lease = renewedLease([
      { effectiveFrom: "2026-09-01", newRent: 13000, previousRent: 11500, status: "active", changedBy: "manual" },
    ]);
    expect(getActiveRent(lease, "2026-08-31")).toBe(10000); // pre-start, no carry-over in this scenario
    expect(getActiveRent(lease, "2026-09-01")).toBe(13000);
  });
});
