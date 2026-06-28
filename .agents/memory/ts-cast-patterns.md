---
name: TS cast patterns in mobile app
description: Correct cast patterns to avoid TS2352 errors
---

Non-overlapping type casts require `as unknown as T`:
- `(tenants as unknown as TenantWithBalance[])` — Tenant[] vs custom type
- `(colors as unknown as Record<string, typeof colors.light>).dark` — in useColors.ts

Direct `as T` fails with TS2352 when neither type sufficiently overlaps the other.

SF Symbol name typo in _layout.tsx: `"squareshape.split.2x2.fill"` → `"square.split.2x2.fill"` (squareshape is not a valid SFSymbol; square is).

loan-detail.tsx: API sometimes returns `{ loan: Loan, payments: Payment[] }` wrapped object; cast as `any` and use `anyDetail?.loan ?? loanDetail` to handle both shapes.
