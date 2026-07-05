import { logger } from "./logger";

/**
 * Cron jobs placeholder.
 * Auto-send via Twilio/WhatsApp Business API is disabled.
 * Reminders are shared manually from the mobile app via WhatsApp deep links.
 */
export function startCronJobs() {
  logger.info("Cron jobs started (no auto-send — reminders are shared manually via WhatsApp)");
}
