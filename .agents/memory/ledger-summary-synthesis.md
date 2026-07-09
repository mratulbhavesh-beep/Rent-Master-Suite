---
name: Ledger summary must synthesize full lease history, not just sum stored rows
description: computeLedgerSummary (or equivalent) must reconstruct billable periods from leaseStart, since generated_rents rows are lazily/partially populated
---

`generated_rents` (or any per-period billing ledger table) is populated lazily — it typically only
holds rows for a recent window, not the tenant's/lease's entire history. Summary statistics
("Months Active", "Total Expected", "Outstanding Balance") must NOT be derived by simply summing
whatever rows currently exist in that table, or they will silently undercount for older leases.

**Why:** A tenant with `leaseStart` in 2024 but only 7 `generated_rents` rows (2026-01 onward)
showed "Months Active: 7" and a `totalExpected` reflecting only 7 months — both wrong. The root
cause was that summary logic treated the ledger table as authoritative for lease duration instead
of treating it as a partial/lazy cache of periods.

**How to apply:** When computing lease-lifetime summary stats, synthesize the full set of billable
periods from `leaseStart` to today (mirroring the period/due-date arithmetic used by the actual
rent generator, including rent-revision/escalation history for per-period amounts), then merge with
actual ledger rows (actual rows win for status/paid amounts) to get correct `monthsElapsed`,
`totalExpected`, `dueExpected`, and `balanceDue`. Keep this synthesis logic in a shared calculation
library, duplicating pure period-arithmetic helpers rather than importing from the app-level rent
generator, to avoid inverting workspace dependency direction (lib importing from app). Any endpoint
that reports these summary stats (tenant detail, tenant list, dashboard aggregates) needs the same
lease context (leaseStart, billingCycle, collection type, grace period, revision history) passed in
— it's easy to update one call site and miss others that compute the same numbers independently.
