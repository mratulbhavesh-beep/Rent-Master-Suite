import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, expensesTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function formatExpense(e: typeof expensesTable.$inferSelect, propertyName?: string | null) {
  const { userId: _uid, ...rest } = e;
  return { ...rest, amount: parseFloat(String(e.amount)), propertyName: propertyName ?? null, createdAt: e.createdAt.toISOString() };
}

router.get("/expenses", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { propertyId, category, month } = req.query as { propertyId?: string; category?: string; month?: string };
  const rows = await db
    .select({ expense: expensesTable, propertyName: propertiesTable.name })
    .from(expensesTable)
    .leftJoin(propertiesTable, eq(expensesTable.propertyId, propertiesTable.id))
    .where(eq(expensesTable.userId, userId));

  let results = rows;
  if (propertyId) results = results.filter(r => r.expense.propertyId === parseInt(propertyId, 10));
  if (category) results = results.filter(r => r.expense.category === category);
  if (month) results = results.filter(r => r.expense.date.startsWith(month));
  res.json(results.map(r => formatExpense(r.expense, r.propertyName)));
});

router.post("/expenses", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { title, amount, category, date, propertyId, notes } = req.body;
  if (!title || !amount || !category || !date) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  if (propertyId) {
    const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable)
      .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
    if (!property) { res.status(403).json({ error: "Property not found" }); return; }
  }
  const [expense] = await db.insert(expensesTable).values({
    userId, title, amount: String(amount), category, date, propertyId: propertyId ?? null, notes,
  }).returning();
  let propertyName: string | null = null;
  if (expense.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, expense.propertyId));
    propertyName = p?.name ?? null;
  }
  res.status(201).json(formatExpense(expense, propertyName));
});

router.patch("/expenses/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db.select({ id: expensesTable.id }).from(expensesTable)
    .where(and(eq(expensesTable.id, id), eq(expensesTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Expense not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["title", "category", "date", "propertyId", "notes"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.amount !== undefined) updates.amount = String(body.amount);
  const [expense] = await db.update(expensesTable).set(updates)
    .where(and(eq(expensesTable.id, id), eq(expensesTable.userId, userId))).returning();
  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }
  let propertyName: string | null = null;
  if (expense.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, expense.propertyId));
    propertyName = p?.name ?? null;
  }
  res.json(formatExpense(expense, propertyName));
});

router.delete("/expenses/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const deleted = await db.delete(expensesTable)
    .where(and(eq(expensesTable.id, id), eq(expensesTable.userId, userId))).returning();
  if (!deleted.length) { res.status(404).json({ error: "Expense not found" }); return; }
  res.sendStatus(204);
});

export default router;
