import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return jsonError("Verification token missing.");

    const record = await db.findValidVerificationToken(token);
    if (!record) {
      return jsonError("This verification link is invalid or has expired. Request a new one.", 400);
    }

    const user = await db.findUserById(record.userId);
    if (!user) {
      await db.deleteVerificationToken(token);
      return jsonError("Account no longer exists.", 400);
    }

    await db.updateUser(user.id, { emailVerified: true });
    await db.deleteVerificationToken(token);

    return NextResponse.json({ ok: true, email: user.email });
  } catch (err) {
    console.error("[verify]", err);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
