import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, deviceTokensTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Register / update a push token ─────────────────────────────────────────

router.post("/push-tokens", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { token, deviceId, platform } = req.body as {
    token?: string;
    deviceId?: string;
    platform?: string;
  };
  if (!token) { res.status(400).json({ error: "token is required" }); return; }

  const userId = req.user!.id;
  const plat = (platform === "ios" ? "ios" : "android");

  const existing = await db
    .select({ id: deviceTokensTable.id })
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.token, token))
    .limit(1);

  if (existing.length > 0) {
    await db.update(deviceTokensTable)
      .set({ userId, deviceId: deviceId ?? null, platform: plat, updatedAt: new Date() })
      .where(eq(deviceTokensTable.token, token));
    logger.debug({ userId }, "Push token updated");
  } else {
    await db.insert(deviceTokensTable).values({
      userId,
      token,
      deviceId: deviceId ?? null,
      platform: plat,
    });
    logger.info({ userId, platform: plat }, "Push token registered");
  }

  res.json({ ok: true });
});

// ─── Unregister a push token (on logout) ─────────────────────────────────────

router.delete("/push-tokens", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: "token is required" }); return; }

  const userId = req.user!.id;
  await db.delete(deviceTokensTable)
    .where(and(
      eq(deviceTokensTable.token, token),
      eq(deviceTokensTable.userId, userId),
    ));

  logger.debug({ userId }, "Push token unregistered");
  res.json({ ok: true });
});

export default router;
