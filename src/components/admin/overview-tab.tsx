"use client";

import { useEffect, useState } from "react";
import {
  Users, MailCheck, Crown, User, Film, Play, Mail, HardDrive, RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { StatsSummary } from "@/lib/types";
import { fmtBytes, fmtDay } from "./format";

interface StatCard {
  icon: any;
  label: string;
  value: string;
  accent: string;
}

export function OverviewTab({ mode }: { mode: "mongodb" | "file" | null }) {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to load stats");
        return;
      }
      setStats(data.stats);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/[0.05]">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-3 text-xs text-emerald-400 underline-offset-4 hover:underline">
            Try again
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const cards: StatCard[] = [
    { icon: Users, label: "Total users", value: String(stats.totalUsers), accent: "text-emerald-400" },
    { icon: MailCheck, label: "Verified users", value: String(stats.verifiedUsers), accent: "text-teal-300" },
    { icon: Crown, label: "Premium members", value: String(stats.premiumUsers), accent: "text-amber-400" },
    { icon: User, label: "Free members", value: String(stats.freeUsers), accent: "text-zinc-300" },
    { icon: Film, label: "Videos today", value: String(stats.videosToday), accent: "text-emerald-400" },
    { icon: Play, label: "Videos all-time", value: String(stats.videosTotal), accent: "text-teal-300" },
    { icon: Mail, label: "Emails delivered", value: String(stats.emailsSent), accent: "text-sky-300" },
    { icon: HardDrive, label: "Video data processed", value: fmtBytes(stats.bytesProcessed), accent: "text-violet-300" },
  ];

  return (
    <div className="space-y-6">
      {mode === "file" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-300">
          Demo data mode — MONGODB_URI is not configured. User data is stored locally and will reset.
          Set your MongoDB Atlas connection string in the environment to persist data.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ icon: Icon, label, value, accent }) => (
          <Card key={label} className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
                <Icon className={`h-4 w-4 ${accent}`} />
              </div>
              <div className="mt-3 text-2xl font-bold tracking-tight text-zinc-100">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">Videos processed — last 14 days</h3>
              <button onClick={load} className="text-zinc-500 hover:text-emerald-400" aria-label="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.dailyProcessing.map((d) => ({ ...d, label: fmtDay(d.date) }))}>
                  <defs>
                    <linearGradient id="gProc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: "#0b0f11", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "#a1a1aa" }}
                    itemStyle={{ color: "#34d399" }}
                  />
                  <Area type="monotone" dataKey="count" name="Videos" stroke="#34d399" strokeWidth={2} fill="url(#gProc)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">New users — last 14 days</h3>
              <button onClick={load} className="text-zinc-500 hover:text-emerald-400" aria-label="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.dailySignups.map((d) => ({ ...d, label: fmtDay(d.date) }))}>
                  <defs>
                    <linearGradient id="gSign" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: "#0b0f11", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "#a1a1aa" }}
                    itemStyle={{ color: "#2dd4bf" }}
                  />
                  <Area type="monotone" dataKey="count" name="Signups" stroke="#2dd4bf" strokeWidth={2} fill="url(#gSign)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
