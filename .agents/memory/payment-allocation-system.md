---
name: Payment Allocation System
description: Architecture and invariants for the 5-phase payment allocation system (FIFO + Specific Period modes).
---

## Core design

- `payment_allocations` table: `(payment_id, generated_rent_id, allocated_amount)` with UNIQUE(payment_id, generated_rent_id) and CASCADE FK on payment_id.
- `payments.generatedRentId` = primary period pointer (first allocated period for FIFO, the selected period for Specific mode, null for Pending Adjustment or pure advance credit).
- `recomputeGeneratedRentStatus` reads `payment_allocations WHERE generated_rent_id = X` — NOT `payments.generatedRentId` — to derive paid/partial/pending/overdue.
- Advance credit is **implicit**: `payment.amount - SUM(payment_allocations.allocated_amount)`. Do NOT create special "advance" allocation rows.

## Allocation modes (POST /payments)

| allocationMode | targetGeneratedRentId | Behavior |
|---|---|---|
| "auto" | — | FIFO: allocates to oldest outstanding periods in order |
| "specific" | set | Specific period; excess = advance credit |
| "specific" | not set | ensureGeneratedRentForPeriod(month/year) → "early" = Pending Adjustment, null = reject 400 |
| not set | — | Backward-compat: existing generatedRentId from body or ensureGeneratedRentForPeriod |

## PUT /payments invariant

Transactional: clearAllocations → collect affected period IDs → UPDATE payment → re-allocate (FIFO if was multi-period, specific to same period if single) → recomputeGeneratedRentStatus for ALL affected period IDs (old + new).

## computeLedgerSummary works correctly for FIFO multi-period

`advanceBalance = max(0, linkedPaid - totalExpected)` correctly captures excess as advance balance when `generatedRentId` is set to first allocated period (not null → not pendingAdjustment). No changes to rent-calc needed.

## Key files

- `artifacts/api-server/src/lib/payment-allocator.ts` — allocatePaymentFIFO, allocateToSpecificPeriod, clearAllocations, getBillingPeriods
- `artifacts/api-server/src/routes/payments.ts` — POST/PUT/DELETE with allocation logic
- `artifacts/api-server/src/routes/tenants.ts` — GET /tenants/:id/billing-periods
- `artifacts/mobile/app/payment-add.tsx` — Auto/Specific mode UI with billing period picker
- `artifacts/mobile/app/payment-receipt.tsx` — "APPLIED TO PERIODS" section for multi-period receipts

## Test file

`artifacts/api-server/src/lib/payment-allocator.test.ts` — 16 tests covering FIFO, specific, clearAllocations, getBillingPeriods. Uses vi.mock for @workspace/db and drizzle-orm.
