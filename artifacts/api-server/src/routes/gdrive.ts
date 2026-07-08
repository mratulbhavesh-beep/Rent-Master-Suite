import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, googleDriveConnectionsTable, gdriveOauthStatesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import crypto from "node:crypto";
import {
  encryptString,
  decryptString,
  getCallbackUrl,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getGoogleUserEmail,
  uploadFileToDrive,
  downloadFileFromDrive,
  decryptBackupContent,
  encodeGRMContent,
  decodeGRMContent,
} from "../lib/gdrive";
import { gatherUserData, restoreFromData } from "./backup";

const router: IRouter = Router();

function credentialsOk(res: Response): boolean {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.BACKUP_ENCRYPTION_KEY
  ) {
    res.status(503).json({
      error:
        "Google Drive not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and BACKUP_ENCRYPTION_KEY secrets.",
    });
    return false;
  }
  return true;
}

async function getActiveToken(
  conn: typeof googleDriveConnectionsTable.$inferSelect,
): Promise<string> {
  const refreshToken = decryptString(conn.refreshTokenEnc);
  const { access_token } = await refreshAccessToken(refreshToken);
  await db
    .update(googleDriveConnectionsTable)
    .set({ accessTokenEnc: encryptString(access_token), updatedAt: new Date() })
    .where(eq(googleDriveConnectionsTable.id, conn.id));
  return access_token;
}

// ─── GET /api/gdrive/auth/start ───────────────────────────────────────────────

router.get("/gdrive/auth/start", requireAuth, async (req: AuthRequest, res) => {
  if (!credentialsOk(res)) return;
  try {
    const callbackUrl = getCallbackUrl();
    const state = crypto.randomBytes(24).toString("hex");
    await db.insert(gdriveOauthStatesTable).values({
      state,
      userId: req.user!.id,
      status: "pending",
    });
    const oauthUrl = buildGoogleAuthUrl(state, callbackUrl);
    res.json({ oauthUrl, stateToken: state });
  } catch (err: any) {
    req.log.error({ err }, "gdrive auth/start error");
    res.status(500).json({ error: err.message ?? "Failed to start OAuth" });
  }
});

// ─── GET /api/gdrive/callback (public — called by Google) ────────────────────

router.get("/gdrive/callback", async (req: Request, res) => {
  const { code, state, error: oauthError } = req.query as Record<string, string>;

  const html = (success: boolean, msg = "") =>
    res.send(
      `<!DOCTYPE html><html><head><title>Gemini Rent Manager</title>` +
        `<style>*{box-sizing:border-box}body{font-family:sans-serif;display:flex;` +
        `align-items:center;justify-content:center;min-height:100vh;background:#0f172a;` +
        `color:#f8fafc;margin:0}div{text-align:center;padding:40px 32px;border-radius:20px;` +
        `background:#1e293b;max-width:380px;width:90%}h2{margin:0 0 12px;font-size:24px}` +
        `p{margin:0;color:#94a3b8;font-size:15px}</style></head>` +
        `<body><div><h2>${success ? "✅ Connected!" : "❌ Failed"}</h2>` +
        `<p>${success ? "Google Drive connected. You can close this tab and return to the app." : msg}</p>` +
        `</div></body></html>`,
    );

  if (oauthError || !code || !state) {
    if (state) {
      await db
        .update(gdriveOauthStatesTable)
        .set({ status: "error", errorMessage: oauthError ?? "Missing code" })
        .where(eq(gdriveOauthStatesTable.state, state))
        .catch(() => {});
    }
    html(false, oauthError ?? "Authentication was cancelled.");
    return;
  }

  const [stateRow] = await db
    .select()
    .from(gdriveOauthStatesTable)
    .where(eq(gdriveOauthStatesTable.state, state));

  if (!stateRow) {
    html(false, "Invalid or expired state token. Please try again.");
    return;
  }

  try {
    const callbackUrl = getCallbackUrl();
    const tokens = await exchangeCodeForTokens(code, callbackUrl);
    if (!tokens.refresh_token) {
      throw new Error("No refresh token — please revoke app access in Google and try again.");
    }
    const email = await getGoogleUserEmail(tokens.access_token);
    const encAccess = encryptString(tokens.access_token);
    const encRefresh = encryptString(tokens.refresh_token);

    await db
      .insert(googleDriveConnectionsTable)
      .values({
        userId: stateRow.userId,
        googleEmail: email,
        accessTokenEnc: encAccess,
        refreshTokenEnc: encRefresh,
        autoBackupEnabled: false,
        lastBackupStatus: "none",
      })
      .onConflictDoUpdate({
        target: googleDriveConnectionsTable.userId,
        set: {
          googleEmail: email,
          accessTokenEnc: encAccess,
          refreshTokenEnc: encRefresh,
          driveFileId: null,
          updatedAt: new Date(),
        },
      });

    await db
      .update(gdriveOauthStatesTable)
      .set({ status: "complete", googleEmail: email })
      .where(eq(gdriveOauthStatesTable.state, state));

    html(true);
  } catch (err: any) {
    const msg: string = err?.message ?? "Unknown error";
    req.log.error({ err, state }, `gdrive callback error: ${msg}`);
    await db
      .update(gdriveOauthStatesTable)
      .set({ status: "error", errorMessage: msg })
      .where(eq(gdriveOauthStatesTable.state, state))
      .catch(() => {});
    html(false, `Authentication failed: ${msg}`);
  }
});

// ─── GET /api/gdrive/auth/status/:state ──────────────────────────────────────

router.get("/gdrive/auth/status/:state", requireAuth, async (req: AuthRequest, res) => {
  const { state } = req.params as { state: string };
  const [row] = await db
    .select()
    .from(gdriveOauthStatesTable)
    .where(eq(gdriveOauthStatesTable.state, state));
  if (!row || row.userId !== req.user!.id) {
    res.status(404).json({ status: "not_found" });
    return;
  }
  res.json({ status: row.status, email: row.googleEmail, error: row.errorMessage });
});

// ─── GET /api/gdrive/status ───────────────────────────────────────────────────

router.get("/gdrive/status", requireAuth, async (req: AuthRequest, res) => {
  if (!credentialsOk(res)) return;
  const [conn] = await db
    .select()
    .from(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.userId, req.user!.id));
  if (!conn) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    email: conn.googleEmail,
    autoBackupEnabled: conn.autoBackupEnabled,
    lastBackupAt: conn.lastBackupAt,
    lastBackupStatus: conn.lastBackupStatus,
    lastBackupError: conn.lastBackupError,
    connectedAt: conn.connectedAt,
    hasDriveFile: !!conn.driveFileId,
  });
});

// ─── DELETE /api/gdrive/disconnect ───────────────────────────────────────────

router.delete("/gdrive/disconnect", requireAuth, async (req: AuthRequest, res) => {
  await db
    .delete(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.userId, req.user!.id));
  res.json({ success: true });
});

// ─── POST /api/gdrive/backup ─────────────────────────────────────────────────

router.post("/gdrive/backup", requireAuth, async (req: AuthRequest, res) => {
  if (!credentialsOk(res)) return;
  const [conn] = await db
    .select()
    .from(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.userId, req.user!.id));
  if (!conn) {
    res.status(400).json({ error: "Google Drive not connected" });
    return;
  }
  try {
    const accessToken = await getActiveToken(conn);
    const data = await gatherUserData(req.user!.id);
    const label = `GeminiRent_Backup_${new Date().toISOString().slice(0, 10)}_uid${req.user!.id}`;
    const grmContent = encodeGRMContent(data, label);
    const contentBuf = Buffer.from(grmContent, "utf8");
    const fileName = `${label}.grm`;
    const fileId = await uploadFileToDrive({
      accessToken,
      content: contentBuf,
      mimeType: "application/octet-stream",
      fileName,
      fileId: conn.driveFileId ?? undefined,
    });
    await db
      .update(googleDriveConnectionsTable)
      .set({
        driveFileId: fileId,
        lastBackupAt: new Date(),
        lastBackupStatus: "success",
        lastBackupError: null,
        updatedAt: new Date(),
      })
      .where(eq(googleDriveConnectionsTable.id, conn.id));
    res.json({ success: true, fileId, fileName, sizeBytes: contentBuf.length, backedUpAt: new Date() });
  } catch (err: any) {
    req.log.error({ err }, "gdrive backup error");
    await db
      .update(googleDriveConnectionsTable)
      .set({ lastBackupStatus: "error", lastBackupError: err.message ?? "Unknown", updatedAt: new Date() })
      .where(eq(googleDriveConnectionsTable.id, conn.id))
      .catch(() => {});
    res.status(500).json({ error: err.message ?? "Backup failed" });
  }
});

// ─── POST /api/gdrive/restore ────────────────────────────────────────────────

router.post("/gdrive/restore", requireAuth, async (req: AuthRequest, res) => {
  if (!credentialsOk(res)) return;
  const [conn] = await db
    .select()
    .from(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.userId, req.user!.id));
  if (!conn) {
    res.status(400).json({ error: "Google Drive not connected" });
    return;
  }
  if (!conn.driveFileId) {
    res.status(404).json({ error: "No backup file in Google Drive — run a backup first" });
    return;
  }
  try {
    const accessToken = await getActiveToken(conn);
    const fileBuf = await downloadFileFromDrive(accessToken, conn.driveFileId);

    // Parse backup data — supports both:
    //   • New .grm format (JSON envelope, same as local Export/Import)
    //   • Legacy .enc format (AES-256-GCM binary, old Drive backups)
    let snap: object;
    try {
      const text = fileBuf.toString("utf8");
      const decoded = decodeGRMContent(text);
      snap = decoded.data;
    } catch {
      // Fall back to legacy binary encryption
      const json = decryptBackupContent(fileBuf);
      snap = JSON.parse(json);
    }

    await restoreFromData(req.user!.id, snap);
    res.json({ success: true, restoredAt: new Date() });
  } catch (err: any) {
    req.log.error({ err }, "gdrive restore error");
    res.status(500).json({ error: err.message ?? "Restore failed" });
  }
});

// ─── PUT /api/gdrive/auto-backup ─────────────────────────────────────────────

router.put("/gdrive/auto-backup", requireAuth, async (req: AuthRequest, res) => {
  if (!credentialsOk(res)) return;
  const { enabled } = req.body as { enabled: boolean };
  const [conn] = await db
    .select()
    .from(googleDriveConnectionsTable)
    .where(eq(googleDriveConnectionsTable.userId, req.user!.id));
  if (!conn) {
    res.status(400).json({ error: "Google Drive not connected" });
    return;
  }
  await db
    .update(googleDriveConnectionsTable)
    .set({ autoBackupEnabled: Boolean(enabled), updatedAt: new Date() })
    .where(eq(googleDriveConnectionsTable.id, conn.id));
  res.json({ success: true, autoBackupEnabled: Boolean(enabled) });
});

export default router;
