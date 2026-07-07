---
name: Google Drive OAuth configuration
description: OAuth client details, redirect URIs, and the env var override pattern for Google Drive integration
---

## Rule
`getCallbackUrl()` in `lib/gdrive.ts` uses `OAUTH_REDIRECT_URI` as the highest-priority override, then falls back to `REPLIT_DOMAINS`, then `REPLIT_DEV_DOMAIN`. Always set `OAUTH_REDIRECT_URI` as a production env var to avoid issues if Replit ever changes the domain format.

**Why:** The dev Replit URL is ephemeral (changes per session); the production domain is fixed. The env var makes the production redirect URI deterministic and independent of Replit internals.

## Current OAuth client
- Client ID: starts with `910455573442-imm7ro47mr96skdcinfg70i1krbvqpqq`
- Type: Web Application (has GOOGLE_CLIENT_SECRET)
- Production redirect URI: `https://rent-master-suite.replit.app/api/gdrive/callback`
- Production JS origin: `https://rent-master-suite.replit.app`

## Required Google Cloud Console registrations
In Credentials → the Web client → Authorized redirect URIs:
- `https://rent-master-suite.replit.app/api/gdrive/callback`

In Authorized JavaScript origins:
- `https://rent-master-suite.replit.app`

## Production env var
- `OAUTH_REDIRECT_URI=https://rent-master-suite.replit.app/api/gdrive/callback` (production only)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` stored as secrets (not env vars)

## OAuth flow (server-side)
1. Mobile calls `GET /api/gdrive/auth/start` → gets `oauthUrl` + `stateToken`
2. Mobile opens `oauthUrl` via `Linking.openURL()` (default browser)
3. Google redirects to callback URL after user grants access
4. Server callback stores encrypted tokens in `google_drive_connections` table
5. Mobile polls `GET /api/gdrive/auth/status/:state` until status = "complete"
