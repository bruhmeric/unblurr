import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "email" ? "email" : "processing";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
    const result =
      kind === "email"
        ? await db.listEmailLogs({ page, pageSize })
        : await db.listProcessingLogs({ page, pageSize });
    return NextResponse.json({ ok: true, kind, ...result });
  } catch (err) {
    console.error("[admin/logs]", err);
    return jsonError("Failed to load logs", 500);
  }
}
