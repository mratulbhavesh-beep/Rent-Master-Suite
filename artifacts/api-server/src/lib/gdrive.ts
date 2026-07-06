import crypto from "node:crypto";

// ─── Encryption key ───────────────────────────────────────────────────────────

function getEncKey(): Buffer {
  const hex = (process.env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  if (hex.length !== 64) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY misconfigured: expected 64 hex chars, got ${hex.length}`,
    );
  }
  return Buffer.from(hex, "hex");
}

// ─── AES-256-GCM string encryption (for tokens stored in DB) ─────────────────

export function encryptString(text: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptString(data: string): string {
  const key = getEncKey();
  const buf = Buffer.from(data, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

// ─── AES-256-GCM binary encryption for backup file content ───────────────────
// Layout: [4 magic bytes "GRM1"][12 IV][16 auth tag][ciphertext]

export function encryptBackupContent(json: string): Buffer {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("GRM1"), iv, tag, enc]);
}

export function decryptBackupContent(data: Buffer): string {
  if (data.subarray(0, 4).toString("ascii") !== "GRM1") {
    throw new Error("Invalid backup format — expected GRM1 magic");
  }
  const key = getEncKey();
  const iv = data.subarray(4, 16);
  const tag = data.subarray(16, 32);
  const enc = data.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString("utf8") + decipher.final("utf8");
}

// ─── OAuth URL helpers ────────────────────────────────────────────────────────

export function getCallbackUrl(): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domains) return `https://${domains}/api/gdrive/callback`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}/api/gdrive/callback`;
  throw new Error("Cannot determine server domain for OAuth callback");
}

export function buildGoogleAuthUrl(state: string, callbackUrl: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ─── Token exchange & refresh ─────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  callbackUrl: string,
): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getGoogleUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to get Google user info");
  const data = await res.json() as { email: string };
  return data.email;
}

// ─── Google Drive API ─────────────────────────────────────────────────────────

export async function uploadFileToDrive(options: {
  accessToken: string;
  content: Buffer;
  mimeType: string;
  fileName: string;
  fileId?: string;
}): Promise<string> {
  const { accessToken, content, mimeType, fileName, fileId } = options;
  const metadata = JSON.stringify({ name: fileName, mimeType });
  const boundary = "grm_boundary_" + crypto.randomBytes(8).toString("hex");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

export async function downloadFileFromDrive(
  accessToken: string,
  fileId: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) throw new Error("Backup file not found in Google Drive");
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
