import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, propertiesTable, tenantsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function formatProperty(p: typeof propertiesTable.$inferSelect, occupiedUnits = 0) {
  const { userId: _uid, ...rest } = p;
  return {
    ...rest,
    rentAmount: parseFloat(String(p.rentAmount)),
    createdAt: p.createdAt.toISOString(),
    occupiedUnits,
  };
}

router.get("/properties", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { search, type } = req.query as { search?: string; type?: string };

  const conditions: ReturnType<typeof eq>[] = [eq(propertiesTable.userId, userId)];
  if (type) conditions.push(eq(propertiesTable.type, type));

  let rows;
  if (search) {
    rows = await db.select().from(propertiesTable).where(
      and(
        and(...conditions),
        or(ilike(propertiesTable.name, `%${search}%`), ilike(propertiesTable.address, `%${search}%`))
      )
    );
  } else {
    rows = await db.select().from(propertiesTable).where(and(...conditions));
  }

  const tenantCounts = rows.length > 0
    ? await db
        .select({ propertyId: tenantsTable.propertyId, count: sql<number>`count(*)::int` })
        .from(tenantsTable)
        .where(eq(tenantsTable.status, "active"))
        .groupBy(tenantsTable.propertyId)
    : [];
  const countMap = Object.fromEntries(tenantCounts.map(r => [r.propertyId!, Number(r.count)]));
  res.json(rows.map(p => formatProperty(p, countMap[p.id] ?? 0)));
});

router.post("/properties", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, address, type, totalUnits, rentAmount, status, description } = req.body;
  if (!name || !address || !rentAmount) {
    res.status(400).json({ error: "Name, address, and rentAmount are required" });
    return;
  }
  const [property] = await db.insert(propertiesTable).values({
    userId, name, address, type: type ?? "apartment", totalUnits: totalUnits ?? 1,
    rentAmount: String(rentAmount), status: status ?? "available", description,
  }).returning();
  res.status(201).json(formatProperty(property));
});

router.get("/properties/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }
  res.json(formatProperty(property));
});

router.patch("/properties/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { name, address, type, totalUnits, rentAmount, status, description } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (type !== undefined) updates.type = type;
  if (totalUnits !== undefined) updates.totalUnits = totalUnits;
  if (rentAmount !== undefined) updates.rentAmount = String(rentAmount);
  if (status !== undefined) updates.status = status;
  if (description !== undefined) updates.description = description;
  const [property] = await db.update(propertiesTable).set(updates)
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.userId, userId))).returning();
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }
  res.json(formatProperty(property));
});

router.delete("/properties/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const deleted = await db.delete(propertiesTable)
    .where(and(eq(propertiesTable.id, id), eq(propertiesTable.userId, userId))).returning();
  if (!deleted.length) { res.status(404).json({ error: "Property not found" }); return; }
  res.sendStatus(204);
});

export default router;
