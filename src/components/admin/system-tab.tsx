"use client";

import { Database, Mail, Gauge, ShieldCheck, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SystemTab({ mode }: { mode: "mongodb" | "file" | null }) {
  const rows = [
    {
      icon: Database,
      title: "Database",
      value: mode === "mongodb" ? "MongoDB Atlas — connected" : mode === "file" ? "Demo file storage (local)" : "Unknown",
      ok: mode === "mongodb",
      detail:
        mode === "mongodb"
          ? "MONGODB_URI is set. Data persists in your Atlas cluster (collections: users, verification_tokens, processing_logs, email_logs)."
          : "MONGODB_URI is not configured. Set it in Vercel → Project → Settings → Environment Variables to use MongoDB Atlas.",
    },
    {
      icon: Mail,
      title: "Email delivery (Resend)",
      value: "Configured via RESEND_API_KEY",
      ok: true,
      detail:
        "Verification emails are delivered through the Resend API. Set RESEND_API_KEY and EMAIL_FROM (a verified sender on your Resend account). Without the key, the site runs in dev mode and shows verification links on-screen instead.",
    },
    {
      icon: Gauge,
      title: "Free daily limit",
      value: "2 videos / day",
      ok: true,
      detail: "Free accounts can enhance 2 videos per UTC day. Premium members and admins have unlimited processing. Tune with FREE_DAILY_LIMIT.",
    },
    {
      icon: ShieldCheck,
      title: "Admin account",
      value: "bruhmeric@gmail.com",
      ok: true,
      detail: "Seeded automatically on first run (ADMIN_EMAIL / ADMIN_PASSWORD env vars). Admins bypass email verification and process unlimited videos.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ icon: Icon, title, value, ok, detail }) => (
          <Card key={title} className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10">
                    <Icon className="h-4.5 w-4.5 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
                </div>
                <Badge
                  variant="outline"
                  className={ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}
                >
                  {ok ? "active" : "attention"}
                </Badge>
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-300">{value}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-transparent">
        <CardContent className="flex items-start gap-3 p-5">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="text-sm">
            <h3 className="font-semibold text-zinc-100">Deploying to Vercel</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Set these environment variables in your Vercel project:{" "}
              <span className="font-mono text-zinc-300">MONGODB_URI</span> (Atlas connection string),{" "}
              <span className="font-mono text-zinc-300">RESEND_API_KEY</span>,{" "}
              <span className="font-mono text-zinc-300">EMAIL_FROM</span>,{" "}
              <span className="font-mono text-zinc-300">JWT_SECRET</span> (any long random string),{" "}
              <span className="font-mono text-zinc-300">NEXT_PUBLIC_SITE_URL</span> (your production URL),{" "}
              <span className="font-mono text-zinc-300">ADMIN_EMAIL</span> and{" "}
              <span className="font-mono text-zinc-300">ADMIN_PASSWORD</span>. Optionally set{" "}
              <span className="font-mono text-zinc-300">FREE_DAILY_LIMIT</span> and{" "}
              <span className="font-mono text-zinc-300">MONGODB_DB</span>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
