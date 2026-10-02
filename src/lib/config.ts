/* Central configuration for unblurr.site */

export const SITE_NAME = "unblurr.site";
export const SITE_TITLE = "unblurr.site — keep your video quality";

export const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "icloud.com"] as const;

export const MONGODB_URI = process.env.MONGODB_URI || "";
export const MONGODB_DB = process.env.MONGODB_DB || "unblurr";

export const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
export const EMAIL_FROM =
  process.env.EMAIL_FROM || "unblurr.site <onboarding@resend.dev>";

export const JWT_SECRET =
  process.env.JWT_SECRET || "unblurr-dev-secret-change-me-in-production";

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "bruhmeric@gmail.com").toLowerCase();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Akila@7463";

export const FREE_DAILY_LIMIT = Number.parseInt(process.env.FREE_DAILY_LIMIT || "2", 10) || 2;

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const SESSION_COOKIE = "unblurr_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function isEmailAllowed(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

export function isEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Start of the current UTC day, ISO string. */
export function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Array of the last N days (UTC), oldest first, as YYYY-MM-DD. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
