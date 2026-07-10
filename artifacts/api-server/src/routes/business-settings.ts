import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, businessSettingsTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { runRentGenerationForTenant } from "../lib/rent-generator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// The tenant row is the single source of truth for billing settings, so a
// business-defaults change must be materialized into the columns of every
// tenant that follows the defaults (useBusinessDefault=true), then each of
// those ledgers regenerated/resynced through the one shared path.
async function propagateDefaultsToFollowers(
  userId: number,
  defaults: { billingCycle: string; rentCollectionType: string; gracePeriodDays: number }
): Promise<void> {
  const properties = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  const propertyIds = properties.map(p => p.id);
  if (propertyIds.length === 0) return;

  const followers = await db
    .update(tenantsTable)
    .set({
      billingCycle: defaults.billingCycle,
      rentCollectionType: defaults.rentCollectionType,
      gracePeriodDays: defaults.gracePeriodDays,
    })
    .where(and(
      eq(tenantsTable.useBusinessDefault, true),
      inArray(tenantsTable.propertyId, propertyIds)
    ))
    .returning({ id: tenantsTable.id });

  for (const f of followers) {
    try {
      await runRentGenerationForTenant(f.id);
    } catch (err) {
      logger.error({ err, tenantId: f.id }, "Rent regeneration failed after business-defaults change");
    }
  }
}

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

  let saved: typeof businessSettingsTable.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(businessSettingsTable)
      .set({ defaultBillingCycle, defaultRentCollectionType, defaultGracePeriodDays: Number(defaultGracePeriodDays) })
      .where(eq(businessSettingsTable.userId, userId))
      .returning();
    saved = updated;
  } else {
    const [created] = await db
      .insert(businessSettingsTable)
      .values({ userId, defaultBillingCycle, defaultRentCollectionType, defaultGracePeriodDays: Number(defaultGracePeriodDays) })
      .returning();
    saved = created;
  }

  await propagateDefaultsToFollowers(userId, {
    billingCycle: saved.defaultBillingCycle,
    rentCollectionType: saved.defaultRentCollectionType,
    gracePeriodDays: saved.defaultGracePeriodDays,
  });

  res.json(formatSettings(saved));
});

export default router;
