import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/properties", requireAuth, async (req, res): Promise<void> => {
  const { search, type } = req.query as { search?: string; type?: string };
  let query = db.select().from(propertiesTable);
  const conditions: ReturnType<typeof eq>[] = [];
  if (type) conditions.push(eq(propertiesTable.type, type));
  let rows;
  if (search && conditions.length > 0) {
    rows = await db.select().from(propertiesTable).where(
      or(ilike(propertiesTable.name, `%${search}%`), ilike(propertiesTable.address, `%${search}%`))
    );
  } else if (search) {
    rows = await db.select().from(propertiesTable).where(
      or(ilike(propertiesTable.name, `%${search}%`), ilike(propertiesTable.address, `%${search}%`))
    );
  } else {
    rows = await query;
  }
  res.json(rows.map(p => ({ ...p, rentAmount: parseFloat(String(p.rentAmount)), createdAt: p.createdAt.toISOString() })));
});

router.post("/properties", requireAuth, async (req, res): Promise<void> => {
  const { name, address, type, totalUnits, rentAmount, status, description } = req.body;
  if (!name || !address || !rentAmount) {
    res.status(400).json({ error: "Name, address, and rentAmount are required" });
    return;
  }
  const [property] = await db.insert(propertiesTable).values({
    name, address, type: type ?? "apartment", totalUnits: totalUnits ?? 1,
    rentAmount: String(rentAmount), status: status ?? "available", description,
  }).returning();
  res.status(201).json({ ...property, rentAmount: parseFloat(String(property.rentAmount)), createdAt: property.createdAt.toISOString() });
});

router.get("/properties/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }
  res.json({ ...property, rentAmount: parseFloat(String(property.rentAmount)), createdAt: property.createdAt.toISOString() });
});

router.patch("/properties/:id", requireAuth, async (req, res): Promise<void> => {
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
  const [property] = await db.update(propertiesTable).set(updates).where(eq(propertiesTable.id, id)).returning();
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }
  res.json({ ...property, rentAmount: parseFloat(String(property.rentAmount)), createdAt: property.createdAt.toISOString() });
});

router.delete("/properties/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, id));
  res.sendStatus(204);
});

export default router;
