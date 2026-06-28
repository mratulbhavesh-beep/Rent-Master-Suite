import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function formatTenant(t: typeof tenantsTable.$inferSelect, propertyName?: string | null) {
  return {
    ...t,
    rentAmount: parseFloat(String(t.rentAmount)),
    propertyName: propertyName ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

router.get("/tenants", requireAuth, async (req, res): Promise<void> => {
  const { search, propertyId } = req.query as { search?: string; propertyId?: string };
  const rows = await db
    .select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id));

  let results = rows;
  if (propertyId) results = results.filter(r => r.tenant.propertyId === parseInt(propertyId, 10));
  if (search) {
    const s = search.toLowerCase();
    results = results.filter(r => r.tenant.name.toLowerCase().includes(s) || r.tenant.email.toLowerCase().includes(s) || r.tenant.phone.includes(s));
  }
  res.json(results.map(r => formatTenant(r.tenant, r.propertyName)));
});

router.post("/tenants", requireAuth, async (req, res): Promise<void> => {
  const { name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd, rentAmount, status, emergencyContact, notes } = req.body;
  if (!name || !email || !phone || !propertyId || !unitNumber || !leaseStart || !leaseEnd || !rentAmount) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  const [tenant] = await db.insert(tenantsTable).values({
    name, email, phone, propertyId, unitNumber, leaseStart, leaseEnd,
    rentAmount: String(rentAmount), status: status ?? "active", emergencyContact, notes,
  }).returning();
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, tenant.propertyId));
  res.status(201).json(formatTenant(tenant, property?.name));
});

router.get("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [row] = await db.select({ tenant: tenantsTable, propertyName: propertiesTable.name })
    .from(tenantsTable).leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, id));
  if (!row) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(formatTenant(row.tenant, row.propertyName));
});

router.patch("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["name","email","phone","propertyId","unitNumber","leaseStart","leaseEnd","status","emergencyContact","notes"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.rentAmount !== undefined) updates.rentAmount = String(body.rentAmount);
  const [tenant] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, id)).returning();
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, tenant.propertyId));
  res.json(formatTenant(tenant, property?.name));
});

router.delete("/tenants/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  res.sendStatus(204);
});

export default router;
