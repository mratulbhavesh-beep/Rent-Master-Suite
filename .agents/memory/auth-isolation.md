---
name: Auth & data isolation patterns
description: How per-user data isolation is implemented across the Gemini Rent Manager backend and frontend
---

## Rule
Every resource is scoped to the requesting user. Resources with a direct `userId` FK (properties, expenses, loans) filter by `eq(table.userId, req.user.id)`. Resources that belong to a user through a property (tenants, payments, maintenance) first fetch `userPropertyIds` then filter with `inArray(table.propertyId, userPropertyIds)`. Return empty array (not 403) when userPropertyIds is empty.

**Why:** Prevents cross-user data leakage — the original schema had no userId columns at all; any authenticated user could read/write all records.

**How to apply:**
- All new resource tables need a nullable `userId` FK referencing `usersTable` (nullable so existing rows stay safe during migration)
- All route handlers import `type AuthRequest` from `../middlewares/auth` and use `req.user!.id`
- Strip `userId` from API responses via destructuring (`const { userId: _uid, ...rest } = row`)
- Dashboard/reports: use `sql.raw()` when building `ANY(ARRAY[...])` clauses if `inArray` can't be used (empty array edge case)

## Frontend auth guard
- Auth guard lives in `RootLayoutNav` (inside `AuthProvider`) in `_layout.tsx`
- Uses `useSegments()[0] === "(tabs)"` to detect protected group
- `useEffect` redirects to `/login` when `!isAuthenticated && inProtectedGroup && !isLoading`
- `AuthContext.tsx` validates stored token via `GET /api/auth/me` on startup — clears session on 401, trusts token on network error (offline tolerance)
- `queryClient.clear()` is called in logout to prevent User A's data showing for User B

## Error extraction from ApiError
The custom fetcher wraps HTTP errors as `ApiError` with `err.data` = parsed JSON body.
In `onError` callbacks: `(err as { data?: { error?: string } })?.data?.error ?? "Fallback message"`
