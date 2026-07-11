/**
 * Tests for ensureGeneratedRentForPeriod — the safe early-payment gate.
 *
 * These tests validate the three return values:
 *   number  — row found or created; payment should link to it
 *   "early" — post-paid period on the lease but periodEnd > today; save as unlinked
 *   null    — no period on the lease at all; caller should reject with 400
 *
 * DB is mocked via a lightweight chain builder so these tests run in isolation
 * without a real PostgreSQL connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks must be declared before any imports that use them.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {},
  tenantsTable: { id: "id", rentCollectionType: "rentCollectionType", billingCycle: "billingCycle" },
  generatedRentsTable: { id: "id", billingPeriodStart: "billingPeriodStart", tenantId: "tenantId" },
  rentRevisionsTable: { tenantId: "tenantId", effectiveFrom: "effectiveFrom", newRent: "newRent", previousRent: "previousRent", status: "status", changedBy: "changedBy" },
  paymentsTable: { id: "id", tenantId: "tenantId", generatedRentId: "generatedRentId", month: "month", year: "year" },
  propertiesTable: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, _val) => ({ op: "eq" })),
  and: vi.fn((...args) => ({ op: "and", args })),
  desc: vi.fn(col => ({ op: "desc", col })),
  sql: Object.assign(vi.fn(parts => ({ op: "sql", parts })), {
    join: vi.fn(),
  }),
  inArray: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFindBillablePeriodForMonth = vi.fn();
const mockBuildLeaseContext = vi.fn();
const mockGetBillableRent = vi.fn();
const mockComputeDueDate = vi.fn();

vi.mock("@workspace/rent-calc", () => ({
  findBillablePeriodForMonth: (...args: any[]) => mockFindBillablePeriodForMonth(...args),
  buildLeaseContext: (...args: any[]) => mockBuildLeaseContext(...args),
  getBillableRent: (...args: any[]) => mockGetBillableRent(...args),
  computeDueDate: (...args: any[]) => mockComputeDueDate(...args),
  buildEscalationSchedule: vi.fn(),
  computePeriods: vi.fn(() => []),
  computeLedgerCorrections: vi.fn(() => []),
  type: undefined,
}));

import { ensureGeneratedRentForPeriod } from "./rent-generator";

// ---------------------------------------------------------------------------
// Mock DB builder
//
// Creates a minimal drizzle-compatible chain that:
//   • is thenable (so `const [row] = await chain` works)
//   • exposes .from() / .where() / .orderBy() / .limit() as no-ops that
//     return the same thenable so any chain length is supported
//   • .limit() returns a plain Promise for the cases that explicitly await it
// ---------------------------------------------------------------------------
function makeChain(rows: unknown[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    from:    () => chain,
    where:   () => chain,
    orderBy: () => chain,
    limit:   (_n?: number) => Promise.resolve(rows),
    then:    p.then.bind(p),
    catch:   p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return chain;
}

function makeInsertChain(insertedRows: unknown[]) {
  return {
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(insertedRows),
      }),
    }),
  };
}

interface DbCallSequence {
  tenantRow: unknown | null;
  existingRentRow?: unknown | null;
  revisionsRows?: unknown[];
  insertedRentRow?: unknown | null;
}

function makeDbClient(seq: DbCallSequence) {
  const selectQueue: unknown[][] = [
    seq.tenantRow ? [seq.tenantRow] : [],
    seq.existingRentRow ? [seq.existingRentRow] : [],
    seq.revisionsRows ?? [],
  ];
  let selectIdx = 0;

  return {
    select: vi.fn().mockImplementation(() => makeChain(selectQueue[selectIdx++] ?? [])),
    insert: vi.fn().mockImplementation(() =>
      makeInsertChain(seq.insertedRentRow ? [seq.insertedRentRow] : [])
    ),
    update: vi.fn().mockImplementation(() => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: () => Promise.resolve([]),
    })),
  };
}

// ---------------------------------------------------------------------------
// Shared tenant fixtures
// ---------------------------------------------------------------------------
const POST_PAID_TENANT = {
  id: 1,
  propertyId: 10,
  rentCollectionType: "post_paid",
  billingCycle: "monthly",
  leaseStart: "2026-01-01",
  leaseEnd: null,
  rentAmount: "10000",
  status: "active",
};

const ADVANCE_TENANT = {
  ...POST_PAID_TENANT,
  rentCollectionType: "advance",
};

// Today for tests: mid-July 2026 — July period ends 2026-07-31 (still in progress)
const TODAY = "2026-07-11";

beforeEach(() => {
  vi.setSystemTime(new Date(TODAY + "T12:00:00Z"));
  mockBuildLeaseContext.mockReturnValue({ leaseStart: "2026-01-01", billingCycle: "monthly", rentCollectionType: "post_paid" });
  mockGetBillableRent.mockReturnValue(10000);
  mockComputeDueDate.mockReturnValue("2026-08-05");
});

// ===========================================================================
// TC-1: Early post-paid payment — must NOT create the generated_rents row
// ===========================================================================
describe("TC-1: early post-paid payment (period still in progress)", () => {
  it("returns 'early' sentinel — no insert occurs", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",   // still in future relative to TODAY=2026-07-11
      dueDate: "2026-08-05",
      amount: 10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    expect(result).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("payment month/year 7/2026 is preserved as the intent — no row created", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-08-05",
      amount: 10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    expect(result).toBe("early");
    // Confirm no generated_rents row was written
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-2: After period ends — normal generation should link existing payment
// (simulated by providing an existing generated_rents row on a second call)
// ===========================================================================
describe("TC-2: after legitimate generation, existing row is found and returned", () => {
  it("returns the existing row id when the generated_rents row was created by the cron", async () => {
    const db = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      existingRentRow: { id: 55, billingPeriodStart: "2026-07-01" },
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    // Existing row found — returns its id immediately, no insert
    expect(result).toBe(55);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-3: Partial early payment — math is correct via totalPaid
// (pure calculation — verified in lib/rent-calc tests; here we verify that
//  "early" is returned regardless of the payment amount so the caller can
//  save the partial amount with generatedRentId = null)
// ===========================================================================
describe("TC-3: partial early payment — still returns 'early'", () => {
  it("returns 'early' for a partial payment against an in-progress post-paid period", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-08-05",
      amount: 14000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    expect(result).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-4: Multiple early payments for the same period
// (each payment creation calls ensureGeneratedRentForPeriod independently;
//  all must return "early" with no row created)
// ===========================================================================
describe("TC-4: multiple early payments for the same in-progress period", () => {
  const PERIOD = { start: "2026-07-01", end: "2026-07-31", dueDate: "2026-08-05", amount: 14000 };

  it("first payment returns 'early'", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });
    mockFindBillablePeriodForMonth.mockReturnValueOnce(PERIOD);
    expect(await ensureGeneratedRentForPeriod(1, 7, 2026, db as any)).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("second payment also returns 'early' — no row created between calls", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });
    mockFindBillablePeriodForMonth.mockReturnValueOnce(PERIOD);
    expect(await ensureGeneratedRentForPeriod(1, 7, 2026, db as any)).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("third payment also returns 'early'", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });
    mockFindBillablePeriodForMonth.mockReturnValueOnce(PERIOD);
    expect(await ensureGeneratedRentForPeriod(1, 7, 2026, db as any)).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-5: Payment edit — period move to post-paid in-progress
// ===========================================================================
describe("TC-5: payment edit — target period is post-paid in-progress", () => {
  it("returns 'early' for the new period so the edit handler sets generatedRentId = null", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-08-05",
      amount: 10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);
    expect(result).toBe("early");
  });

  it("returns a row id for an already-generated past period (edit target = June)", async () => {
    const db = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      existingRentRow: { id: 30, billingPeriodStart: "2026-06-01" },
    });

    const result = await ensureGeneratedRentForPeriod(1, 6, 2026, db as any);
    expect(result).toBe(30);
  });
});

// ===========================================================================
// TC-6: Delete unlinked payment
// (ensureGeneratedRentForPeriod is NOT called on delete — the route deletes
//  the payment row and only recomputes the old generatedRentId if non-null.
//  This test confirms the function still returns "early" for the period so
//  a re-record after deletion would also be unlinked.)
// ===========================================================================
describe("TC-6: after deleting unlinked payment, period still 'early'", () => {
  it("returns 'early' for the same in-progress period after a payment deletion cycle", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-08-05",
      amount: 10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);
    expect(result).toBe("early");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-7: Advance tenant regression — must behave exactly as before
// ===========================================================================
describe("TC-7: advance tenant — periodStart <= today is always eligible, row is inserted", () => {
  it("inserts and returns the new row id for an advance tenant", async () => {
    const db = makeDbClient({
      tenantRow: ADVANCE_TENANT,
      insertedRentRow: { id: 77 },
    });

    mockBuildLeaseContext.mockReturnValueOnce({ leaseStart: "2026-01-01", billingCycle: "monthly", rentCollectionType: "advance" });
    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-07-06",   // advance due date is at start+grace
      amount: 10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    // Advance tenant: July period start (2026-07-01) <= today (2026-07-11)
    // → not blocked by the early gate → row should be inserted
    expect(typeof result).toBe("number");
    expect(result).toBe(77);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// TC-8: Existing historical rows and linked payments remain unchanged
// ===========================================================================
describe("TC-8: historical generated_rents rows are returned as-is", () => {
  it("returns existing row id for a past month (Jan 2026) without touching it", async () => {
    const db = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      existingRentRow: { id: 10, billingPeriodStart: "2026-01-01" },
    });

    const result = await ensureGeneratedRentForPeriod(1, 1, 2026, db as any);

    expect(result).toBe(10);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns existing row id for Jun 2026 (already generated post-paid period)", async () => {
    const db = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      existingRentRow: { id: 45, billingPeriodStart: "2026-06-01" },
    });

    const result = await ensureGeneratedRentForPeriod(1, 6, 2026, db as any);

    expect(result).toBe(45);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-9: Period not on lease at all — must return null (400 in the route)
// ===========================================================================
describe("TC-9: period not on lease returns null", () => {
  it("returns null when findBillablePeriodForMonth finds no period (e.g. before leaseStart)", async () => {
    const db = makeDbClient({ tenantRow: POST_PAID_TENANT });

    mockFindBillablePeriodForMonth.mockReturnValueOnce(null);

    const result = await ensureGeneratedRentForPeriod(1, 12, 2025, db as any);

    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns null when tenant does not exist", async () => {
    const db = makeDbClient({ tenantRow: null });

    const result = await ensureGeneratedRentForPeriod(9999, 7, 2026, db as any);

    expect(result).toBeNull();
  });
});

// ===========================================================================
// TC-10: No duplicate generation — idempotent on repeated calls
// ===========================================================================
describe("TC-10: no duplicate generation on repeated calls", () => {
  it("returns the existing row on a second call after cron has generated the period", async () => {
    const db1 = makeDbClient({ tenantRow: POST_PAID_TENANT });
    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start: "2026-07-01",
      end:   "2026-07-31",
      dueDate: "2026-08-05",
      amount: 10000,
    });
    const first = await ensureGeneratedRentForPeriod(1, 7, 2026, db1 as any);
    expect(first).toBe("early");

    // Now simulate: cron has run, July row exists in DB
    const db2 = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      existingRentRow: { id: 88, billingPeriodStart: "2026-07-01" },
    });
    const second = await ensureGeneratedRentForPeriod(1, 7, 2026, db2 as any);
    expect(second).toBe(88);
    expect(db2.insert).not.toHaveBeenCalled();
  });

  it("early gate is evaluated every call — returns 'early' consistently while period is in progress", async () => {
    for (let i = 0; i < 3; i++) {
      const db = makeDbClient({ tenantRow: POST_PAID_TENANT });
      mockFindBillablePeriodForMonth.mockReturnValueOnce({
        start: "2026-07-01",
        end:   "2026-07-31",
        dueDate: "2026-08-05",
        amount: 10000,
      });
      const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);
      expect(result).toBe("early");
      expect(db.insert).not.toHaveBeenCalled();
    }
  });
});

// ===========================================================================
// Edge case: post-paid tenant paying for a period that JUST ended today
// (periodEnd === today → eligible for normal generation)
// ===========================================================================
describe("Edge: post-paid period that ended exactly today is eligible (not early)", () => {
  it("inserts and returns row id when periodEnd === today", async () => {
    const db = makeDbClient({
      tenantRow: POST_PAID_TENANT,
      insertedRentRow: { id: 99 },
    });

    mockFindBillablePeriodForMonth.mockReturnValueOnce({
      start:   "2026-07-01",
      end:     TODAY,         // 2026-07-11 === today → NOT > today → eligible
      dueDate: "2026-07-16",
      amount:  10000,
    });

    const result = await ensureGeneratedRentForPeriod(1, 7, 2026, db as any);

    // period.end === today is NOT early (gate is strictly > today)
    expect(typeof result).toBe("number");
    expect(result).toBe(99);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
