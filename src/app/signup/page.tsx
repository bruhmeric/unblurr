"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap, Mail, Lock, AlertTriangle, User, MailCheck, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function SignupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [done, setDone] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const next = params.get("next") || "/";

  const emailDomainAllowed = (() => {
    const domain = email.split("@")[1]?.toLowerCase() || "";
    return domain === "" || domain === "gmail.com" || domain === "icloud.com";
  })();

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!emailDomainAllowed) {
      setError("Only Gmail and iCloud email addresses are supported.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign-up failed. Please try again.");
        return;
      }
      setDone(true);
      if (data.devVerificationUrl) setDevUrl(data.devVerificationUrl);
      toast({
        title: "Account created",
        description: data.emailSent
          ? "Check your inbox for the verification link."
          : "Verification link generated (dev mode).",
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [name, email, password, emailDomainAllowed, toast]);

  if (done) {
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
            <Card className="border-white/10 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
                  <MailCheck className="h-7 w-7 text-emerald-400" />
                </div>
                <h1 className="mt-5 text-xl font-bold">Check your inbox</h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  We sent a verification link to <span className="text-zinc-200">{email}</span>.
                  Click it to activate your account, then sign in.
                </p>

                {devUrl && (
                  <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-left">
                    <p className="text-xs font-semibold text-amber-400">Dev mode — email service not configured</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                      No RESEND_API_KEY is set, so the verification link is shown here instead:
                    </p>
                    <a
                      href={devUrl}
                      className="mt-2 flex items-center gap-1.5 break-all text-xs font-medium text-emerald-400 underline-offset-4 hover:underline"
                    >
                      {devUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                )}

                <div className="mt-6 space-y-2">
                  <Button
                    asChild
                    className="h-11 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400"
                  >
                    <Link href={`/login?next=${encodeURIComponent(next)}`}>Go to sign in</Link>
                  </Button>
                  <button
                    onClick={() => {
                      setDone(false);
                      setDevUrl(null);
                      setPassword("");
                    }}
                    className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                  >
                    use a different email
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

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
            <p className="mt-3 text-sm text-zinc-500">Keep your video quality — free to start</p>
          </div>

          <Card className="border-white/10 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardContent className="p-6 sm:p-8">
              <h1 className="text-xl font-bold">Create your account</h1>
              <p className="mt-1 text-sm text-zinc-500">2 free videos every day</p>

              {error && (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span className="text-zinc-300">{error}</span>
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name <span className="text-zinc-600">(optional)</span></Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      id="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Alex"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 pl-9 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email <span className="text-zinc-600">(Gmail or iCloud only)</span></Label>
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
                      className={`h-11 pl-9 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600 ${
                        emailDomainAllowed
                          ? "border-white/10"
                          : "border-red-500/50 focus-visible:ring-red-500/30"
                      }`}
                    />
                  </div>
                  {!emailDomainAllowed && (
                    <p className="text-xs text-red-400">Only @gmail.com and @icloud.com addresses can sign up.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 pl-9 border-white/10 bg-white/[0.03] text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25"
                >
                  {loading ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  {loading ? "Creating account…" : "Create account"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-zinc-500">
                Already have an account?{" "}
                <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-emerald-400 underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-zinc-600">
            <Link href="/" className="inline-flex items-center gap-1.5 hover:text-zinc-400">
              <Zap className="h-3 w-3 text-emerald-500" /> unblurr.site
            </Link>
            <span className="mx-1.5">·</span> Keep your video quality
          </p>
        </div>
      </main>
    </div>
  );
}
