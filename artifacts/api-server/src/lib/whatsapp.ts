import { logger } from "./logger";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";

let twilioClient: ReturnType<typeof import("twilio")> | null = null;

function getClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require("twilio") as typeof import("twilio");
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

export async function sendWhatsApp(to: string, body: string): Promise<{ sid: string } | { error: string }> {
  const client = getClient();
  if (!client) {
    logger.warn("Twilio not configured — WhatsApp message skipped");
    return { error: "Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN." };
  }
  const normalised = to.replace(/\D/g, "");
  const toNumber = `whatsapp:+${normalised.startsWith("91") ? normalised : "91" + normalised}`;
  try {
    const msg = await client.messages.create({ from: TWILIO_WHATSAPP_FROM, to: toNumber, body });
    logger.info({ sid: msg.sid, to: toNumber }, "WhatsApp sent");
    return { sid: msg.sid };
  } catch (err: any) {
    logger.error({ err, to: toNumber }, "WhatsApp send failed");
    return { error: err?.message ?? "Unknown error" };
  }
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
