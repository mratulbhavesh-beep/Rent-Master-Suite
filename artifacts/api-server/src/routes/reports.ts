import { Router, type IRouter } from "express";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import { db, paymentsTable, expensesTable, tenantsTable, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/reports/monthly", requireAuth, async (req, res): Promise<void> => {
  const { year, month } = req.query as { year?: string; month?: string };
  if (!year || !month) { res.status(400).json({ error: "year and month required" }); return; }
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  const payments = await db
    .select({ payment: paymentsTable, tenantName: tenantsTable.name, propertyName: propertiesTable.name })
    .from(paymentsTable)
    .leftJoin(tenantsTable, eq(paymentsTable.tenantId, tenantsTable.id))
    .leftJoin(propertiesTable, eq(paymentsTable.propertyId, propertiesTable.id))
    .where(sql`${paymentsTable.year} = ${y} AND ${paymentsTable.month} = ${m}`);

  const monthStr = `${y}-${String(m).padStart(2, "0")}`;
  const expenses = await db
    .select({ expense: expensesTable, propertyName: propertiesTable.name })
    .from(expensesTable)
    .leftJoin(propertiesTable, eq(expensesTable.propertyId, propertiesTable.id))
    .where(sql`${expensesTable.date} LIKE ${monthStr + "%"}`);

  const totalIncome = payments.filter(p => p.payment.status === "paid").reduce((s, p) => s + parseFloat(String(p.payment.amount)), 0);
  const totalExpenses = expenses.reduce((s, e) => s + parseFloat(String(e.expense.amount)), 0);
  const collectedRents = payments.filter(p => p.payment.status === "paid").length;
  const pendingRents = payments.filter(p => p.payment.status !== "paid").length;

  res.json({
    year: y, month: m, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses,
    collectedRents, pendingRents,
    payments: payments.map(r => ({
      ...r.payment, amount: parseFloat(String(r.payment.amount)),
      tenantName: r.tenantName ?? null, propertyName: r.propertyName ?? null,
      createdAt: r.payment.createdAt.toISOString(),
    })),
    expenses: expenses.map(r => ({
      ...r.expense, amount: parseFloat(String(r.expense.amount)),
      propertyName: r.propertyName ?? null, createdAt: r.expense.createdAt.toISOString(),
    })),
  });
});

router.get("/reports/yearly", requireAuth, async (req, res): Promise<void> => {
  const { year } = req.query as { year?: string };
  if (!year) { res.status(400).json({ error: "year required" }); return; }
  const y = parseInt(year, 10);

  const payments = await db.select().from(paymentsTable).where(sql`${paymentsTable.year} = ${y}`);
  const expenses = await db.select().from(expensesTable).where(sql`${expensesTable.date} LIKE ${y + "-%"}`);

  const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const monthPayments = payments.filter(p => p.month === m && p.status === "paid");
    const monthExpenses = expenses.filter(e => e.date.startsWith(`${y}-${String(m).padStart(2, "0")}`));
    const income = monthPayments.reduce((s, p) => s + parseFloat(String(p.amount)), 0);
    const exp = monthExpenses.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    return { month: m, income, expenses: exp, netProfit: income - exp };
  });

  const totalIncome = monthlyBreakdown.reduce((s, m) => s + m.income, 0);
  const totalExpenses = monthlyBreakdown.reduce((s, m) => s + m.expenses, 0);

  res.json({ year: y, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, monthlyBreakdown });
});

export default router;
