/* Cloudflare Turnstile — server-side verification helper.
 *
 * SERVER USE ONLY. Do not import this module from client components:
 * it holds the secret key fallback.
 *
 * Env overrides (both optional — sensible defaults are baked in so the
 * site works out of the box; set them in Vercel to rotate keys):
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (client widget)
 *   TURNSTILE_SECRET_KEY            (this file, server only)
 */

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const TURNSTILE_SECRET_KEY =
  process.env.TURNSTILE_SECRET_KEY || "0x4AAAAAAFMdXgZrhA6CwSnz3gKheazR5og";

export interface TurnstileResult {
  ok: boolean;
  /** true when the check was skipped (no secret configured) rather than failed */
  skipped: boolean;
}

/**
 * Verify a Turnstile token with Cloudflare.
 * Tokens are single-use: verify exactly once per submission.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string
): Promise<TurnstileResult> {
  // No secret configured at all → feature disabled (never happens with
  // baked-in default, kept for safety when env explicitly empties it).
  if (!TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };

  const response = String(token ?? "").trim();
  if (!response) return { ok: false, skipped: false };

  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, skipped: false };

    const data = (await res.json().catch(() => null)) as
      | { success?: boolean }
      | null;
    return { ok: data?.success === true, skipped: false };
  } catch {
    // Network/timeout — treat as failed (fail closed).
    return { ok: false, skipped: false };
  }
}
