import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * PATCH — update a user (plan / role) or run an action (reset today's usage).
 * Body: { plan?: "free" | "premium", action?: "reset-usage" }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const target = await db.findUserById(id);
    if (!target) return jsonError("User not found", 404);

    if (body.action === "reset-usage") {
      const removed = await db.resetTodayUsage(id);
      return NextResponse.json({ ok: true, removed });
    }

    const patch: { plan?: "free" | "premium"; role?: "admin" | "user" } = {};
    if (body.plan === "free" || body.plan === "premium") patch.plan = body.plan;

    if (Object.keys(patch).length === 0) {
      return jsonError("Nothing to update.");
    }

    // Safety: never demote the last admin / the seeded admin account
    if (target.role === "admin" && patch.plan === "free") {
      return jsonError("Admin accounts always have unlimited processing.", 400);
    }

    const updated = await db.updateUser(id, patch);
    if (!updated) return jsonError("User not found", 404);
    const { passwordHash: _ph, ...pub } = updated;
    return NextResponse.json({ ok: true, user: pub });
  } catch (err) {
    console.error("[admin/users/id PATCH]", err);
    return jsonError("Failed to update user", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const { id } = await params;
    const target = await db.findUserById(id);
    if (!target) return jsonError("User not found", 404);
    if (target.role === "admin") {
      return jsonError("Admin accounts cannot be deleted from the dashboard.", 400);
    }
    const deleted = await db.deleteUser(id);
    if (!deleted) return jsonError("Could not delete user", 500);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/users/id DELETE]", err);
    return jsonError("Failed to delete user", 500);
  }
}
