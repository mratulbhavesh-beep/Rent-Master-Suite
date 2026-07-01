import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, rentAgreementsTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function computeAgreementStatus(endDate: string): "active" | "expired" {
  return new Date(endDate) >= new Date(new Date().toISOString().split("T")[0]) ? "active" : "expired";
}

function formatAgreement(a: typeof rentAgreementsTable.$inferSelect) {
  return {
    ...a,
    monthlyRent: parseFloat(String(a.monthlyRent)),
    securityDeposit: a.securityDeposit != null ? parseFloat(String(a.securityDeposit)) : null,
    status: computeAgreementStatus(a.endDate),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

async function verifyTenantOwnership(tenantId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, tenantId));
  return !!row && row.propertyUserId === userId;
}

function safeId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

router.get("/tenants/:id/agreements", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const tenantId = safeId(req.params.id);
  if (!(await verifyTenantOwnership(tenantId, userId))) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const agreements = await db.select().from(rentAgreementsTable)
    .where(eq(rentAgreementsTable.tenantId, tenantId))
    .orderBy(rentAgreementsTable.startDate);
  res.json(agreements.map(formatAgreement));
});

router.post("/tenants/:id/agreements", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const tenantId = safeId(req.params.id);
  if (!(await verifyTenantOwnership(tenantId, userId))) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const { agreementNumber, startDate, endDate, monthlyRent, securityDeposit, notes } = req.body;
  if (!agreementNumber || !startDate || !endDate || !monthlyRent) {
    res.status(400).json({ error: "Required fields: agreementNumber, startDate, endDate, monthlyRent" });
    return;
  }
  const [agreement] = await db.insert(rentAgreementsTable).values({
    tenantId,
    agreementNumber,
    startDate,
    endDate,
    monthlyRent: String(monthlyRent),
    securityDeposit: securityDeposit != null ? String(securityDeposit) : undefined,
    notes: notes ?? undefined,
  }).returning();
  res.status(201).json(formatAgreement(agreement));
});

router.patch("/agreements/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = safeId(req.params.id);
  const [existing] = await db.select({ tenantId: rentAgreementsTable.tenantId })
    .from(rentAgreementsTable).where(eq(rentAgreementsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Agreement not found" }); return; }
  if (!(await verifyTenantOwnership(existing.tenantId, userId))) {
    res.status(404).json({ error: "Agreement not found" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["agreementNumber", "startDate", "endDate", "notes"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.monthlyRent !== undefined) updates.monthlyRent = String(body.monthlyRent);
  if (body.securityDeposit !== undefined) updates.securityDeposit = body.securityDeposit != null ? String(body.securityDeposit) : null;
  const [updated] = await db.update(rentAgreementsTable).set(updates).where(eq(rentAgreementsTable.id, id)).returning();
  res.json(formatAgreement(updated));
});

router.delete("/agreements/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = safeId(req.params.id);
  const [existing] = await db.select({ tenantId: rentAgreementsTable.tenantId })
    .from(rentAgreementsTable).where(eq(rentAgreementsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Agreement not found" }); return; }
  if (!(await verifyTenantOwnership(existing.tenantId, userId))) {
    res.status(404).json({ error: "Agreement not found" });
    return;
  }
  await db.delete(rentAgreementsTable).where(eq(rentAgreementsTable.id, id));
  res.sendStatus(204);
});

export default router;
