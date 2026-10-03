"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap, Mail, Lock, AlertTriangle, MailCheck, RefreshCw, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Turnstile } from "@/components/turnstile";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const justVerified = params.get("verified") === "1";
  const next = params.get("next") || "/";

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) return;
    setError("");
    setUnverified(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign-in failed. Please try again.");
        if (data.code === "unverified") setUnverified(true);
        // Turnstile tokens are single-use — re-challenge for the next attempt
        setTurnstileReset((n) => n + 1);
        return;
      }
      toast({ title: "Welcome back!", description: "Signed in successfully." });
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setTurnstileReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }, [email, password, turnstileToken, next, router, toast]);

  const resend = useCallback(async () => {
    setResending(true);
    try {
      const res = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't resend", description: data.error || "Try again shortly.", variant: "destructive" });
        return;
      }
      toast({
        title: "Verification email sent",
        description: data.devVerificationUrl
          ? "Dev mode — opening the verification link."
          : `Check ${email} for your new verification link.`,
      });
      if (data.devVerificationUrl) {
        window.location.href = data.devVerificationUrl;
      }
    } finally {
      setResending(false);
    }
  }, [email, toast]);

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
            <p className="mt-3 text-sm text-zinc-500">Keep your video quality — sign in to continue</p>
          </div>

          <Card className="border-white/10 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardContent className="p-6 sm:p-8">
              <h1 className="text-xl font-bold">Welcome back</h1>
              <p className="mt-1 text-sm text-zinc-500">Gmail &amp; iCloud accounts only</p>

              {justVerified && (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5 text-sm">
                  <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="text-zinc-300">
                    Email verified — you can sign in now.
                  </span>
                </div>
              )}

              {error && (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div className="min-w-0">
                    <span className="text-zinc-300">{error}</span>
                    {unverified && (
                      <>
                        <button
                          onClick={resend}
                          disabled={resending || !email}
                          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} />
                          {resending ? "Sending…" : "Resend verification email"}
                        </button>
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-zinc-500">
                          <FolderSearch className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
                          <span>
                            Can&apos;t find the email? Check your <span className="text-zinc-400">spam</span> or
                            junk folder — verification emails often land there.
                          </span>
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@gmail.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 pl-9 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-9 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Security check</Label>
                    <span className="text-[11px] text-zinc-600">Powered by Cloudflare</span>
                  </div>
                  <Turnstile onToken={setTurnstileToken} resetKey={turnstileReset} />
                </div>
                <Button
                  type="submit"
                  disabled={loading || !turnstileToken}
                  className="h-11 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25"
                >
                  {loading ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-zinc-500">
                New to unblurr.site?{" "}
                <Link href="/signup" className="font-medium text-emerald-400 underline-offset-4 hover:underline">
                  Create an account
                </Link>
              </p>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-zinc-600">
            <Link href="/" className="inline-flex items-center gap-1.5 hover:text-zinc-400">
              <Zap className="h-3 w-3 text-emerald-500" /> unblurr.site
            </Link>
            <span className="mx-1.5">·</span>
            Keep your video quality
            <span className="mx-1.5">·</span>
            <a href="mailto:unblurr@proton.me" className="inline-flex items-center gap-1 hover:text-zinc-400">
              <Mail className="h-3 w-3 text-emerald-500" /> unblurr@proton.me
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary during static prerender
// (Vercel builds fail otherwise — see Next.js docs: missing-suspense-with-csr-bailout)
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#060809]">
          <RefreshCw className="h-5 w-5 animate-spin text-emerald-400" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
