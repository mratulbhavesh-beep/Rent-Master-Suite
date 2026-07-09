import { describe, it, expect } from "vitest";
import {
  computeLedgerSummary,
  getActiveRent,
  buildDisplayRevisionHistory,
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
    // The escalation schedule is computed from the lease's base terms
    // independently of manual revisions; whichever event is chronologically
    // latest as of `date` wins. The 2026-01-01 escalation (11500) therefore
    // supersedes the earlier manual bump rather than stacking on top of it.
    expect(getActiveRent(lease, "2026-01-01")).toBe(11500);
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
  it("matches the exact expected total for 31 elapsed months as of 2026-07-09", () => {
    const lease = mehulLease();
    const summary = computeLedgerSummary([], [], "2026-07-09", lease);
    // 12mo * 10000 + 12mo * 10750 + 7mo * 11500 = 329500
    expect(summary.totalExpected).toBe(329500);
    expect(summary.monthsElapsed).toBe(31);
  });

  it("keeps Balance Due = Total Expected - Total Paid exactly, even with partial payments", () => {
    const lease = mehulLease();
    const summary = computeLedgerSummary([], [{ amount: 2000 }], "2026-07-09", lease);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
    expect(summary.balanceDue).toBe(327500);
  });

  it("never lets a stale (pre-escalation) ledger row understate the balance for an unpaid period", () => {
    const lease = mehulLease();
    const staleLedgerRows = [
      { amount: "10000.00", dueDate: "2026-08-05", status: "overdue", billingPeriodStart: "2026-07-01" },
    ];
    const summary = computeLedgerSummary(staleLedgerRows, [], "2026-07-09", lease);
    // Period amount must be recomputed to 11500, not the stale stored 10000.
    expect(summary.totalExpected).toBe(329500);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
  });

  it("keeps a paid period's historical amount untouched even if it predates the correct escalation", () => {
    const lease = mehulLease();
    const settledLedgerRows = [
      { amount: "10000.00", dueDate: "2026-08-05", status: "paid", billingPeriodStart: "2026-07-01" },
    ];
    const summary = computeLedgerSummary(settledLedgerRows, [{ amount: 10000 }], "2026-07-09", lease);
    // The settled row's stored 10000 must be preserved — not silently bumped to 11500.
    const julyAmount = 10000;
    const restOfYearsExpected = 329500 - 11500; // total minus what july would have contributed at 11500
    expect(summary.totalExpected).toBe(restOfYearsExpected + julyAmount);
    expect(summary.balanceDue).toBe(summary.totalExpected - summary.totalPaid);
  });

  it("balanceDue and advanceBalance are mutually exclusive and both derive from totalExpected", () => {
    const lease = mehulLease();
    const overpaid = computeLedgerSummary([], [{ amount: 400000 }], "2026-07-09", lease);
    expect(overpaid.balanceDue).toBe(0);
    expect(overpaid.advanceBalance).toBe(400000 - overpaid.totalExpected);
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
    // Only one automatic row exists, so it maps to the first anniversary (2025-01-01),
    // matching the earliest computed escalation event.
    expect(corrected[corrected.length - 1].effectiveFrom).toBe("2025-01-01");
    expect(corrected[corrected.length - 1].newRent).toBe(10750);
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
