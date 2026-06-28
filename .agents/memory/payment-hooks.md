---
name: Payment API hooks
description: Generated hook names and param types for payment endpoints after spec update
---

After adding PUT/DELETE to openapi.yaml for /payments/{id}:
- `useUpdatePayment` — operationId: updatePayment, PUT /payments/:id
- `useDeletePayment` — operationId: deletePayment, DELETE /payments/:id
- `useListPayments(params, options)` where params is `ListPaymentsParams = { tenantId?: number; propertyId?: number; month?: string; status?: string }`
- `useGetDashboardSummary(options?)` — takes **0 or 1 arg** (options only, no separate params arg). Wrong: `useGetDashboardSummary({}, { query: ... })`. Correct: `useGetDashboardSummary({ query: ... })`

**Why:** Orval generates different arities depending on whether the endpoint has query params. Dashboard summary has no params so only 1 optional options arg.
