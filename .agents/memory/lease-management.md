---
name: Lease Management module
description: Auto-renewal, rent escalation, renewal history — implementation patterns and gotchas
---

## Architecture

- `lib/db/src/schema/tenants.ts` — 7 new columns: `autoRenewal`, `renewalDuration`, `rentEscalation`, `escalationType`, `escalationValue`, `escalationApply`, `renewalNotice`
- `lib/db/src/schema/lease-renewals.ts` — `leaseRenewals` table (tenantId FK, previousRent, newRent, increaseAmount, increasePercent, renewedBy, notes, etc.)
- `artifacts/api-server/src/routes/tenants.ts` — GET `/tenants/:id/renewals` and POST `/tenants/:id/renew`; escalation math runs server-side
- `artifacts/mobile/app/tenant-detail.tsx` — all UI: expiry banner, inline renewal form, Lease Management view card, Renewal History card, full edit section

## DB Push

DB push (`pnpm --filter @workspace/db run push`) requires an interactive TTY and hangs in scripts. Always use raw SQL via `executeSql` tool instead.

**Why:** Drizzle kit push prompts for confirmation; no TTY in agent bash → hangs forever.

**How to apply:** For any schema change, generate the SQL diff mentally and run it via `executeSql` directly.

## Renewal Logic

POST `/tenants/:id/renew`:
- `newLeaseStart` = `leaseEnd` + 1 day
- `newLeaseEnd` = `newLeaseStart` + `renewalDuration` (weekly/monthly/yearly)
- If `rentEscalation && escalationApply === "automatic"`: apply percentage or fixed increase automatically
- If caller passes `newRentAmount`: use that instead (manual override)
- Updates `tenants.leaseStart`, `tenants.leaseEnd`, `tenants.rentAmount` in-place
- Inserts a row into `lease_renewals` with before/after snapshot

## Mobile UI Pattern

- Expiry banner: computed inline as IIFE, shown only when `daysToExpiry <= renewalNotice`. Color: red=expired, orange≤7d, yellow≤30d.
- `showRenewalForm` state controls inline renewal card (quick-action without navigating to edit mode)
- Edit mode: toggle switches for autoRenewal/rentEscalation, chip selectors for duration/type/apply, preset+custom input for escalation value, live rent preview
