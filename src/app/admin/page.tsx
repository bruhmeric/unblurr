"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Mail, Lock, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Turnstile } from "@/components/turnstile";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, expectAdmin: true, turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Admin sign-in failed.");
        // Turnstile tokens are single-use — re-challenge for the next attempt
        setTurnstileReset((n) => n + 1);
        return;
      }
      router.replace("/admin/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setTurnstileReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }, [email, password, turnstileToken, router]);

  return (
    <div className="min-h-screen flex flex-col bg-[#060809] text-zinc-100 selection:bg-emerald-500/30">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[42rem] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-teal-500/10 blur-[100px]" />
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
            <p className="mt-3 text-sm text-zinc-500">Administration console</p>
          </div>

          <Card className="border-emerald-500/20 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardContent className="p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-lg font-bold leading-tight">Admin sign-in</h1>
                  <p className="text-xs text-zinc-500">Restricted area — authorized staff only</p>
                </div>
              </div>

              {error && (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span className="text-zinc-300">{error}</span>
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Admin email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="admin@example.com"
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
                  {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {loading ? "Signing in…" : "Enter admin console"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-zinc-600">
            Not an admin?{" "}
            <Link href="/login" className="hover:text-zinc-400">Return to sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
