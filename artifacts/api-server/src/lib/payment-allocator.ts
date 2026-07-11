import { eq, and, asc, sql } from "drizzle-orm";
import { db, generatedRentsTable, paymentAllocationsTable } from "@workspace/db";
import { recomputeGeneratedRentStatus } from "./rent-generator";

export type DbClient = Pick<typeof db, "select" | "update" | "insert" | "delete">;

/**
 * Sum all allocations for a given generated rent period, optionally
 * excluding one payment (used during edit to see what OTHER payments have
 * allocated to avoid double-counting the payment being edited).
 */
async function sumExistingAllocations(
  dbClient: DbClient,
  generatedRentId: number,
  excludePaymentId?: number
): Promise<number> {
  const rows = await dbClient
    .select({ allocated: paymentAllocationsTable.allocatedAmount })
    .from(paymentAllocationsTable)
    .where(
      excludePaymentId != null
        ? and(
            eq(paymentAllocationsTable.generatedRentId, generatedRentId),
            sql`${paymentAllocationsTable.paymentId} != ${excludePaymentId}`
          )
        : eq(paymentAllocationsTable.generatedRentId, generatedRentId)
    );
  return rows.reduce((s, r) => s + parseFloat(String(r.allocated)), 0);
}

export interface FifoResult {
  allocatedPeriods: Array<{ generatedRentId: number; allocatedAmount: number }>;
  totalAllocated: number;
  firstGeneratedRentId: number | null;
}

/**
 * FIFO allocation — applies the payment amount to the oldest outstanding
 * generated rent periods first, then continues to the next until money is
 * exhausted or all outstanding dues are cleared. Only allocates to ALREADY
 * GENERATED periods — never forces creation of a new generated_rents row.
 *
 * Excess beyond all outstanding dues is left unallocated and becomes advance
 * credit (implicit: payments.amount − total_allocated).
 */
export async function allocatePaymentFIFO(
  dbClient: DbClient,
  paymentId: number,
  tenantId: number,
  totalAmount: number
): Promise<FifoResult> {
  const outstanding = await dbClient
    .select({
      id: generatedRentsTable.id,
      amount: generatedRentsTable.amount,
    })
    .from(generatedRentsTable)
    .where(
      and(
        eq(generatedRentsTable.tenantId, tenantId),
        sql`${generatedRentsTable.status} IN ('pending', 'partial', 'overdue')`
      )
    )
    .orderBy(asc(generatedRentsTable.billingPeriodStart));

  let remaining = totalAmount;
  const allocatedPeriods: Array<{ generatedRentId: number; allocatedAmount: number }> = [];

  for (const period of outstanding) {
    if (remaining <= 0.005) break;
    const alreadyPaid = await sumExistingAllocations(dbClient, period.id);
    const periodRemaining = parseFloat(String(period.amount)) - alreadyPaid;
    if (periodRemaining <= 0.005) continue;
    const alloc = Math.min(remaining, periodRemaining);
    await dbClient.insert(paymentAllocationsTable).values({
      paymentId,
      generatedRentId: period.id,
      allocatedAmount: alloc.toFixed(2),
    }).onConflictDoNothing();
    allocatedPeriods.push({ generatedRentId: period.id, allocatedAmount: alloc });
    remaining -= alloc;
    await recomputeGeneratedRentStatus(period.id, dbClient);
  }

  return {
    allocatedPeriods,
    totalAllocated: totalAmount - Math.max(0, remaining),
    firstGeneratedRentId: allocatedPeriods[0]?.generatedRentId ?? null,
  };
}

export interface SpecificResult {
  allocatedAmount: number;
  excessAmount: number;
}

/**
 * Specific-period allocation — applies the payment amount to one chosen
 * generated rent period. If the payment amount exceeds the period's remaining
 * due, the excess becomes implicit advance credit (caller keeps
 * generatedRentId pointing at the selected period).
 */
export async function allocateToSpecificPeriod(
  dbClient: DbClient,
  paymentId: number,
  generatedRentId: number,
  totalAmount: number
): Promise<SpecificResult> {
  const [period] = await dbClient
    .select({ amount: generatedRentsTable.amount })
    .from(generatedRentsTable)
    .where(eq(generatedRentsTable.id, generatedRentId));

  if (!period) return { allocatedAmount: 0, excessAmount: totalAmount };

  const alreadyPaid = await sumExistingAllocations(dbClient, generatedRentId);
  const periodRemaining = Math.max(0, parseFloat(String(period.amount)) - alreadyPaid);
  const alloc = Math.min(totalAmount, periodRemaining);

  if (alloc > 0.005) {
    await dbClient.insert(paymentAllocationsTable).values({
      paymentId,
      generatedRentId,
      allocatedAmount: alloc.toFixed(2),
    }).onConflictDoNothing();
    await recomputeGeneratedRentStatus(generatedRentId, dbClient);
  }

  return { allocatedAmount: alloc, excessAmount: totalAmount - alloc };
}

/**
 * Fetch and delete all allocation rows for a payment, returning the distinct
 * generated_rent_ids that were affected. Used before editing a payment so
 * old statuses can be recomputed after allocations are cleared.
 *
 * Safe to call when no allocations exist (returns empty array).
 */
export async function clearAllocations(
  dbClient: DbClient,
  paymentId: number
): Promise<number[]> {
  const existing = await dbClient
    .select({ generatedRentId: paymentAllocationsTable.generatedRentId })
    .from(paymentAllocationsTable)
    .where(eq(paymentAllocationsTable.paymentId, paymentId));

  if (existing.length === 0) return [];

  await dbClient.delete(paymentAllocationsTable)
    .where(eq(paymentAllocationsTable.paymentId, paymentId));

  return [...new Set(existing.map(r => r.generatedRentId))];
}

/**
 * GET /tenants/:id/billing-periods data builder.
 * Returns every generated rent period with its per-period remaining due
 * (factoring in all existing allocations). Used for the period selector in
 * the Record Payment and Edit Payment UIs.
 */
export async function getBillingPeriods(
  dbClient: DbClient,
  tenantId: number
) {
  const periods = await dbClient
    .select({
      id: generatedRentsTable.id,
      amount: generatedRentsTable.amount,
      billingPeriodStart: generatedRentsTable.billingPeriodStart,
      billingPeriodEnd: generatedRentsTable.billingPeriodEnd,
      dueDate: generatedRentsTable.dueDate,
      status: generatedRentsTable.status,
      billingCycle: generatedRentsTable.billingCycle,
    })
    .from(generatedRentsTable)
    .where(eq(generatedRentsTable.tenantId, tenantId))
    .orderBy(asc(generatedRentsTable.billingPeriodStart));

  return Promise.all(periods.map(async (p) => {
    const alreadyPaid = await sumExistingAllocations(dbClient, p.id);
    const expected = parseFloat(String(p.amount));
    const remaining = Math.max(0, expected - alreadyPaid);
    return {
      id: p.id,
      billingPeriodStart: p.billingPeriodStart,
      billingPeriodEnd: p.billingPeriodEnd,
      dueDate: p.dueDate,
      status: p.status,
      billingCycle: p.billingCycle,
      expectedAmount: expected,
      paidAmount: parseFloat(alreadyPaid.toFixed(2)),
      remainingDue: parseFloat(remaining.toFixed(2)),
    };
  }));
}
