import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";
import { toPublicUser } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Authentication required", 401);

    const quota = await db.getQuota(user.id);
    return NextResponse.json({
      ok: true,
      user: toPublicUser(user),
      quota,
    });
  } catch (err) {
    console.error("[me]", err);
    return jsonError("Something went wrong", 500);
  }
}
