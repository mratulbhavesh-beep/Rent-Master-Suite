# Gemini Rent Manager

A complete Android-first property management app for landlords and property managers — handles properties, tenants, rent collection, expenses, EMI loans, maintenance, and reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `JWT_SECRET` — JWT signing secret (defaults to built-in dev key)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo (React Native) with Expo Router
- API: Express 5 + JWT authentication (bcryptjs + jsonwebtoken)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — Single source of truth for API contracts
- `lib/db/src/schema/` — Drizzle table definitions (users, properties, tenants, payments, expenses, loans, maintenance)
- `artifacts/api-server/src/routes/` — Express route handlers per domain
- `artifacts/api-server/src/lib/auth.ts` — JWT + bcrypt helpers
- `artifacts/api-server/src/middlewares/auth.ts` — requireAuth / requireAdmin middleware
- `artifacts/mobile/app/` — Expo Router screens
- `artifacts/mobile/context/AuthContext.tsx` — Auth state management
- `artifacts/mobile/constants/colors.ts` — Design tokens (navy + gold theme, dark mode)

## Architecture decisions

- JWT stored in AsyncStorage, injected into all API calls via `setAuthTokenGetter`
- OpenAPI-first: all endpoints defined in `openapi.yaml` before implementation
- Role-based access: admin vs employee roles stored in JWT
- Receipt numbers auto-generated on payment creation (RCP-timestamp-random)
- Loan progress tracked by paidMonths counter, auto-set to "completed" when totalMonths reached
- Single billing source of truth: `lib/rent-calc` owns escalation/billing-cycle/due-date math as a chronological timeline walk; all server modules (rent generation, ledger resync, dashboard, cron, renewals) and the mobile preview consume it — never re-implement rent math locally
- `tenants.rentAmount` is the base-rent anchor when a tenant has zero revision rows; ledger resync only overwrites it once revisions exist
- `escalationApply` ('manual' default vs 'automatic') gates whether anniversaries auto-apply; manual mode gets reminder suggestions only
- Lease renewal always records a rent revision at the new lease start (plus a carry-over revision when renewing early) so the re-anchored timeline keeps the carried rent

## Product

- Login/Register with Admin and Employee roles
- Dashboard: total properties, tenants, monthly income, overdue rents, pending maintenance
- Property Management: CRUD with search, type filter (apartment/house/commercial/land), status
- Tenant Management: CRUD with lease dates, property/unit assignment, status badges
- Rent Collection: record payments (cash/UPI/bank/cheque), payment history, auto receipt generation
- Expense Tracking: categorized expenses (repair/utility/tax/insurance/maintenance/salary/other)
- EMI/Loan Tracker: loan records, EMI progress bars, payment recording
- Maintenance Requests: priority levels (low/medium/high/urgent), status tracking
- Reports: monthly and yearly income/expense charts (built with plain View primitives)
- Dark Mode: full dark theme via useColorScheme + useColors hook

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- `pnpm --filter @workspace/db run push` to apply schema changes to the database
- Restart the API server workflow after backend code changes
- Mobile HMR is active — only restart the Expo workflow for dependency changes
- Amount fields use Drizzle `numeric` (returns as string) — always parse with `parseFloat(String(...))`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
