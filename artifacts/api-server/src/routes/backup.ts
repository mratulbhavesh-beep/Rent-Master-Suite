import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  backupsTable,
  propertiesTable,
  tenantsTable,
  paymentsTable,
  expensesTable,
  loansTable,
  loanPaymentsTable,
  maintenanceRequestsTable,
  rentAgreementsTable,
  tenantDocumentsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function buildDefaultLabel(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `GeminiRent_Backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

async function gatherUserData(userId: number) {
  const properties = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.userId, userId));

  const propIds = properties.map(p => p.id);

  const tenants =
    propIds.length > 0
      ? await db.select().from(tenantsTable).where(inArray(tenantsTable.propertyId, propIds))
      : [];

  const tenantIds = tenants.map(t => t.id);

  const payments =
    propIds.length > 0
      ? await db.select().from(paymentsTable).where(inArray(paymentsTable.propertyId, propIds))
      : [];

  const expenses = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.userId, userId));

  const loans = await db
    .select()
    .from(loansTable)
    .where(eq(loansTable.userId, userId));

  const loanIds = loans.map(l => l.id);

  const loanPayments =
    loanIds.length > 0
      ? await db.select().from(loanPaymentsTable).where(inArray(loanPaymentsTable.loanId, loanIds))
      : [];

  const maintenanceRequests =
    propIds.length > 0
      ? await db.select().from(maintenanceRequestsTable).where(inArray(maintenanceRequestsTable.propertyId, propIds))
      : [];

  const rentAgreements =
    tenantIds.length > 0
      ? await db.select().from(rentAgreementsTable).where(inArray(rentAgreementsTable.tenantId, tenantIds))
      : [];

  const tenantDocuments =
    tenantIds.length > 0
      ? await db.select().from(tenantDocumentsTable).where(inArray(tenantDocumentsTable.tenantId, tenantIds))
      : [];

  return {
    version: "1.0",
    properties,
    tenants,
    payments,
    expenses,
    loans,
    loanPayments,
    maintenanceRequests,
    rentAgreements,
    tenantDocuments,
  };
}

async function restoreFromData(userId: number, snap: any) {
  await db.transaction(async tx => {
    const currentProps = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.userId, userId));
    const currentPropIds = currentProps.map(p => p.id);

    const currentTenants =
      currentPropIds.length > 0
        ? await tx.select({ id: tenantsTable.id }).from(tenantsTable).where(inArray(tenantsTable.propertyId, currentPropIds))
        : [];
    const currentTenantIds = currentTenants.map(t => t.id);

    const currentLoans = await tx
      .select({ id: loansTable.id })
      .from(loansTable)
      .where(eq(loansTable.userId, userId));
    const currentLoanIds = currentLoans.map(l => l.id);

    if (currentTenantIds.length > 0) {
      await tx.delete(tenantDocumentsTable).where(inArray(tenantDocumentsTable.tenantId, currentTenantIds));
      await tx.delete(rentAgreementsTable).where(inArray(rentAgreementsTable.tenantId, currentTenantIds));
    }
    if (currentPropIds.length > 0) {
      await tx.delete(maintenanceRequestsTable).where(inArray(maintenanceRequestsTable.propertyId, currentPropIds));
      await tx.delete(paymentsTable).where(inArray(paymentsTable.propertyId, currentPropIds));
    }
    if (currentLoanIds.length > 0) {
      await tx.delete(loanPaymentsTable).where(inArray(loanPaymentsTable.loanId, currentLoanIds));
    }
    await tx.delete(expensesTable).where(eq(expensesTable.userId, userId));
    await tx.delete(loansTable).where(eq(loansTable.userId, userId));
    if (currentTenantIds.length > 0) {
      await tx.delete(tenantsTable).where(inArray(tenantsTable.propertyId, currentPropIds));
    }
    if (currentPropIds.length > 0) {
      await tx.delete(propertiesTable).where(eq(propertiesTable.userId, userId));
    }

    const propIdMap: Record<number, number> = {};
    for (const p of (snap.properties ?? [])) {
      const { id: oldId, createdAt: _ca, updatedAt: _ua, ...fields } = p;
      const [inserted] = await tx
        .insert(propertiesTable)
        .values({ ...fields, userId })
        .returning({ id: propertiesTable.id });
      propIdMap[oldId] = inserted.id;
    }

    const tenantIdMap: Record<number, number> = {};
    for (const t of (snap.tenants ?? [])) {
      const { id: oldId, createdAt: _ca, updatedAt: _ua, ...fields } = t;
      const newPropertyId = propIdMap[fields.propertyId];
      if (newPropertyId == null) continue;
      const [inserted] = await tx
        .insert(tenantsTable)
        .values({ ...fields, propertyId: newPropertyId })
        .returning({ id: tenantsTable.id });
      tenantIdMap[oldId] = inserted.id;
    }

    for (const p of (snap.payments ?? [])) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...fields } = p;
      const newPropertyId = propIdMap[fields.propertyId];
      const newTenantId = tenantIdMap[fields.tenantId];
      if (newPropertyId == null || newTenantId == null) continue;
      await tx.insert(paymentsTable).values({ ...fields, propertyId: newPropertyId, tenantId: newTenantId });
    }

    for (const e of (snap.expenses ?? [])) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...fields } = e;
      const newPropertyId = fields.propertyId != null ? propIdMap[fields.propertyId] : undefined;
      await tx.insert(expensesTable).values({ ...fields, userId, propertyId: newPropertyId ?? null });
    }

    const loanIdMap: Record<number, number> = {};
    for (const l of (snap.loans ?? [])) {
      const { id: oldId, createdAt: _ca, updatedAt: _ua, ...fields } = l;
      const newPropertyId = fields.propertyId != null ? propIdMap[fields.propertyId] : undefined;
      const [inserted] = await tx
        .insert(loansTable)
        .values({ ...fields, userId, propertyId: newPropertyId ?? null })
        .returning({ id: loansTable.id });
      loanIdMap[oldId] = inserted.id;
    }

    for (const lp of (snap.loanPayments ?? [])) {
      const { id: _id, createdAt: _ca, ...fields } = lp;
      const newLoanId = loanIdMap[fields.loanId];
      if (newLoanId == null) continue;
      await tx.insert(loanPaymentsTable).values({ ...fields, loanId: newLoanId });
    }

    for (const m of (snap.maintenanceRequests ?? [])) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...fields } = m;
      const newPropertyId = propIdMap[fields.propertyId];
      if (newPropertyId == null) continue;
      const newTenantId = fields.tenantId != null ? tenantIdMap[fields.tenantId] : undefined;
      await tx.insert(maintenanceRequestsTable).values({
        ...fields,
        propertyId: newPropertyId,
        tenantId: newTenantId ?? null,
        resolvedAt: fields.resolvedAt ? new Date(fields.resolvedAt) : null,
      });
    }

    for (const a of (snap.rentAgreements ?? [])) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...fields } = a;
      const newTenantId = tenantIdMap[fields.tenantId];
      if (newTenantId == null) continue;
      await tx.insert(rentAgreementsTable).values({ ...fields, tenantId: newTenantId });
    }
  });
}

// ── CREATE ────────────────────────────────────────────────────────────────────

router.post("/backup", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const customLabel = (req.body as { label?: string })?.label?.trim();
  const label = customLabel || buildDefaultLabel();

  const data = await gatherUserData(userId);
  const json = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(json, "utf8");

  const [backup] = await db
    .insert(backupsTable)
    .values({ userId, label, sizeBytes, data })
    .returning();

  res.status(201).json({
    id: backup.id,
    label: backup.label,
    sizeBytes: backup.sizeBytes,
    createdAt: backup.createdAt.toISOString(),
    version: data.version,
    location: "Server Storage",
  });
});

// ── LIST ──────────────────────────────────────────────────────────────────────

router.get("/backup", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db
    .select({
      id: backupsTable.id,
      label: backupsTable.label,
      sizeBytes: backupsTable.sizeBytes,
      createdAt: backupsTable.createdAt,
    })
    .from(backupsTable)
    .where(eq(backupsTable.userId, userId))
    .orderBy(backupsTable.createdAt);

  res.json(
    rows.map(r => ({
      id: r.id,
      label: r.label,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      version: "1.0",
      location: "Server Storage",
    }))
  );
});

// ── GET RAW DATA (for export) ─────────────────────────────────────────────────

router.get("/backup/:id/data", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const backupId = Number(req.params.id);

  const [backup] = await db
    .select()
    .from(backupsTable)
    .where(eq(backupsTable.id, backupId));

  if (!backup || backup.userId !== userId) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  const data = backup.data as any;
  res.json({
    id: backup.id,
    label: backup.label,
    version: data?.version ?? "1.0",
    data,
  });
});

// ── RESTORE ───────────────────────────────────────────────────────────────────

router.post("/backup/:id/restore", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const backupId = Number(req.params.id);

  const [backup] = await db
    .select()
    .from(backupsTable)
    .where(eq(backupsTable.id, backupId));

  if (!backup || backup.userId !== userId) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  const snap = backup.data as ReturnType<typeof JSON.parse>;
  await restoreFromData(userId, snap);

  res.json({
    message: "Backup restored successfully. All data has been replaced.",
    restoredAt: new Date().toISOString(),
  });
});

// ── IMPORT (from .grm file) ────────────────────────────────────────────────────

router.post("/backup/import", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { label, data } = req.body as { label: string; data: object };

  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "Invalid backup data: missing or malformed data field." });
    return;
  }

  const json = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(json, "utf8");
  const importLabel = (label || buildDefaultLabel()) + " (Imported)";

  const [backup] = await db
    .insert(backupsTable)
    .values({ userId, label: importLabel, sizeBytes, data })
    .returning();

  res.status(201).json({
    id: backup.id,
    label: backup.label,
    sizeBytes: backup.sizeBytes,
    createdAt: backup.createdAt.toISOString(),
    version: (data as any)?.version ?? "1.0",
    location: "Server Storage",
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

router.delete("/backup/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const backupId = Number(req.params.id);

  const [backup] = await db
    .select({ id: backupsTable.id, userId: backupsTable.userId })
    .from(backupsTable)
    .where(eq(backupsTable.id, backupId));

  if (!backup || backup.userId !== userId) {
    res.status(404).json({ error: "Backup not found" });
    return;
  }

  await db.delete(backupsTable).where(eq(backupsTable.id, backupId));
  res.status(204).send();
});

export default router;
