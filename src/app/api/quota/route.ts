import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Authentication required", 401);
    const quota = await db.getQuota(user.id);
    if (!quota) return jsonError("Account not found", 404);
    return NextResponse.json({ ok: true, quota });
  } catch (err) {
    console.error("[quota]", err);
    return jsonError("Something went wrong", 500);
  }
}
