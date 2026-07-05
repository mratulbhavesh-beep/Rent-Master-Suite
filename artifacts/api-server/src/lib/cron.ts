import cron from "node-cron";
import { runDailyReminders } from "../routes/reminders";
import { logger } from "./logger";

export function startCronJobs() {
  // Run at 09:00 every day
  cron.schedule("0 9 * * *", async () => {
    logger.info("Cron: running daily WhatsApp reminders");
    try {
      const sent = await runDailyReminders();
      logger.info({ sent }, "Cron: daily reminders done");
    } catch (err) {
      logger.error({ err }, "Cron: daily reminders failed");
    }
  });
  logger.info("Cron jobs started (daily reminders at 09:00)");
}
