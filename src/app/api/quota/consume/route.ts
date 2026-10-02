import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Authentication required", 401);
    if (!user.emailVerified && user.role !== "admin") {
      return jsonError("Email not verified", 403, { code: "unverified" });
    }

    const body = await req.json().catch(() => ({}));
    const fileName = String(body.fileName || "video.mp4").slice(0, 200);
    const fileSize = Number(body.fileSize) || 0;

    const result = await db.consumeQuota(user.id, { fileName, fileSize });
    if (!result.ok) {
      return jsonError(
        result.reason === "daily_limit"
          ? "Daily free limit reached. Premium is required to process more videos today."
          : "Could not record this video. Please refresh and try again.",
        403,
        { code: result.reason, quota: result.quota }
      );
    }
    return NextResponse.json({ ok: true, quota: result.quota });
  } catch (err) {
    console.error("[quota/consume]", err);
    return jsonError("Something went wrong", 500);
  }
}
