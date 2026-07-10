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
actual ledger rows for `dueDate`/`status` (always authoritative) and `amount` — but only use the
ledger row's stored `amount` once the period is *settled* (`status` is `paid`/`partial`); for
pending/overdue/upcoming rows, use the recomputed (revision/escalation-aware) amount instead. Keep
this synthesis logic in a shared calculation library, duplicating pure period-arithmetic helpers
rather than importing from the app-level rent generator, to avoid inverting workspace dependency
direction (lib importing from app). Any endpoint that reports these summary stats (tenant detail,
tenant list, dashboard aggregates) needs the same lease context (leaseStart, billingCycle,
collection type, grace period, revision history) passed in — it's easy to update one call site and
miss others that compute the same numbers independently.

**Escalation dates must be recomputed from lease terms, not read from automatic revision rows.**
An automatic escalation cron job that stamps `rent_revisions.effectiveFrom` with the job's run date
(rather than the true lease anniversary) produces correct final rent amounts but wrong historical
timing — e.g. a ₹750/yr escalation from a 2024-01-01 lease should land on 2025-01-01, 2026-01-01,
etc., not "whenever the cron happened to run." Fix by recomputing an escalation schedule purely from
`leaseStart` + `escalationFrequencyYears`/`type`/`value` (ignore stored automatic-revision dates
entirely), and merge that with genuinely manual revisions (`changedBy !== "automatic"`) which DO
keep their recorded `effectiveFrom`. Don't touch the cron job itself if the task says not to modify
ledger/revision generation — recompute at the read/summary layer instead.

**`balanceDue` must always equal `max(0, totalExpected - totalPaid)`, never a separate
"currentMonthDue"/"dueExpected" concept.** A prior implementation computed balance from only
overdue/current-period rows (`dueExpected`), which broke for post-paid tenants and any tenant with
history predating the ledger table's lazy window. Keep the narrower "amount due this billing cycle"
signal (if needed for UI) as a separately named field — never let it leak into the headline Balance
Due / Advance Balance shown to the user. `advanceBalance = max(0, totalPaid - totalExpected)` is the
dual and the two must be mutually exclusive.

**Display-time correction without touching stored rows:** `getActiveRent(lease, date)` recomputes
today's true rent straight from `leaseStart` + escalation terms (never from the last stored revision
row, which may lag). `buildDisplayRevisionHistory(lease, revisions, today)` renders the *existing*
revision rows with automatic ones' `effectiveFrom`/`newRent`/`previousRent` corrected to true
anniversaries, leaving manual rows untouched. Both are pure read-time helpers in the shared calc lib;
every endpoint returning "current rent" or "revision history" must route through them instead of
reading the raw column/table.

**The displayed automatic-revision list must be driven by the computed escalation schedule's length,
not by how many automatic rows exist in the DB.** An earlier version of `buildDisplayRevisionHistory`
only remapped *existing* automatic rows positionally onto schedule events — if the automatic-revision
cron had only ever fired once (e.g. one stored row) but two anniversaries had actually elapsed, only
one history entry displayed even though `getActiveRent` already reflected the second escalation. Fixed
by iterating over `escalationEvents` (the schedule) as the primary list, borrowing `id`/`reason`/
`createdAt` from a matching stored row by position when one exists, and synthesizing a display-only
entry (never persisted) for any anniversary with no stored row yet. Any leftover stored automatic rows
beyond the schedule length are still appended unmodified. **Why:** history length must always equal
"anniversaries elapsed by today", independent of whether the generation job happened to run for each
one — the display and the active-rent calculation must never disagree on how many escalations occurred.

**Advance vs post-paid must gate period *existence*, not just amount/timing.** Advance billing
generates a period on its FIRST day (`periodStart <= today`); post-paid must generate ONLY once the
period's LAST day is reached (`periodEnd <= today`) — this gate belongs in both the real generator
and the synthesis fallback, and the two must mirror each other exactly, or Outstanding/Total
Expected/Current Due will show an in-progress post-paid month before it's actually billed. Never
fall back to "Months Active x Rent Amount" for post-paid — Outstanding must always derive from
periods that actually exist (generated or correctly gated synthesized), never a flat multiply.
**Why:** a pre-fix generator created post-paid rows on day 1 of the cycle (same as advance), so
Outstanding/Dashboard Due leaked next month's not-yet-earned rent immediately; fixing only the
generator without also fixing `synthesizeBillablePeriods` (used for backfill/gap-filling in the
same summary) reintroduces the bug for any period synthesis touches. **How to apply:** when
adding any new lease-derived period arithmetic, always branch on `rentCollectionType` and gate
existence (not just display) accordingly; also union real `generated_rents` rows into merged
periods even when a row falls outside the synthesized window (e.g. legacy data from before a gating
fix shipped) — the generated table is always authoritative and must never be silently hidden by a
tightened synthesis window, even though the synthesis window itself must never manufacture premature
periods going forward. A stale-data cleanup (deleting incorrectly early-generated pending rows) may
be needed once when shipping such a fix, since existing rows won't retroactively fix themselves.
