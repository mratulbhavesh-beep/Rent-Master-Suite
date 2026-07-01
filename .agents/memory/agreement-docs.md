---
name: Agreement & Document Management
description: Patterns and gotchas for the rent agreements and tenant documents feature added to Gemini Rent Manager
---

## Schema
- `lib/db/src/schema/rent-agreements.ts` — tenantId FK, agreementNumber, startDate, endDate, monthlyRent, securityDeposit, notes; `status` is computed (not stored), derived from endDate vs today
- `lib/db/src/schema/tenant-documents.ts` — tenantId FK, documentType enum (aadhaar/pan/photo/agreement/other), fileName (UUID on disk), originalName, mimeType, fileSize

## API Routes
- `artifacts/api-server/src/routes/agreements.ts` — GET/POST /tenants/:id/agreements, PATCH/DELETE /agreements/:id
- `artifacts/api-server/src/routes/documents.ts` — multer upload, GET/POST /tenants/:id/documents/upload, GET /documents/:id/file, DELETE /documents/:id
- Files uploaded to `artifacts/api-server/uploads/` directory

## Auth middleware
- `requireAuth` also accepts JWT via `?token=` query param (for file serving and image display in mobile)

## TypeScript gotcha
- `req.params.id` in Express 5 types as `string | string[]`. Always use `safeId()` helper: `parseInt(Array.isArray(raw) ? raw[0] : raw, 10)` 

## tenants.ts enrichment
- GET /tenants now fetches latest agreement per tenant and includes `activeAgreementEndDate` and `activeAgreementStatus` in responses
- Supports `?expiringIn30Days=true` filter — returns only tenants whose latest agreement ends within 30 days

## Mobile screens
- `tenant-detail.tsx` — 3-tab layout (Overview | Agreement | Documents); uploads via `fetch` + FormData with `Authorization: Bearer ${token}` header; image thumbnails via `expo-image` with auth headers
- `(tabs)/tenants.tsx` — filter chips: All | Expiring (30d) | Overdue; Expiring uses API param, Overdue is client-side filter on balanceDue
- `property-detail.tsx` — tenant cards show agreement expiry indicator using `(tenant as any).activeAgreementEndDate`

## expo-document-picker
- Install version ~14.0.8 for Expo SDK 54 (version 57+ causes compatibility warning)
