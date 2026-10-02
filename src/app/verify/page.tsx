"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [state, setState] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its token.");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (!token) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState("success");
          setMessage(`${data.email || "Your email"} is now verified. You can sign in and start enhancing videos.`);
        } else {
          setState("error");
          setMessage(data.error || "This verification link is invalid or has expired.");
        }
      } catch {
        setState("error");
        setMessage("Network error — please try again.");
      }
    })();
  }, [token]);

  return (
    <Card className="border-white/10 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <CardContent className="p-6 sm:p-8 text-center">
        {state === "loading" && (
          <>
            <RefreshCw className="mx-auto h-12 w-12 animate-spin text-emerald-400" />
            <h1 className="mt-5 text-xl font-bold">Verifying your email…</h1>
            <p className="mt-2 text-sm text-zinc-500">Hang tight, this only takes a moment.</p>
          </>
        )}
        {state === "success" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-xl font-bold">Email verified!</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</p>
            <Button
              asChild
              className="mt-6 h-11 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400"
            >
              <Link href="/login?verified=1">Continue to sign in</Link>
            </Button>
          </>
        )}
        {state === "error" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
            <h1 className="mt-5 text-xl font-bold">Verification failed</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</p>
            <Button
              asChild
              variant="outline"
              className="mt-6 w-full border-white/15 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06] hover:text-white"
            >
              <Link href="/login">Go to sign in</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#060809] text-zinc-100 selection:bg-emerald-500/30">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[42rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <img src="/logo.svg" alt="unblurr.site logo" className="h-11 w-11 rounded-xl" />
              <span className="text-xl font-bold tracking-tight">
                unblurr<span className="text-emerald-400">.site</span>
              </span>
            </Link>
          </div>
          <Suspense
            fallback={
              <div className="flex justify-center py-10">
                <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
              </div>
            }
          >
            <VerifyInner />
          </Suspense>
          <p className="mt-6 text-center text-xs text-zinc-600">
            <Link href="/" className="inline-flex items-center gap-1.5 hover:text-zinc-400">
              <Zap className="h-3 w-3 text-emerald-500" /> unblurr.site
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
