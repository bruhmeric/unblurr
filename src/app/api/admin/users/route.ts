import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(5, Number.parseInt(url.searchParams.get("pageSize") || "10", 10) || 10));
    const result = await db.listUsers({ search, page, pageSize });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin/users]", err);
    return jsonError("Failed to load users", 500);
  }
}
