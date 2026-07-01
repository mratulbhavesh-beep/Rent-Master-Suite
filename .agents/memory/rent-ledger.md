---
name: Rent Ledger Module
description: Standalone Rent Ledger screen architecture — data sources, status logic, PDF/WhatsApp sharing patterns
---

## Files
- `artifacts/mobile/app/rent-ledger.tsx` — listing screen
- `artifacts/mobile/app/rent-ledger-detail.tsx` — detail/PDF/share screen
- Entry: More tab → Finance section → "Rent Ledger"
- Routes registered in `app/_layout.tsx` as `rent-ledger` and `rent-ledger-detail`

## Data Sources (no new DB tables)
- `useListTenants()` — provides totalPaid, totalExpected, balanceDue, currentMonthDue, rentAmount
- `useListPayments()` (no filter) — all payments for last-payment-date and month-filter status computation
- `useListProperties()` — property filter chips on listing screen
- `useGetTenant(id)` + `useListPayments({ tenantId })` on detail screen

## Status Logic
- `getLedgerStatus()` returns `"paid" | "partial" | "due"` (never "all" — must narrow return type from StatusFilter to avoid TS7053)
- When `filterMonth === null`: uses `tenant.currentMonthDue` vs `tenant.rentAmount`
- When month is selected: sums payments for that month/year from allPayments list

## Advance vs Balance
- `advanceBalance = max(0, totalPaid - totalExpected)` — tenant has overpaid
- `balanceDue = max(0, totalExpected - totalPaid)` — tenant is behind

## Month-wise History
- `buildMonthHistory(leaseStart, rentAmount, payments)` generates one row per calendar month from leaseStart to today
- `runningBalance` accumulates month by month (positive = still owed, negative = advance)
- History shown in reverse order (most recent first)

## PDF Generation
- `expo-print` and `expo-sharing` already installed (^15.0.8, ^14.0.8)
- `Print.printToFileAsync({ html })` → uri → `Sharing.shareAsync(uri, { mimeType: 'application/pdf' })`
- `Print.printAsync({ html })` for native print dialog
- HTML template embedded as a template literal in `generateLedgerHTML()`

## WhatsApp Sharing
- `Linking.openURL('whatsapp://send?phone=91NNNN&text=...')` — text summary only
- Phone number: strip non-digits, prepend 91 if 10 digits or strip leading 0
- `.catch()` to show Alert when WhatsApp not installed
