import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, maintenanceRequestsTable, propertiesTable, tenantsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function formatRequest(m: typeof maintenanceRequestsTable.$inferSelect, propertyName?: string | null, tenantName?: string | null) {
  return {
    ...m,
    propertyName: propertyName ?? null,
    tenantName: tenantName ?? null,
    resolvedAt: m.resolvedAt ? m.resolvedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

async function getUserPropertyIds(userId: number): Promise<number[]> {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));
  return props.map(p => p.id);
}

router.get("/maintenance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { propertyId, status } = req.query as { propertyId?: string; status?: string };

  const userPropertyIds = await getUserPropertyIds(userId);
  if (userPropertyIds.length === 0) { res.json([]); return; }

  const rows = await db
    .select({ req: maintenanceRequestsTable, propertyName: propertiesTable.name, tenantName: tenantsTable.name })
    .from(maintenanceRequestsTable)
    .leftJoin(propertiesTable, eq(maintenanceRequestsTable.propertyId, propertiesTable.id))
    .leftJoin(tenantsTable, eq(maintenanceRequestsTable.tenantId, tenantsTable.id))
    .where(inArray(maintenanceRequestsTable.propertyId, userPropertyIds));

  let results = rows;
  if (propertyId) results = results.filter(r => r.req.propertyId === parseInt(propertyId, 10));
  if (status) results = results.filter(r => r.req.status === status);
  res.json(results.map(r => formatRequest(r.req, r.propertyName, r.tenantName)));
});

router.post("/maintenance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { title, description, propertyId, tenantId, priority, notes } = req.body;
  if (!title || !description || !propertyId) {
    res.status(400).json({ error: "Title, description, and propertyId required" });
    return;
  }
  const [property] = await db.select().from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
  if (!property) { res.status(403).json({ error: "Property not found" }); return; }

  const [request] = await db.insert(maintenanceRequestsTable).values({
    title, description, propertyId, tenantId: tenantId ?? null, priority: priority ?? "medium", notes,
  }).returning();
  let tenantName: string | null = null;
  if (request.tenantId) {
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, request.tenantId));
    tenantName = t?.name ?? null;
  }
  res.status(201).json(formatRequest(request, property.name, tenantName));
});

router.patch("/maintenance/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const userPropertyIds = await getUserPropertyIds(userId);
  const [existing] = await db.select({ req: maintenanceRequestsTable }).from(maintenanceRequestsTable)
    .where(eq(maintenanceRequestsTable.id, id));
  if (!existing || !userPropertyIds.includes(existing.req.propertyId)) {
    res.status(404).json({ error: "Request not found" }); return;
  }
  const { title, description, priority, status, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (priority !== undefined) updates.priority = priority;
  if (status !== undefined) {
    updates.status = status;
    if (status === "resolved") updates.resolvedAt = new Date();
  }
  if (notes !== undefined) updates.notes = notes;
  const [request] = await db.update(maintenanceRequestsTable).set(updates)
    .where(eq(maintenanceRequestsTable.id, id)).returning();
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, request.propertyId));
  let tenantName: string | null = null;
  if (request.tenantId) {
    const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, request.tenantId));
    tenantName = t?.name ?? null;
  }
  res.json(formatRequest(request, property?.name, tenantName));
});

router.delete("/maintenance/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const userPropertyIds = await getUserPropertyIds(userId);
  const [existing] = await db.select({ req: maintenanceRequestsTable }).from(maintenanceRequestsTable)
    .where(eq(maintenanceRequestsTable.id, id));
  if (!existing || !userPropertyIds.includes(existing.req.propertyId)) {
    res.status(404).json({ error: "Request not found" }); return;
  }
  await db.delete(maintenanceRequestsTable).where(eq(maintenanceRequestsTable.id, id));
  res.sendStatus(204);
});

export default router;
