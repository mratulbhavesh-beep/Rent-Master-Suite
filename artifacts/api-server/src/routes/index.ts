import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import propertiesRouter from "./properties";
import tenantsRouter from "./tenants";
import paymentsRouter from "./payments";
import expensesRouter from "./expenses";
import loansRouter from "./loans";
import maintenanceRouter from "./maintenance";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(propertiesRouter);
router.use(tenantsRouter);
router.use(paymentsRouter);
router.use(expensesRouter);
router.use(loansRouter);
router.use(maintenanceRouter);
router.use(reportsRouter);

export default router;
