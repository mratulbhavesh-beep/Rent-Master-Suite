import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword, comparePassword, signToken } from "../lib/auth";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logActivity } from "./activity-logs";

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
      // Google-only account — give the specific helpful error
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
    role: role === "admin" ? "admin" : "employee",
  }).returning();

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "register", entity: "user", entityId: user.id, description: `New user registered: ${user.email} (${user.role})` });
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() } });
});

// ─── Google Sign-In / Sign-Up ─────────────────────────────────────────────────
// Always finds or creates exactly one account per email.
// Linking: if the email already exists under any provider, Google is linked to it.

router.post("/auth/google", async (req, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) { res.status(400).json({ error: "idToken required" }); return; }

  const payload = await verifyGoogleToken(idToken);
  if (!payload) { res.status(401).json({ error: "Google token verification failed" }); return; }

  const { sub: googleId, email, name } = payload;
  if (!email) { res.status(400).json({ error: "Google account has no email" }); return; }

  // 1. Already linked to this googleId?
  let user = (await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)))[0];

  if (!user) {
    const [emailUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (emailUser) {
      // 2. Email account exists — link Google to it (one account per email)
      [user] = await db
        .update(usersTable)
        .set({ googleId, provider: emailUser.passwordHash ? "both" : "google" })
        .where(eq(usersTable.id, emailUser.id))
        .returning();
    } else {
      // 3. No account yet — create one
      [user] = await db.insert(usersTable).values({
        name: name ?? email.split("@")[0],
        email,
        provider: "google",
        googleId,
        role: "admin",
      }).returning();
    }
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "login", entity: "user", entityId: user.id, description: `${user.email} signed in via Google` });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() } });
});

// ─── Current user — includes provider flags ───────────────────────────────────

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

// ─── Reset password (unauthenticated, e.g. forgot-password flow) ──────────────

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { email, newPassword } = req.body as { email?: string; newPassword?: string };
  if (!email || !newPassword) { res.status(400).json({ error: "Email and new password required" }); return; }
  if (newPassword.length < 6) { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));
  if (!user) { res.status(404).json({ error: "No account found with that email" }); return; }
  if (!user.passwordHash && user.googleId) {
    res.status(400).json({ error: "This account uses Google Sign-In. Sign in with Google, then add a password from Account Settings." });
    return;
  }
  const passwordHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  res.json({ message: "Password reset successfully" });
});

// ─── Account Linking: Link Google to the current account ─────────────────────

router.post("/auth/link-google", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) { res.status(400).json({ error: "idToken required" }); return; }

  const payload = await verifyGoogleToken(idToken);
  if (!payload) { res.status(401).json({ error: "Google token verification failed" }); return; }

  const { sub: googleId, email: googleEmail } = payload;

  // Make sure this Google account isn't already linked to a different user
  const [conflict] = await db.select().from(usersTable).where(eq(usersTable.googleId, googleId));
  if (conflict && conflict.id !== req.user!.id) {
    res.status(400).json({ error: "This Google account is already linked to a different account." }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [updated] = await db
    .update(usersTable)
    .set({ googleId, provider: user.passwordHash ? "both" : "google" })
    .where(eq(usersTable.id, user.id))
    .returning();

  logActivity({ userId: user.id, userEmail: user.email, action: "update", entity: "user", entityId: user.id, description: `Google account linked (${googleEmail})` });
  res.json({ message: "Google account linked successfully", hasPassword: !!updated.passwordHash, hasGoogle: !!updated.googleId, provider: updated.provider });
});

// ─── Account Linking: Add password to a Google-only account ──────────────────

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

// ─── Account Linking: Unlink Google (only when password exists) ───────────────

router.post("/auth/unlink-google", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.googleId) { res.status(400).json({ error: "No Google account is linked." }); return; }
  if (!user.passwordHash) {
    res.status(400).json({ error: "Add a password before unlinking Google — otherwise you would lose access to your account." });
    return;
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
