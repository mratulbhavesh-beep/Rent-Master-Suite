---
name: Unified billing engine invariants
description: Rules that keep lib/rent-calc's timeline walk, tenants.rent_amount anchor, and renewal flow consistent — violating them silently corrupts rents.
---

# Unified billing engine (lib/rent-calc) invariants

## The timeline is a chronological WALK, not an independent schedule
`walkTimeline` starts at `baseRentAmount`; manual revisions SET the running amount at their date; escalation anniversaries step the RUNNING amount (only when `rentEscalation && escalationAutoApply`). Same-date tie: escalation first, so a manual revision wins. Automatic revision rows are excluded from the walk (they are re-derived); manual rows are included even when dated before `leaseStart`.

**Why:** compounding a schedule independently of manual revisions double-escalated rents after a manual apply.

## `tenants.rent_amount` is the BASE anchor when zero revisions exist
`resyncTenantLedger` writes `tenant.rentAmount` ONLY when at least one revision row exists. With revisions present, base is derived from the chronologically earliest revision's `previousRent` (any kind, manual or automatic).

**Why:** overwriting rent_amount with the escalated value on a zero-revision tenant destroys the base — every later computation compounds from the wrong number. Required a data repair once.

## `escalationApply` (DB default `'manual'`) gates auto-walk; consumers MUST select it
`buildLeaseContext` maps `escalationApply === 'automatic'` → `escalationAutoApply`, but absent/undefined defaults to **true**. Any query that feeds tenants into the engine must include `escalationApply` in its SELECT, or manual-apply tenants get auto-walked (dashboard totals diverged from tenant detail this way).

**How to apply:** when adding a new engine consumer, pass the full tenant row or explicitly include all escalation columns.

## Lease renewal must ALWAYS write a revision, even when rent is unchanged
Renewal moves `leaseStart`, re-anchoring anniversaries — the walk then has no steps, so without a revision the rent collapses back to base on the next resync. The renew route always upserts a manual revision at `newLeaseStart` (same-amount is fine — it anchors the carried rent), plus a carry-over revision at the renewal date when renewing early (`renewalDate < newLeaseStart`) so the gap window and rent_amount snapshot keep the escalated rent. Upserts match only active MANUAL rows on the date, never automatic anchor rows.

## Known follow-up (audit-quality only, non-blocking)
`recordAutomaticEscalations` matches automatic rows to the schedule positionally. After a renewal, once the first new-lease anniversary passes, it can rewrite the oldest pre-renewal anchor row's date, erasing that escalation from audit history (balances/active rent stay correct). Hardening idea: skip normalizing automatic rows dated before the current `leaseStart`.
