import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { isEmailAllowed, isEmailFormat, RESEND_API_KEY } from "@/lib/config";
import { sendVerificationEmail } from "@/lib/email";
import { jsonError } from "@/lib/auth";

export const runtime = "nodejs";

const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resends

export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();

    if (!isEmailFormat(email) || !isEmailAllowed(email)) {
      return jsonError("Enter the Gmail or iCloud address you signed up with.");
    }

    const user = await db.findUserByEmail(email);
    if (!user || user.emailVerified) {
      // Do not reveal account existence
      return NextResponse.json({ ok: true });
    }

    const latest = await db.findLatestTokenForUser(user.id);
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < RESEND_COOLDOWN_MS) {
      return jsonError("Please wait a minute before requesting another email.", 429);
    }

    const token = await db.createVerificationToken(user.id);
    const result = await sendVerificationEmail(email, token.token, user.name);

    return NextResponse.json({
      ok: true,
      emailSent: result.sent,
      devVerificationUrl: !RESEND_API_KEY ? result.devUrl : undefined,
    });
  } catch (err) {
    console.error("[resend]", err);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
