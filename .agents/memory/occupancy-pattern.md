---
name: Occupancy pattern
description: How occupied unit counts are computed and exposed
---

Backend: `GET /api/properties` joins tenantsTable, filters `status = 'active'`, groups by propertyId, returns `occupiedUnits: number` alongside standard Property fields. This field is **not** in the OpenAPI Property schema required list (it's optional/additive).

Frontend: `(item as any).occupiedUnits ?? 0` in the properties tab card. Typed as `integer` in the Property schema so the generated type does include it as optional.

**Why:** Simpler than a separate endpoint. The count is always fresh since the list is refetched on focus.
