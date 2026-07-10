---
name: Edit vs Revise separation
description: Why a plain field-edit endpoint must not be allowed to silently mutate revision/history rows once they exist, and how to guard it.
---

When a resource has both (a) a plain "edit settings" endpoint and (b) a dedicated "create a timeline event" endpoint (e.g. Edit Tenant vs. Rent Revision, or any base-value + revision-log pattern), a naive full-rebuild-on-edit is only safe while zero history rows exist — in that state the base field IS the anchor, so editing it is equivalent to "creating a new record with this value."

Once history rows exist, the base field is no longer the source of truth for the current value — the timeline is. Letting a plain edit endpoint recompute/rebuild the timeline from a changed base field will retroactively rewrite historical event rows (e.g. escalation revisions) even though the user never asked to change history.

**Why:** This was shipped once and only caught by an architect review that spotted automatic revision rows getting silently rewritten with new previousRent/newRent values after a routine tenant-info edit — the bug was invisible from the edited-field's perspective (the field updated "correctly"), only visible by inspecting the untouched-looking history table.

**How to apply:** Before letting a plain edit endpoint touch a field that doubles as a timeline anchor: check if history rows exist for the entity. If none exist, allow the full edit/rebuild (safe, equivalent to creation). If history exists, compare the incoming value against the current *effective* value derived from the timeline (not the raw base column) — reject (or silently drop) mismatched edits and point the user to the dedicated revision endpoint. Also watch for the resulting "empty update" edge case: if guarding logic strips the only changed field from the payload, an unconditional `UPDATE ... SET {}` will error — fall back to a plain read in that branch.
