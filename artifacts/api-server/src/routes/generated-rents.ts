import { Router, type IRouter } from "express";
import { eq, and, lt, inArray } from "drizzle-orm";
import { db, generatedRentsTable, tenantsTable, propertiesTable, paymentsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { runRentGeneration } from "../lib/rent-generator";

const router: IRouter = Router();

function formatRent(
  r: typeof generatedRentsTable.$inferSelect,
  tenantName?: string | null,
  propertyName?: string | null,
  unitNumber?: string | null
) {
  return {
    ...r,
    amount: parseFloat(String(r.amount)),
    tenantName: tenantName ?? null,
    propertyName: propertyName ?? null,
    unitNumber: unitNumber ?? null,
    generatedAt: r.generatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

async function getUserPropertyIds(userId: number): Promise<number[]> {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  return props.map(p => p.id);
}

router.get("/generated-rents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { tenantId, status } = req.query as { tenantId?: string; status?: string };

  const today = new Date().toISOString().split("T")[0];

  const propertyIds = await getUserPropertyIds(userId);
  if (propertyIds.length === 0) { res.json([]); return; }

  // Mark overdue: pending rents whose dueDate has passed
  await db
    .update(generatedRentsTable)
    .set({ status: "overdue" })
    .where(
      and(
        eq(generatedRentsTable.status, "pending"),
        lt(generatedRentsTable.dueDate, today),
        inArray(generatedRentsTable.propertyId, propertyIds)
      )
    );

  const rows = await db
    .select({
      rent: generatedRentsTable,
      tenantName: tenantsTable.name,
      propertyName: propertiesTable.name,
      unitNumber: tenantsTable.unitNumber,
    })
    .from(generatedRentsTable)
    .leftJoin(tenantsTable, eq(generatedRentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(generatedRentsTable.propertyId, propertiesTable.id))
    .where(inArray(generatedRentsTable.propertyId, propertyIds));

  let results = rows;
  if (tenantId) results = results.filter(r => r.rent.tenantId === parseInt(tenantId, 10));
  if (status) results = results.filter(r => r.rent.status === status);

  res.json(results.map(r => formatRent(r.rent, r.tenantName, r.propertyName, r.unitNumber)));
});

router.post("/generated-rents/trigger", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const generated = await runRentGeneration();
  res.json({ generated });
});

export default router;
