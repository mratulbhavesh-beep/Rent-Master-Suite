import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantDocumentsTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const router: IRouter = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function verifyTenantOwnership(tenantId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ propertyUserId: propertiesTable.userId })
    .from(tenantsTable)
    .leftJoin(propertiesTable, eq(tenantsTable.propertyId, propertiesTable.id))
    .where(eq(tenantsTable.id, tenantId));
  return !!row && row.propertyUserId === userId;
}

function formatDocument(d: typeof tenantDocumentsTable.$inferSelect) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    fileUrl: `/api/documents/${d.id}/file`,
  };
}

function safeId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

router.get("/tenants/:id/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const tenantId = safeId(req.params.id);
  if (!(await verifyTenantOwnership(tenantId, userId))) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  const docs = await db.select().from(tenantDocumentsTable)
    .where(eq(tenantDocumentsTable.tenantId, tenantId))
    .orderBy(tenantDocumentsTable.createdAt);
  res.json(docs.map(formatDocument));
});

router.post("/tenants/:id/documents/upload", requireAuth, upload.single("file"), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const tenantId = safeId(req.params.id);
  if (!(await verifyTenantOwnership(tenantId, userId))) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const documentType = (req.body.documentType as string) || "other";
  const [doc] = await db.insert(tenantDocumentsTable).values({
    tenantId,
    documentType,
    fileName: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    fileSize: req.file.size,
  }).returning();
  res.status(201).json(formatDocument(doc));
});

router.get("/documents/:id/file", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = safeId(req.params.id);
  const [doc] = await db.select().from(tenantDocumentsTable).where(eq(tenantDocumentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  if (!(await verifyTenantOwnership(doc.tenantId, userId))) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const filePath = path.join(uploadsDir, doc.fileName);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found on disk" }); return; }
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${doc.originalName}"`);
  fs.createReadStream(filePath).pipe(res as any);
});

router.delete("/documents/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const id = safeId(req.params.id);
  const [doc] = await db.select().from(tenantDocumentsTable).where(eq(tenantDocumentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  if (!(await verifyTenantOwnership(doc.tenantId, userId))) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const filePath = path.join(uploadsDir, doc.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.delete(tenantDocumentsTable).where(eq(tenantDocumentsTable.id, id));
  res.sendStatus(204);
});

export default router;
