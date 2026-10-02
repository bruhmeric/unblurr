import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const stats = await db.getStats();
    return NextResponse.json({ ok: true, stats, mode: db.mode });
  } catch (err) {
    console.error("[admin/stats]", err);
    return jsonError("Failed to load stats", 500);
  }
}
