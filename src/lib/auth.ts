/* JWT session helpers (jose) + cookie utilities + route guards */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { JWT_SECRET, SESSION_COOKIE, SESSION_MAX_AGE } from "./config";
import { db, ensureDb } from "./db";
import type { PublicUser, Role, User } from "./types";
import { toPublicUser } from "./types";

const secretKey = new TextEncoder().encode(JWT_SECRET);

export interface SessionPayload {
  sub: string;
  role: Role;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (!payload.sub) return null;
    return { sub: payload.sub as string, role: (payload.role as Role) || "user" };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

/** Read + verify the session cookie and load the fresh user document. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  await ensureDb();
  return db.findUserById(session.sub);
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Guard for authenticated routes. Returns user or a 401 response. */
export async function requireUser(): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { response: jsonError("Authentication required", 401) };
  return { user };
}

/** Guard for admin-only routes. Returns user or 401/403 response. */
export async function requireAdmin(): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { response: jsonError("Authentication required", 401) };
  if (user.role !== "admin") return { response: jsonError("Admin access required", 403) };
  return { user };
}

export { toPublicUser };
export type { PublicUser, User };
