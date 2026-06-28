---
name: Payment pre-selection from URL params
description: How tenant/property pre-selection works in payment-add screen
---

payment-add.tsx reads `tenantId` and `propertyId` from `useLocalSearchParams()` and initializes state from them. A `useEffect` auto-fills `amount` from the tenant's rentAmount once tenants load.

Navigate from tenant-detail: `/payment-add?tenantId=${tenantId}&propertyId=${tenant.propertyId}`
Navigate from property-detail (vacant unit): `/tenant-add?propertyId=${propertyId}`

tenant-add.tsx similarly reads `propertyId` from params and pre-selects.

**Why:** Avoids user having to re-select already-known context when navigating from a detail screen.
