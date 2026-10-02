import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db, ensureDb } from "@/lib/db";
import { isEmailAllowed, isEmailFormat, RESEND_API_KEY } from "@/lib/config";
import { sendVerificationEmail } from "@/lib/email";
import { jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const name = String(body.name || "").trim().slice(0, 60);

    if (!isEmailFormat(email)) return jsonError("Please enter a valid email address.");
    if (!isEmailAllowed(email)) {
      return jsonError("Only Gmail and iCloud email addresses are supported.");
    }
    if (password.length < 8) {
      return jsonError("Password must be at least 8 characters long.");
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return jsonError("An account with this email already exists. Try signing in.", 409);
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await db.createUser({ email, passwordHash, name, role: "user", plan: "free" });

    const token = await db.createVerificationToken(user.id);
    const result = await sendVerificationEmail(email, token.token, user.name);

    return NextResponse.json({
      ok: true,
      emailSent: result.sent,
      // Dev-only convenience: expose the verification link when no email provider is configured
      devVerificationUrl: !RESEND_API_KEY ? result.devUrl : undefined,
    });
  } catch (err) {
    console.error("[signup]", err);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
