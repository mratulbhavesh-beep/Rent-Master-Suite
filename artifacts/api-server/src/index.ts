import app from "./app";
import { logger } from "./lib/logger";
import { runRentGeneration } from "./lib/rent-generator";
import cron from "node-cron";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run rent generation on startup (catch-up for missed periods)
  runRentGeneration().catch(e => logger.error({ err: e }, "Startup rent generation failed"));

  // Run hourly
  cron.schedule("0 * * * *", () => {
    runRentGeneration().catch(e => logger.error({ err: e }, "Scheduled rent generation failed"));
  });
});
