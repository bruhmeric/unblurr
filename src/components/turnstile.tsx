"use client";

/*
 * Cloudflare Turnstile widget (client component).
 * - Loads the Turnstile script once per page, renders explicitly.
 * - Reports the single-use token to the parent via onToken(null on expire/error).
 * - resetKey: bump this number to reset the challenge (e.g. after a failed
 *   login attempt — each token can only be verified once).
 */

import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAFMdXn1Cgv141VXv";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SSR"));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;

    const pollForApi = (deadlineMs: number) => {
      const start = Date.now();
      const poll = () => {
        if (window.turnstile) resolve(window.turnstile);
        else if (Date.now() - start > deadlineMs)
          reject(new Error("Turnstile failed to load"));
        else setTimeout(poll, 50);
      };
      poll();
    };

    script.onload = () => pollForApi(5000);
    script.onerror = () => {
      scriptPromise = null; // allow a retry on next mount
      reject(new Error("Turnstile script blocked"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  onToken,
  resetKey = 0,
}: {
  onToken: (token: string | null) => void;
  /** increment to reset the challenge (after a failed submit) */
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // (Re)render the widget
  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    setFailed(false);
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: "dark",
          callback: (token: string) => {
            setFailed(false);
            onTokenRef.current(token);
          },
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            setFailed(true);
          },
          "timeout-callback": () => {
            onTokenRef.current(null);
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* ignore — container already gone */
        }
      }
      widgetIdRef.current = null;
    };
  }, [attempt]);

  // External reset (single-use tokens: re-challenge after failed submit)
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === lastResetKey.current) return;
    lastResetKey.current = resetKey;
    onTokenRef.current(null);
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {
        /* fall through to full re-render */
      }
    } else {
      setAttempt((a) => a + 1);
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;

  if (failed) {
    return (
      <button
        type="button"
        onClick={() => {
          onTokenRef.current(null);
          setAttempt((a) => a + 1);
        }}
        className="flex h-[65px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/[0.12]"
      >
        <RefreshCw className="h-4 w-4" />
        Security check unavailable — click to retry
      </button>
    );
  }

  return (
    <div className="flex min-h-[65px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div ref={containerRef} />
      <noscript>
        <p className="px-4 text-xs text-zinc-500">
          Enable JavaScript to pass the security check.
        </p>
      </noscript>
    </div>
  );
}
