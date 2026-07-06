import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { hashPassword, comparePassword, signToken } from "../lib/auth";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logActivity } from "./activity-logs";
import { sendEmail, buildVerificationEmail, buildPasswordResetEmail } from "../lib/email";

interface GoogleTokenPayload {
  sub: string;
  email: string;
  name?: string;
  aud: string;
  error_description?: string;
}

const router: IRouter = Router();

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_WEB_CLIENT_ID ??
  "910455573442-ni8hs248tapqpnimin4il8grhg38f645.apps.googleusercontent.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    const payload = (await r.json()) as GoogleTokenPayload;
    if (!r.ok || payload.error_description) return null;
    if (payload.aud !== GOOGLE_CLIENT_ID) return null;
    return payload;
  } catch {
    return null;
  }
}

function appBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS ?? process.env.REPLIT_DEV_DOMAIN ?? "";
  const first = domains.split(",")[0]?.trim();
  return first ? `https://${first}` : "http://localhost:5000";
}

async function generateAndSendVerification(
  userId: number,
  email: string,
  name: string
): Promise<boolean> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.update(usersTable)
    .set({ verificationToken: token, verificationTokenExpiry: expiry, emailVerified: false })
    .where(eq(usersTable.id, userId));

  const verifyUrl = `${appBaseUrl()}/api/auth/verify-email?token=${token}`;
  const { subject, html, text } = buildVerificationEmail(name, verifyUrl);
  const result = await sendEmail(email, subject, html, text);
  return result.sent;
}

// ─── Email / password login ───────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));
  if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }

  if (!user.passwordHash) {
    res.status(401).json({
      error: "This account uses Google Sign-In. Please use the 'Continue with Google' button.",
    });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }

  // Block unverified email/password accounts
  if (!user.emailVerified) {
    res.status(403).json({
      error: "Your email address has not been verified. Please verify your email before signing in.",
      code: "EMAIL_NOT_VERIFIED",
    });
    return;
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "login", entity: "user", entityId: user.id, description: `${user.email} logged in` });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() } });
});

// ─── Email / password register ────────────────────────────────────────────────

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, password, role } = req.body as {
    name?: string; email?: string; password?: string; role?: string;
  };
  if (!name || !email || !password) { res.status(400).json({ error: "Name, email and password required" }); return; }

  const normalised = email.trim().toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalised));

  if (existing) {
    if (!existing.passwordHash && existing.googleId) {
      res.status(400).json({
        error: "An account already exists with this email. Please sign in with Google or link a password from Account Settings.",
        code: "GOOGLE_ACCOUNT_EXISTS",
      });
    } else {
      res.status(400).json({ error: "An account with this email already exists. Please sign in instead." });
    }
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email: normalised,
    passwordHash,
    emailVerified: false,
    role: role === "admin" ? "admin" : "employee",
  }).returning();

  // Send verification email (non-blocking — account is created regardless)
  const emailSent = await generateAndSendVerification(user.id, user.email, user.name);

  logActivity({ userId: user.id, userEmail: user.email, action: "register", entity: "user", entityId: user.id, description: `New user registered: ${user.email} (${user.role})` });
  res.status(201).json({
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
    emailVerified: false,
    emailSent,
  });
});

// ─── Verify email via token link ──────────────────────────────────────────────
// This endpoint is opened in the user's browser from the email link.

router.get("/auth/verify-email", async (req, res): Promise<void> => {
  const { token } = req.query as { token?: string };

  function htmlPage(title: string, message: string, success: boolean): string {
    const color = success ? "#22c55e" : "#ef4444";
    const icon = success ? "✓" : "✗";
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Gemini Rent Manager</title>
<style>body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
.card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
.icon{width:64px;height:64px;border-radius:32px;background:${color}20;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:28px;color:${color}}
h1{color:#1e3a5f;margin:0 0 12px;font-size:22px}p{color:#555;line-height:1.6;margin:0 0 24px}
.btn{display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;font-size:15px}</style>
</head><body><div class="card">
<div class="icon">${icon}</div>
<h1>${title}</h1><p>${message}</p>
<a href="#" class="btn" onclick="window.close();return false">Close this page</a>
</div></body></html>`;
  }

  if (!token) {
    res.status(400).send(htmlPage("Invalid Link", "This verification link is invalid or missing. Please request a new one from the app.", false));
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.verificationToken, token));

  if (!user) {
    res.status(400).send(htmlPage("Link Not Found", "This verification link is invalid or has already been used. If your email is already verified, you can sign in normally.", false));
    return;
  }

  if (user.emailVerified) {
    res.send(htmlPage("Already Verified", "Your email address has already been verified. You can sign in to the Gemini Rent Manager app.", true));
    return;
  }

  if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
    res.status(400).send(htmlPage("Link Expired", "This verification link has expired (links are valid for 24 hours). Please open the app and request a new verification email.", false));
    return;
  }

  await db.update(usersTable)
    .set({ emailVerified: true, verificationToken: null, verificationTokenExpiry: null })
    .where(eq(usersTable.id, user.id));

  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: "Email address verified" });
  res.send(htmlPage("Email Verified!", "Your email address has been verified successfully. You can now sign in to Gemini Rent Manager.", true));
});

// ─── Resend verification email ────────────────────────────────────────────────

router.post("/auth/resend-verification", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email) { res.status(400).json({ error: "Email is required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));

  // Always return success to prevent email enumeration
  if (!user) { res.json({ message: "If that email exists, a new verification email has been sent." }); return; }

  if (user.emailVerified) {
    res.json({ message: "Your email is already verified. You can sign in now.", alreadyVerified: true });
    return;
  }

  if (!user.passwordHash) {
    // Google-only account — shouldn't need verification
    res.json({ message: "This account uses Google Sign-In and does not require email verification." });
    return;
  }

  await generateAndSendVerification(user.id, user.email, user.name);
  res.json({ message: "A new verification email has been sent. Please check your inbox." });
});

// ─── Google Sign-In / Sign-Up ─────────────────────────────────────────────────
// Google accounts are pre-verified — emailVerified is always true.

router.post("/auth/google", async (req, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) { res.status(400).json({ error: "idToken required" }); return; }

  const payload = await verifyGoogleToken(idToken);
  if (!payload) { res.status(401).json({ error: "Google token verification failed" }); return; }

  const { sub: googleId, email, name } = payload;
  if (!email) { res.status(400).json({ error: "Google account has no email" }); return; }

  let user = (await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)))[0];

  if (!user) {
    const [emailUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (emailUser) {
      // Link Google to existing account and mark as verified
      [user] = await db
        .update(usersTable)
        .set({
          googleId,
          provider: emailUser.passwordHash ? "both" : "google",
          emailVerified: true, // Google = pre-verified
          verificationToken: null,
          verificationTokenExpiry: null,
        })
        .where(eq(usersTable.id, emailUser.id))
        .returning();
    } else {
      [user] = await db.insert(usersTable).values({
        name: name ?? email.split("@")[0],
        email,
        provider: "google",
        googleId,
        role: "admin",
        emailVerified: true,
      }).returning();
    }
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "login", entity: "user", entityId: user.id, description: `${user.email} signed in via Google` });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() } });
});

// ─── Current user — includes provider + verification flags ────────────────────

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? undefined,
    company: user.company ?? undefined,
    createdAt: user.createdAt.toISOString(),
    hasPassword: !!user.passwordHash,
    hasGoogle: !!user.googleId,
    provider: user.provider,
    emailVerified: user.emailVerified,
  });
});

// ─── Update profile ───────────────────────────────────────────────────────────

router.put("/auth/profile", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { name, email, phone, company } = req.body as {
    name?: string; email?: string; phone?: string; company?: string;
  };
  if (email) {
    const [conflict] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (conflict && conflict.id !== req.user!.id) { res.status(400).json({ error: "Email already in use" }); return; }
  }
  const updates: Record<string, string | null> = {};
  if (name !== undefined) updates.name = name.trim() || null;
  if (email !== undefined) updates.email = email.trim().toLowerCase() || null;
  if (phone !== undefined) updates.phone = phone.trim() || null;
  if (company !== undefined) updates.company = company.trim() || null;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user!.id)).returning();
  res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, phone: updated.phone ?? undefined, company: updated.company ?? undefined, createdAt: updated.createdAt.toISOString() });
});

// ─── Change password ──────────────────────────────────────────────────────────

router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) { res.status(400).json({ error: "Current and new password are required" }); return; }
  if (newPassword.length < 6) { res.status(400).json({ error: "New password must be at least 6 characters" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.passwordHash) {
    res.status(400).json({ error: "No password set. Use 'Add Password' from Security settings first." }); return;
  }
  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) { res.status(400).json({ error: "Current password is incorrect" }); return; }
  const passwordHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: "Password changed" });
  res.json({ message: "Password changed successfully" });
});

// ─── Forgot password — sends email with reset link ───────────────────────────

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  // Always return 200 to prevent email enumeration
  if (!email) { res.json({ message: "If that email exists, a reset link has been sent." }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));
  if (!user || (!user.passwordHash && user.googleId)) {
    // Google-only account or unknown — silently succeed
    res.json({ message: "If that email exists, a reset link has been sent." });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.update(usersTable)
    .set({ resetToken: token, resetTokenExpiry: expiry })
    .where(eq(usersTable.id, user.id));

  const resetUrl = `${appBaseUrl()}/api/auth/reset-password-page?token=${token}`;
  const { subject, html, text } = buildPasswordResetEmail(user.name, resetUrl);
  await sendEmail(user.email, subject, html, text);

  res.json({ message: "If that email exists, a reset link has been sent." });
});

// ─── Reset-password web page (opened from email link) ────────────────────────

function resetHtmlPage(title: string, body: string, formHtml = ""): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Gemini Rent Manager</title>
<style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;display:flex;justify-content:center;align-items:flex-start;min-height:100vh;padding:24px}
.card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.1);margin-top:40px}
h1{color:#1e3a5f;margin:0 0 8px;font-size:20px}.header{background:#1e3a5f;border-radius:12px 12px 0 0;padding:20px 28px;margin:-40px -32px 28px}
.header h2{color:#fff;margin:0;font-size:18px}p{color:#555;line-height:1.6;margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:6px}
input{width:100%;height:48px;border:1.5px solid #ddd;border-radius:8px;padding:0 14px;font-size:15px;outline:none}
input:focus{border-color:#1e3a5f}button{width:100%;height:48px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;margin-top:8px}
button:hover{background:#162d4a}.error{color:#ef4444;font-size:13px;margin:4px 0 0}
.success{color:#22c55e;font-weight:600}.icon{font-size:40px;text-align:center;margin-bottom:16px}</style>
</head><body><div class="card">
<div class="header"><h2>Gemini Rent Manager</h2></div>
<h1>${title}</h1><p>${body}</p>${formHtml}
</div></body></html>`;
}

router.get("/auth/reset-password-page", async (req, res): Promise<void> => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).send(resetHtmlPage("Invalid Link", "This password reset link is invalid. Please request a new one from the app."));
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.resetToken, token));
  if (!user) {
    res.status(400).send(resetHtmlPage("Link Not Found", "This link is invalid or has already been used. Please request a new password reset from the app."));
    return;
  }
  if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
    res.status(400).send(resetHtmlPage("Link Expired", "This reset link has expired (links are valid for 1 hour). Please request a new one from the app."));
    return;
  }
  const form = `<form method="POST" action="/api/auth/reset-password-page">
    <input type="hidden" name="token" value="${token}">
    <div style="margin-bottom:16px"><label>New Password</label><input type="password" name="password" placeholder="Min. 6 characters" required minlength="6"><p class="error" id="pe"></p></div>
    <div style="margin-bottom:20px"><label>Confirm Password</label><input type="password" name="confirm" placeholder="Re-enter new password" required minlength="6"></div>
    <button type="submit">Set New Password</button>
  </form>`;
  res.send(resetHtmlPage("Reset Your Password", "Enter your new password below.", form));
});

router.post("/auth/reset-password-page", async (req, res): Promise<void> => {
  const { token, password, confirm } = req.body as { token?: string; password?: string; confirm?: string };
  if (!token || !password || !confirm) {
    res.status(400).send(resetHtmlPage("Error", "All fields are required."));
    return;
  }
  if (password !== confirm) {
    res.status(400).send(resetHtmlPage("Passwords Don't Match", "The passwords you entered don't match. Please go back and try again."));
    return;
  }
  if (password.length < 6) {
    res.status(400).send(resetHtmlPage("Password Too Short", "Password must be at least 6 characters. Please go back and try again."));
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.resetToken, token));
  if (!user) {
    res.status(400).send(resetHtmlPage("Link Not Found", "This reset link is invalid or has already been used."));
    return;
  }
  if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
    res.status(400).send(resetHtmlPage("Link Expired", "This reset link has expired. Please request a new one from the app."));
    return;
  }
  const passwordHash = await hashPassword(password);
  await db.update(usersTable)
    .set({ passwordHash, resetToken: null, resetTokenExpiry: null, emailVerified: true })
    .where(eq(usersTable.id, user.id));
  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: "Password reset via email link" });
  res.send(resetHtmlPage("Password Reset!", "Your password has been changed successfully. You can now sign in to the Gemini Rent Manager app with your new password."));
});

// ─── Account Linking: Link Google ────────────────────────────────────────────

router.post("/auth/link-google", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) { res.status(400).json({ error: "idToken required" }); return; }

  const payload = await verifyGoogleToken(idToken);
  if (!payload) { res.status(401).json({ error: "Google token verification failed" }); return; }

  const { sub: googleId, email: googleEmail } = payload;
  const [conflict] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId));
  if (conflict && conflict.id !== req.user!.id) {
    res.status(400).json({ error: "This Google account is already linked to a different account." }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [updated] = await db
    .update(usersTable)
    .set({
      googleId,
      provider: user.passwordHash ? "both" : "google",
      emailVerified: true, // Linking Google verifies the email
      verificationToken: null,
      verificationTokenExpiry: null,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: `Google account linked (${googleEmail})` });
  res.json({ message: "Google account linked successfully", hasPassword: !!updated.passwordHash, hasGoogle: !!updated.googleId, provider: updated.provider });
});

// ─── Account Linking: Add password ───────────────────────────────────────────

router.post("/auth/add-password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "Password is required" }); return; }
  if (password.length < 6) { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.passwordHash) {
    res.status(400).json({ error: "Account already has a password. Use Change Password instead." }); return;
  }
  const passwordHash = await hashPassword(password);
  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash, provider: user.googleId ? "both" : "email" })
    .where(eq(usersTable.id, user.id))
    .returning();
  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: "Password added to account" });
  res.json({ message: "Password added successfully", hasPassword: !!updated.passwordHash, hasGoogle: !!updated.googleId, provider: updated.provider });
});

// ─── Account Linking: Unlink Google ──────────────────────────────────────────

router.post("/auth/unlink-google", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.googleId) { res.status(400).json({ error: "No Google account is linked." }); return; }
  if (!user.passwordHash) {
    res.status(400).json({ error: "Add a password before unlinking Google — otherwise you would lose access to your account." }); return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ googleId: null, provider: "email" })
    .where(eq(usersTable.id, user.id))
    .returning();
  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: "Google account unlinked" });
  res.json({ message: "Google account unlinked successfully", hasPassword: !!updated.passwordHash, hasGoogle: !!updated.googleId, provider: updated.provider });
});

export default router;
