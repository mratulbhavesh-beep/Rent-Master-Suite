import nodemailer from "nodemailer";
import { logger } from "./logger";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

const FROM_ADDRESS =
  process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@geminirent.app";

export interface SendEmailResult {
  sent: boolean;
  devUrl?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<SendEmailResult> {
  const transporter = getTransporter();

  if (!transporter) {
    // Dev fallback — log instead of sending
    logger.info({ to, subject, text }, "📧 [DEV] Email not sent — configure SMTP_HOST/SMTP_USER/SMTP_PASS to enable real emails");
    return { sent: false, devUrl: text };
  }

  try {
    await transporter.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
    logger.info({ to, subject }, "Email sent");
    return { sent: true };
  } catch (err) {
    logger.error({ err, to, subject }, "Email send failed");
    return { sent: false };
  }
}

export function buildVerificationEmail(
  name: string,
  verifyUrl: string
): { subject: string; html: string; text: string } {
  const subject = "Verify your email — Gemini Rent Manager";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">Gemini Rent Manager</h1>
    </div>
    <div style="padding:32px">
      <h2 style="color:#1e3a5f;margin-top:0">Verify your email address</h2>
      <p style="color:#444;line-height:1.6">Hi ${name},</p>
      <p style="color:#444;line-height:1.6">
        Thank you for registering. Please verify your email address to activate your account.
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="${verifyUrl}"
           style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block">
          Verify Email Address
        </a>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">
        This link expires in <strong>24 hours</strong>.<br>
        If you did not create an account, you can safely ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:12px;margin:0">
        If the button above doesn't work, copy and paste this URL into your browser:<br>
        <a href="${verifyUrl}" style="color:#1e3a5f;word-break:break-all">${verifyUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Verify your Gemini Rent Manager account\n\nHi ${name},\n\nPlease verify your email address by visiting this link:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`;

  return { subject, html, text };
}
