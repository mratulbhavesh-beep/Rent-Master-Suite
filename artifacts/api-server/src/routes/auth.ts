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

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!user.passwordHash) {
    res.status(401).json({ error: "This account uses Google Sign-In. Please use the 'Sign in with Google' button." });
    return;
  }
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "login", entity: "user", entityId: user.id, description: `${user.email} logged in`, ipAddress: (req as any).ip });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, password, role } = req.body as { name?: string; email?: string; password?: string; role?: string };
  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email and password required" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash,
    role: role === "admin" ? "admin" : "employee",
  }).returning();
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  logActivity({ userId: user.id, userEmail: user.email, action: "register", entity: "user", entityId: user.id, description: `New user registered: ${user.email} (${user.role})`, ipAddress: (req as any).ip });
  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
  });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { email, newPassword } = req.body as { email?: string; newPassword?: string };
  if (!email || !newPassword) {
    res.status(400).json({ error: "Email and new password required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(404).json({ error: "No account found with that email" });
    return;
  }
  if (user.provider === "google") {
    res.status(400).json({ error: "This account uses Google Sign-In and does not have a password. Please sign in with Google." });
    return;
  }
  const passwordHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  res.json({ message: "Password reset successfully" });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? undefined,
    company: user.company ?? undefined,
    createdAt: user.createdAt.toISOString(),
  });
});

router.put("/auth/profile", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { name, email, phone, company } = req.body as {
    name?: string; email?: string; phone?: string; company?: string;
  };

  if (email) {
    const [conflict] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (conflict && conflict.id !== req.user!.id) {
      res.status(400).json({ error: "Email already in use" });
      return;
    }
  }

  const updates: Record<string, string | null> = {};
  if (name !== undefined) updates.name = name.trim() || null;
  if (email !== undefined) updates.email = email.trim().toLowerCase() || null;
  if (phone !== undefined) updates.phone = phone.trim() || null;
  if (company !== undefined) updates.company = company.trim() || null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, req.user!.id))
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    phone: updated.phone ?? undefined,
    company: updated.company ?? undefined,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string; newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!user.passwordHash) {
    res.status(400).json({ error: "This account uses Google Sign-In and does not have a password." });
    return;
  }
  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  res.json({ message: "Password changed successfully" });
});

router.post("/auth/google", async (req, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ error: "idToken required" });
    return;
  }

  const googleClientId =
    process.env.GOOGLE_WEB_CLIENT_ID ??
    "910455573442-ni8hs248tapqpnimin4il8grhg38f645.apps.googleusercontent.com";

  let payload: GoogleTokenPayload;
  try {
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    payload = (await tokenInfoRes.json()) as GoogleTokenPayload;
    if (!tokenInfoRes.ok || payload.error_description) {
      res.status(401).json({ error: "Google token verification failed" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Could not verify Google token" });
    return;
  }

  if (payload.aud !== googleClientId) {
    res.status(401).json({ error: "Token audience mismatch" });
    return;
  }

  const { sub: googleId, email, name } = payload;
  if (!email) {
    res.status(400).json({ error: "Google account has no email" });
    return;
  }

  let user = (await db.select().from(usersTable).where(eq(usersTable.googleId, googleId)))[0];

  if (!user) {
    const [emailUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (emailUser) {
      [user] = await db
        .update(usersTable)
        .set({ googleId, provider: "google" })
        .where(eq(usersTable.id, emailUser.id))
        .returning();
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          name: name ?? email.split("@")[0],
          email,
          provider: "google",
          googleId,
          role: "employee",
        })
        .returning();
    }
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

export default router;
