---
name: Production schema / deploy debugging
description: Diagnosing 000-hang vs 404 on production; importance of JSON error handler; publish-only schema migration flow
---

## Rule
Routes that exist on the production server but query tables missing from the production DB will **hang** (curl shows `000`), not return 404. This is because the async DB query throws, the error propagates, and without a global error handler Express never sends a response.

**Why:** Express 5 catches async errors automatically, but without a 4-argument `(err, req, res, next)` error handler in `app.ts`, the default error handler sends HTML — which the mobile app tries to parse as JSON and crashes on.

**How to apply:**
- Always keep a JSON error handler as the last `app.use()` in `app.ts` before `export default app`
- When debugging prod vs dev discrepancy: `000` = route exists + DB table missing; `404` = route doesn't exist at all
- Production DB schema is ONLY updated through the Replit Publish flow (Replit diffs dev schema against prod and applies DDL). Do NOT write migration scripts or startup-time DDL.
- Use `executeSql({ environment: "production" })` via code_execution to query production DB tables when diagnosing prod issues

## Differentiating production states
| curl response | Meaning |
|---|---|
| `000` (hang / conn reset) | Route exists, crashes before sending response (missing DB table is most common cause) |
| `404` JSON | Route doesn't exist on the deployed server |
| `400`/`401` | Route works correctly (auth guard firing) |
| HTML 500 | Route exists, throws unhandled error, no JSON error handler present |
