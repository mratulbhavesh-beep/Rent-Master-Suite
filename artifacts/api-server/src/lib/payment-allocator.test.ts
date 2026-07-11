/**
 * Tests for the payment allocation engine (payment-allocator.ts):
 *
 *   allocatePaymentFIFO  — oldest-outstanding-first FIFO
 *   allocateToSpecificPeriod — targeted single-period allocation
 *   clearAllocations     — wipe and return affected period IDs
 *   getBillingPeriods    — list periods with remaining-due amounts
 *
 * All DB operations are mocked via a lightweight chain builder; no real
 * PostgreSQL connection is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted before any imports that touch them)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {},
  generatedRentsTable: {
    id: "gr_id",
    tenantId: "gr_tenantId",
    status: "gr_status",
    amount: "gr_amount",
    billingPeriodStart: "gr_bps",
    billingPeriodEnd: "gr_bpe",
    dueDate: "gr_dueDate",
    billingCycle: "gr_billingCycle",
  },
  paymentAllocationsTable: {
    paymentId: "pa_paymentId",
    generatedRentId: "pa_generatedRentId",
    allocatedAmount: "pa_allocatedAmount",
  },
  paymentsTable: { id: "p_id" },
  tenantsTable: { id: "t_id" },
  propertiesTable: { id: "prop_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, _val) => ({ op: "eq" })),
  and: vi.fn((...args) => ({ op: "and", args })),
  asc: vi.fn(col => ({ op: "asc", col })),
  sql: Object.assign(vi.fn(parts => ({ op: "sql", parts })), {
    join: vi.fn(),
  }),
  inArray: vi.fn(),
}));

// recomputeGeneratedRentStatus is called inside the allocator but we don't
// need to test it here — mock it as a no-op.
vi.mock("./rent-generator", () => ({
  recomputeGeneratedRentStatus: vi.fn().mockResolvedValue(undefined),
  ensureGeneratedRentForPeriod: vi.fn(),
  runRentGenerationForTenant: vi.fn(),
  resyncTenantLedger: vi.fn(),
  rebuildTenantBilling: vi.fn(),
}));

import {
  allocatePaymentFIFO,
  allocateToSpecificPeriod,
  clearAllocations,
  getBillingPeriods,
} from "./payment-allocator";

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

/** Creates a drizzle-style select chain that returns `rows` as the resolved value. */
function makeSelectChain(rows: unknown[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    from:    () => chain,
    where:   () => chain,
    orderBy: () => chain,
    limit:   () => Promise.resolve(rows),
    then:    p.then.bind(p),
    catch:   p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return chain;
}

/** Creates a minimal insert chain (insert → values → onConflictDoNothing). */
function makeInsertChain() {
  return {
    values: () => ({ onConflictDoNothing: () => Promise.resolve([]) }),
  };
}

/** Creates a minimal delete chain (delete → where). */
function makeDeleteChain() {
  return { where: () => Promise.resolve([]) };
}

// ---------------------------------------------------------------------------
// DB client factories for each test scenario
// ---------------------------------------------------------------------------

/**
 * Build a mock DB client whose select() calls are answered from a queue.
 * Each call to dbClient.select() pops from the front of `selectQueues`.
 */
function makeDbClient(selectQueues: unknown[][], insertFn?: () => any) {
  let idx = 0;
  return {
    select: vi.fn().mockImplementation(() => makeSelectChain(selectQueues[idx++] ?? [])),
    insert: vi.fn().mockImplementation(() => insertFn ? insertFn() : makeInsertChain()),
    delete: vi.fn().mockImplementation(() => makeDeleteChain()),
    update: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PERIOD_JAN: Record<string, unknown> = {
  id: 101,
  amount: "10000",
  billingPeriodStart: "2026-01-01",
  billingPeriodEnd: "2026-01-31",
  dueDate: "2026-02-05",
  status: "pending",
  billingCycle: "monthly",
};

const PERIOD_FEB: Record<string, unknown> = {
  id: 102,
  amount: "10000",
  billingPeriodStart: "2026-02-01",
  billingPeriodEnd: "2026-02-28",
  dueDate: "2026-03-05",
  status: "overdue",
  billingCycle: "monthly",
};

const PERIOD_MAR: Record<string, unknown> = {
  id: 103,
  amount: "10000",
  billingPeriodStart: "2026-03-01",
  billingPeriodEnd: "2026-03-31",
  dueDate: "2026-04-05",
  status: "partial",
  billingCycle: "monthly",
};

// ===========================================================================
// allocatePaymentFIFO
// ===========================================================================

describe("allocatePaymentFIFO", () => {
  it("allocates to the oldest outstanding period first", async () => {
    const db = makeDbClient([
      // 1. Outstanding periods query → Jan + Feb pending
      [PERIOD_JAN, PERIOD_FEB],
      // 2. sumExistingAllocations for Jan → 0 already paid
      [],
      // 3. sumExistingAllocations for Feb → 0 already paid (but payment exhausted)
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 10000);

    expect(result.allocatedPeriods).toHaveLength(1);
    expect(result.allocatedPeriods[0]!.generatedRentId).toBe(101);
    expect(result.allocatedPeriods[0]!.allocatedAmount).toBe(10000);
    expect(result.firstGeneratedRentId).toBe(101);
    expect(result.totalAllocated).toBe(10000);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("spans multiple periods when payment exceeds one period's due", async () => {
    const db = makeDbClient([
      // Outstanding: Jan + Feb (both ₹10,000)
      [PERIOD_JAN, PERIOD_FEB],
      // sumAllocations for Jan → 0
      [],
      // sumAllocations for Feb → 0
      [],
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 25000);

    expect(result.allocatedPeriods).toHaveLength(2);
    expect(result.allocatedPeriods[0]!.allocatedAmount).toBe(10000);
    expect(result.allocatedPeriods[1]!.allocatedAmount).toBe(10000);
    expect(result.totalAllocated).toBe(20000);
    // ₹5,000 is advance credit (implicit — unallocated remainder)
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("skips a period whose remaining due is already 0 from other payments", async () => {
    const db = makeDbClient([
      // Outstanding: Jan + Feb
      [PERIOD_JAN, PERIOD_FEB],
      // sumAllocations for Jan → 10000 (already fully paid by another payment)
      [{ allocated: "10000" }],
      // sumAllocations for Feb → 0
      [],
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 10000);

    // Jan was already fully paid — should skip it and allocate to Feb
    expect(result.allocatedPeriods).toHaveLength(1);
    expect(result.allocatedPeriods[0]!.generatedRentId).toBe(102);
    expect(result.firstGeneratedRentId).toBe(102);
  });

  it("returns zero allocations when no outstanding periods exist", async () => {
    const db = makeDbClient([
      // Outstanding: none
      [],
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 5000);

    expect(result.allocatedPeriods).toHaveLength(0);
    expect(result.firstGeneratedRentId).toBeNull();
    expect(result.totalAllocated).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("partially covers a period when payment is less than what is due", async () => {
    const db = makeDbClient([
      [PERIOD_JAN],  // outstanding
      [],            // sumAllocations → 0
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 6000);

    expect(result.allocatedPeriods).toHaveLength(1);
    expect(result.allocatedPeriods[0]!.allocatedAmount).toBe(6000);
    expect(result.totalAllocated).toBe(6000);
  });

  it("handles partial prior allocation on a period correctly", async () => {
    // Jan has ₹10,000 expected; ₹4,000 already paid by another payment → ₹6,000 remaining
    const db = makeDbClient([
      [PERIOD_JAN],
      [{ allocated: "4000" }],  // sumAllocations → 4000
    ]);

    const result = await allocatePaymentFIFO(db as any, 999, 1, 8000);

    expect(result.allocatedPeriods[0]!.allocatedAmount).toBe(6000); // capped to remaining
    expect(result.totalAllocated).toBe(6000);
    // ₹2,000 is advance credit
  });
});

// ===========================================================================
// allocateToSpecificPeriod
// ===========================================================================

describe("allocateToSpecificPeriod", () => {
  it("allocates the full amount when payment ≤ remaining due", async () => {
    const db = makeDbClient([
      [{ amount: "10000" }],  // period lookup
      [],                      // sumAllocations → 0
    ]);

    const result = await allocateToSpecificPeriod(db as any, 999, 101, 10000);

    expect(result.allocatedAmount).toBe(10000);
    expect(result.excessAmount).toBe(0);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("caps allocation to remaining due; excess becomes advance credit", async () => {
    const db = makeDbClient([
      [{ amount: "10000" }],  // period amount
      [],                      // sumAllocations → 0
    ]);

    const result = await allocateToSpecificPeriod(db as any, 999, 101, 15000);

    expect(result.allocatedAmount).toBe(10000);
    expect(result.excessAmount).toBe(5000);
  });

  it("accounts for prior allocations from other payments", async () => {
    const db = makeDbClient([
      [{ amount: "10000" }],
      [{ allocated: "4000" }],  // 4000 already paid by another payment
    ]);

    const result = await allocateToSpecificPeriod(db as any, 999, 101, 8000);

    expect(result.allocatedAmount).toBe(6000); // 10000 − 4000 = 6000 remaining
    expect(result.excessAmount).toBe(2000);
  });

  it("returns 0 allocation when the period does not exist", async () => {
    const db = makeDbClient([
      [],  // period not found
    ]);

    const result = await allocateToSpecificPeriod(db as any, 999, 999, 5000);

    expect(result.allocatedAmount).toBe(0);
    expect(result.excessAmount).toBe(5000);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not insert when remaining due is ≤ 0", async () => {
    const db = makeDbClient([
      [{ amount: "10000" }],
      [{ allocated: "10000" }],  // already fully paid
    ]);

    const result = await allocateToSpecificPeriod(db as any, 999, 101, 5000);

    expect(result.allocatedAmount).toBe(0);
    expect(result.excessAmount).toBe(5000);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// clearAllocations
// ===========================================================================

describe("clearAllocations", () => {
  it("deletes allocation rows and returns affected generatedRentIds", async () => {
    const db = makeDbClient([
      // select existing allocations
      [{ generatedRentId: 101 }, { generatedRentId: 102 }, { generatedRentId: 101 }],
    ]);

    const affected = await clearAllocations(db as any, 999);

    expect(db.delete).toHaveBeenCalledTimes(1);
    // Deduplicated: [101, 102]
    expect(affected.sort()).toEqual([101, 102]);
  });

  it("returns empty array and skips delete when no allocations exist", async () => {
    const db = makeDbClient([[]]);  // no rows

    const affected = await clearAllocations(db as any, 999);

    expect(db.delete).not.toHaveBeenCalled();
    expect(affected).toEqual([]);
  });
});

// ===========================================================================
// getBillingPeriods
// ===========================================================================

describe("getBillingPeriods", () => {
  it("returns periods with correct remaining-due amounts", async () => {
    const db = makeDbClient([
      // All periods for tenant
      [PERIOD_JAN, PERIOD_FEB],
      // sumAllocations for Jan → 6000 paid
      [{ allocated: "6000" }],
      // sumAllocations for Feb → 0 paid
      [],
    ]);

    const periods = await getBillingPeriods(db as any, 1);

    expect(periods).toHaveLength(2);
    expect(periods[0]!.id).toBe(101);
    expect(periods[0]!.expectedAmount).toBe(10000);
    expect(periods[0]!.paidAmount).toBe(6000);
    expect(periods[0]!.remainingDue).toBe(4000);

    expect(periods[1]!.id).toBe(102);
    expect(periods[1]!.paidAmount).toBe(0);
    expect(periods[1]!.remainingDue).toBe(10000);
  });

  it("shows remainingDue = 0 for a fully paid period", async () => {
    const db = makeDbClient([
      [PERIOD_MAR],
      [{ allocated: "10000" }],  // fully paid
    ]);

    const periods = await getBillingPeriods(db as any, 1);

    expect(periods[0]!.remainingDue).toBe(0);
    expect(periods[0]!.paidAmount).toBe(10000);
  });

  it("returns empty array when tenant has no generated periods", async () => {
    const db = makeDbClient([[]]);

    const periods = await getBillingPeriods(db as any, 1);

    expect(periods).toHaveLength(0);
  });
});
