---
name: Payment allocation invariants
description: How payments bind to generated_rents ledger rows and the totals-neutrality rule for early-generated periods
---

## Rule
Every payment must belong to exactly one `generated_rents` row. Allocation resolves via the shared engine (`findBillablePeriodForMonth` → `ensureGeneratedRentForPeriod`) — past, in-progress, AND future periods are allocatable (any period on the lease timeline for the payment's month/year). Writes that can't resolve a period (e.g. pre-lease month) are rejected with 400, never inserted unlinked.

**Why:** Post-paid tenants' rows aren't generated until the period ends, and advance payments may target future months — without allocation-time row creation, payments counted in Total Paid but vanished from Month History (the original user-reported bug).

## Totals-neutrality (critical pairing)
Expected-side totals (Months Active / Total Expected / Balance Due) are gated by `isPeriodBillable` — the ONE collection-type gate identical to `computePeriods`: advance → periodStart <= today; post_paid → periodEnd <= today. `computeEffectivePeriods` applies it to real rows outside the synthesis window, so every consumer (summary, dashboard, reports) inherits it. An early-materialized row (post-paid in-progress month, or future month paid in advance) is display-only in Month History until the gate passes; its payment still counts in totalPaid, netting against balanceDue. Consequence (by design): Month History running balance can differ from summary balanceDue by the not-yet-billable expected amount.

## How to apply
- Payment POST/PUT/DELETE all recompute affected row statuses via `recomputeGeneratedRentStatus` (status derived purely from linked payments) — never set paid/partial manually.
- Rent generation adopts still-unlinked payments matching a newly generated period's month/year (safety net for legacy rows).
- Client-supplied `generatedRentId` is validated to belong to the payment's tenant (cross-tenant guard).
- Verification queries: 0 unlinked payments, 0 cross-tenant links, per-tenant sum(payments) == sum(ledger-allocated).

## Running one-off scripts against api-server code
No tsx in the repo. Bundle with esbuild + `esbuild-plugin-pino` (same as build.mjs) — a naive bundle crashes on pino's worker transport (`Cannot find module .../lib/worker.js`), and `packages: 'external'` fails because pnpm strict node_modules doesn't expose transitive deps (pg) to api-server.
