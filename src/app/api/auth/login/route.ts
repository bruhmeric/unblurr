import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db, ensureDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/config";
import { createSessionToken, jsonError, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const expectAdmin = !!body.expectAdmin;

    const user = await db.findUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return jsonError("Incorrect email or password.", 401);
    }

    if (expectAdmin && user.role !== "admin") {
      return jsonError("This account does not have admin access.", 403);
    }

    if (!user.emailVerified && user.role !== "admin") {
      return jsonError("Please verify your email before signing in.", 403, {
        code: "unverified",
        email,
      });
    }

    const token = await createSessionToken({ sub: user.id, role: user.role });
    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
        emailVerified: user.emailVerified,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[login]", err);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
