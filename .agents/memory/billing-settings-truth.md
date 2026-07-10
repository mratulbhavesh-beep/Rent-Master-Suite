---
name: Billing settings single source of truth
description: How useBusinessDefault / business-default billing settings are resolved (write-time materialization, never read-time)
---

# Billing settings: tenant row is the single source of truth

The tenant columns `billing_cycle` / `rent_collection_type` / `grace_period_days` are ALWAYS the values in force. `use_business_default` is a follow-flag only — it is never resolved at read time.

**Rule:** business defaults are materialized at WRITE time:
- Tenant create/update with `useBusinessDefault=true` → server copies current business defaults into the tenant's own columns.
- Explicit billing fields in a create/patch without the flag → flag is forced to `false` (custom override).
- Business-settings PUT → propagates new defaults into every follower tenant's columns, then regenerates/resyncs each.

**Why:** read-time resolution was once duplicated in only some readers (rent generator, one mobile card) while others read raw columns — the same tenant showed "Advance" on one screen and "Post-paid" on another. Any new reader that "helpfully" resolves business defaults reintroduces the bug.

**How to apply:** never resolve business defaults when reading/displaying tenant billing settings — read the tenant columns. New write paths that touch `useBusinessDefault` or billing fields must go through the same materialization pattern (see business-defaults helper in the api-server lib).

Related: `computeLedgerCorrections` also corrects due dates (and resync recomputes pending/overdue) so advance↔post_paid flips self-heal unsettled ledger rows — the overdue marker elsewhere is one-directional and cannot un-overdue a row by itself.
