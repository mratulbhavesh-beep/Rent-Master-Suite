import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function formatSettings(s: typeof businessSettingsTable.$inferSelect) {
  const { userId: _uid, ...rest } = s;
  return {
    ...rest,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    userId: s.userId,
  };
}

router.get("/business-settings/billing", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const [settings] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.userId, userId));

  if (!settings) {
    res.json({
      id: 0,
      userId,
      defaultBillingCycle: "monthly",
      defaultRentCollectionType: "post_paid",
      defaultGracePeriodDays: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  res.json(formatSettings(settings));
});

router.put("/business-settings/billing", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { defaultBillingCycle, defaultRentCollectionType, defaultGracePeriodDays } = req.body;

  if (!defaultBillingCycle || !defaultRentCollectionType || defaultGracePeriodDays == null) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }

  const [existing] = await db
    .select({ id: businessSettingsTable.id })
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.userId, userId));

  if (existing) {
    const [updated] = await db
      .update(businessSettingsTable)
      .set({ defaultBillingCycle, defaultRentCollectionType, defaultGracePeriodDays: Number(defaultGracePeriodDays) })
      .where(eq(businessSettingsTable.userId, userId))
      .returning();
    res.json(formatSettings(updated));
  } else {
    const [created] = await db
      .insert(businessSettingsTable)
      .values({ userId, defaultBillingCycle, defaultRentCollectionType, defaultGracePeriodDays: Number(defaultGracePeriodDays) })
      .returning();
    res.json(formatSettings(created));
  }
});

export default router;
