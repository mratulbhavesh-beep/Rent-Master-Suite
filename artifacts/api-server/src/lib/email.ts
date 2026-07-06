import nodemailer from "nodemailer";
import { logger } from "./logger";

// ─── Transport ────────────────────────────────────────────────────────────────

function getSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  if (host && user && pass) {
    return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  }
  return null;
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "Gemini Rent Manager <onboarding@resend.dev>";

// ─── Core send ────────────────────────────────────────────────────────────────

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
  // 1. Try Resend API (set RESEND_API_KEY env var)
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
      });
      if (resp.ok) {
        logger.info({ to, subject }, "Email sent via Resend");
        return { sent: true };
      }
      const errBody = await resp.text();
      logger.error({ to, subject, status: resp.status, errBody }, "Resend API error");
    } catch (err) {
      logger.error({ err, to, subject }, "Resend API request failed");
    }
  }

  // 2. Try SMTP (set SMTP_HOST / SMTP_USER / SMTP_PASS env vars)
  const smtpTransporter = getSmtpTransporter();
  if (smtpTransporter) {
    try {
      await smtpTransporter.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
      logger.info({ to, subject }, "Email sent via SMTP");
      return { sent: true };
    } catch (err) {
      logger.error({ err, to, subject }, "SMTP send failed");
    }
  }

  // 3. Dev fallback — log the full text to console so the link is usable
  logger.info({ to, subject }, "📧 [DEV EMAIL — configure RESEND_API_KEY or SMTP to send real emails]");
  logger.info({ text }, "📧 [DEV EMAIL BODY]");
  return { sent: false, devUrl: text };
}

// ─── Email templates ──────────────────────────────────────────────────────────

function baseHtml(content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:#1e3a5f;padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">Gemini Rent Manager</h1>
    </div>
    <div style="padding:32px">${content}</div>
  </div>
</body></html>`;
}

export function buildVerificationEmail(name: string, verifyUrl: string) {
  const subject = "Verify your email — Gemini Rent Manager";
  const html = baseHtml(`
    <h2 style="color:#1e3a5f;margin-top:0">Verify your email address</h2>
    <p style="color:#444;line-height:1.6">Hi ${name},</p>
    <p style="color:#444;line-height:1.6">Thank you for registering. Please verify your email address to activate your account.</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${verifyUrl}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block">
        Verify Email Address
      </a>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6">This link expires in <strong>24 hours</strong>.<br>If you did not create an account, you can safely ignore this email.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#bbb;font-size:12px;margin:0">If the button doesn't work, copy and paste this URL into your browser:<br>
    <a href="${verifyUrl}" style="color:#1e3a5f;word-break:break-all">${verifyUrl}</a></p>
  `);
  const text = `Verify your Gemini Rent Manager account\n\nHi ${name},\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`;
  return { subject, html, text };
}

export function buildPasswordResetEmail(name: string, resetUrl: string) {
  const subject = "Reset your password — Gemini Rent Manager";
  const html = baseHtml(`
    <h2 style="color:#1e3a5f;margin-top:0">Reset your password</h2>
    <p style="color:#444;line-height:1.6">Hi ${name},</p>
    <p style="color:#444;line-height:1.6">We received a request to reset your password. Click the button below to choose a new one.</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${resetUrl}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block">
        Reset Password
      </a>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6">This link expires in <strong>1 hour</strong>.<br>If you did not request a password reset, you can safely ignore this email — your password will not change.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#bbb;font-size:12px;margin:0">If the button doesn't work, copy and paste this URL into your browser:<br>
    <a href="${resetUrl}" style="color:#1e3a5f;word-break:break-all">${resetUrl}</a></p>
  `);
  const text = `Reset your Gemini Rent Manager password\n\nHi ${name},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`;
  return { subject, html, text };
}
