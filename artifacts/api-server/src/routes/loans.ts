import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, loansTable, loanPaymentsTable, propertiesTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

/** Returns true only when str is a real calendar date (YYYY-MM-DD). */
function isValidIsoDate(str: unknown): boolean {
  if (typeof str !== "string") return false;
  const parts = str.split("-");
  if (parts.length !== 3 || parts[0].length !== 4) return false;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2100) return false;
  return d <= new Date(y, m, 0).getDate();
}

function formatLoan(l: typeof loansTable.$inferSelect, propertyName?: string | null) {
  const principal = parseFloat(String(l.principalAmount));
  const emi = parseFloat(String(l.emiAmount));
  const remaining = Math.max(0, principal - (l.paidMonths * emi));
  const { userId: _uid, ...rest } = l;
  return {
    ...rest,
    principalAmount: principal,
    interestRate: parseFloat(String(l.interestRate)),
    emiAmount: emi,
    remainingAmount: remaining,
    propertyName: propertyName ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

router.get("/loans", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db
    .select({ loan: loansTable, propertyName: propertiesTable.name })
    .from(loansTable)
    .leftJoin(propertiesTable, eq(loansTable.propertyId, propertiesTable.id))
    .where(eq(loansTable.userId, userId));
  res.json(rows.map(r => formatLoan(r.loan, r.propertyName)));
});

router.post("/loans", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const { lenderName, principalAmount, interestRate, emiAmount, startDate, totalMonths, propertyId, notes } = req.body;
  if (!lenderName || !principalAmount || !interestRate || !emiAmount || !startDate || !totalMonths) {
    res.status(400).json({ error: "Required fields missing" });
    return;
  }
  if (!isValidIsoDate(startDate)) {
    res.status(400).json({ error: "Invalid date. Please enter a valid date in DD/MM/YYYY format." });
    return;
  }
  if (propertyId) {
    const [property] = await db.select({ id: propertiesTable.id }).from(propertiesTable)
      .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.userId, userId)));
    if (!property) { res.status(403).json({ error: "Property not found" }); return; }
  }
  const [loan] = await db.insert(loansTable).values({
    userId, lenderName, principalAmount: String(principalAmount), interestRate: String(interestRate),
    emiAmount: String(emiAmount), startDate, totalMonths, propertyId: propertyId ?? null, notes,
  }).returning();
  let propertyName: string | null = null;
  if (loan.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, loan.propertyId));
    propertyName = p?.name ?? null;
  }
  res.status(201).json(formatLoan(loan, propertyName));
});

router.patch("/loans/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [existing] = await db.select({ id: loansTable.id }).from(loansTable)
    .where(and(eq(loansTable.id, id), eq(loansTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Loan not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of ["lenderName", "startDate", "totalMonths", "status", "propertyId", "notes"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  for (const key of ["principalAmount", "interestRate", "emiAmount"]) {
    if (body[key] !== undefined) updates[key] = String(body[key]);
  }
  const [loan] = await db.update(loansTable).set(updates)
    .where(and(eq(loansTable.id, id), eq(loansTable.userId, userId))).returning();
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  let propertyName: string | null = null;
  if (loan.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, loan.propertyId));
    propertyName = p?.name ?? null;
  }
  res.json(formatLoan(loan, propertyName));
});

router.delete("/loans/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const deleted = await db.delete(loansTable)
    .where(and(eq(loansTable.id, id), eq(loansTable.userId, userId))).returning();
  if (!deleted.length) { res.status(404).json({ error: "Loan not found" }); return; }
  res.sendStatus(204);
});

router.post("/loans/:id/payments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { amount, paymentDate, notes } = req.body;
  if (!amount || !paymentDate) {
    res.status(400).json({ error: "Amount and paymentDate required" });
    return;
  }
  if (!isValidIsoDate(paymentDate)) {
    res.status(400).json({ error: "Invalid date. Please enter a valid date in DD/MM/YYYY format." });
    return;
  }
  const [loan] = await db.select().from(loansTable)
    .where(and(eq(loansTable.id, id), eq(loansTable.userId, userId)));
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const [loanPayment] = await db.insert(loanPaymentsTable).values({
    loanId: id, amount: String(amount), paymentDate, notes,
  }).returning();
  const newPaidMonths = loan.paidMonths + 1;
  const newStatus = newPaidMonths >= loan.totalMonths ? "completed" : loan.status;
  await db.update(loansTable).set({ paidMonths: newPaidMonths, status: newStatus })
    .where(and(eq(loansTable.id, id), eq(loansTable.userId, userId)));
  res.status(201).json({ ...loanPayment, amount: parseFloat(String(loanPayment.amount)), createdAt: loanPayment.createdAt.toISOString() });
});

export default router;
