"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Zap, Upload, Film, Download, RefreshCw, ShieldCheck,
  CheckCircle2, AlertTriangle, ChevronRight, Lock, Sparkles,
  FileVideo, Crown, LogOut, Gauge, LayoutDashboard, MailCheck, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ types */

type Phase = "idle" | "ready" | "processing" | "done" | "error" | "limit";

interface FileMeta {
  width: number;
  height: number;
  duration: number;
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  plan: "free" | "premium";
}

interface Quota {
  plan: "free" | "premium";
  role: "admin" | "user";
  limit: number; // -1 unlimited
  usedToday: number;
  remaining: number; // -1 unlimited
}

const friendlyStage = (p: number) =>
  p < 20 ? "Analyzing your video…" :
  p < 65 ? "Enhancing your video…" :
  p < 100 ? "Finalizing…" : "Complete";

/* ------------------------------------------------------------------ page */

export default function HomePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState<string>("");

  const [percent, setPercent] = useState(0);
  const [stage, setStage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [dragging, setDragging] = useState(false);
  const [outBytes, setOutBytes] = useState<number | null>(null);
  const [inBytes, setInBytes] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  /* ------------------------------------------------------- load session */

  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setQuota(data.quota);
      }
    } catch { /* offline tolerance */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login?next=/");
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setQuota(data.quota);
      } catch {
        router.replace("/login?next=/");
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [router]);

  /* ---------------------------------------------------- lifecycle helpers */

  const cleanupUrls = useCallback(() => {
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => () => {
    cleanupUrls();
    workerRef.current?.terminate();
  }, [cleanupUrls]);

  /* ---------------------------------------------------------- file input */

  const acceptFile = useCallback((f: File | null) => {
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const validExt = ["mp4", "mov", "m4v"];
    const validMime = f.type.startsWith("video/");
    if (!validExt.includes(ext) && !validMime) {
      setErrorMsg("Unsupported format. Please select a valid MP4 or MOV video file.");
      setPhase("error");
      return;
    }
    cleanupUrls();
    const url = URL.createObjectURL(f);
    objectUrlsRef.current.push(url);

    setFile(f);
    setPreviewUrl(url);
    setOutputUrl(null);
    setOutBytes(null);
    setInBytes(null);
    setErrorMsg("");
    setPhase("ready");

    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      setMeta({
        width: probe.videoWidth || 1280,
        height: probe.videoHeight || 720,
        duration: Number.isFinite(probe.duration) ? probe.duration : 0,
      });
    };
    probe.src = url;
  }, [cleanupUrls]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  }, [acceptFile]);

  /* ------------------------------------------------------------- process */

  const processVideo = useCallback(async () => {
    if (!file || phase === "processing") return;

    // Quota gate: free users with no remaining videos today
    if (quota && quota.limit !== -1 && quota.remaining <= 0) {
      setPhase("limit");
      return;
    }

    setPhase("processing");
    setPercent(0);
    setStage("Analyzing your video…");
    setErrorMsg("");

    try {
      const buffer = await file.arrayBuffer();
      const inSize = file.size;
      setInBytes(inSize);

      const worker = new Worker("/engine/task.js", { type: "module" });
      workerRef.current?.terminate();
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setPercent(msg.percent ?? 0);
          setStage(friendlyStage(msg.percent ?? 0));
        } else if (msg.type === "done") {
          const blob = new Blob([msg.buffer], { type: "video/mp4" });
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          setOutputUrl(url);
          setOutputName(msg.fileName || "video_unblurr.mp4");
          setOutBytes(msg.stats?.outputBytes ?? blob.size);
          setPercent(100);
          setStage("Complete");
          setPhase("done");
          worker.terminate();
          workerRef.current = null;

          // Record usage against the daily quota
          fetch("/api/quota/consume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name, fileSize: inSize }),
          })
            .then(async (r) => {
              if (r.ok) {
                const data = await r.json();
                setQuota(data.quota);
              } else if (r.status === 403) {
                const data = await r.json().catch(() => ({}));
                toast({
                  title: "Daily limit reached",
                  description: data.error || "Free plan includes 2 videos per day.",
                  variant: "destructive",
                });
                if (data.quota) setQuota(data.quota);
              }
            })
            .catch(() => { /* quota sync retries next load */ });
        } else if (msg.type === "error") {
          setErrorMsg(
            msg.error?.includes("audio track")
              ? "This video has no audio track, so it can't be enhanced. Please add an audio track and try again."
              : msg.error || "We couldn't process this video. Please try a different file."
          );
          setPhase("error");
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.onerror = () => {
        setErrorMsg("This browser couldn't start the enhancer. Please try a desktop browser.");
        setPhase("error");
      };

      worker.postMessage(
        { type: "process", buffer, fileName: file.name, options: {} },
        [buffer],
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed processing");
      setPhase("error");
    }
  }, [file, phase, quota, toast]);

  /* ------------------------------------------------------------ download */

  const download = useCallback(() => {
    if (!outputUrl || !outputName) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [outputUrl, outputName]);

  const reset = useCallback(() => {
    cleanupUrls();
    workerRef.current?.terminate();
    workerRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setMeta(null);
    setOutputUrl(null);
    setOutputName("");
    setOutBytes(null);
    setInBytes(null);
    setPercent(0);
    setStage("");
    setErrorMsg("");
    setPhase("idle");
    refreshQuota();
  }, [cleanupUrls, refreshQuota]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }, [router]);

  /* ---------------------------------------------------------------- view */

  const fmtMB = (b: number) => (b / 1048576).toFixed(2) + " MB";
  const unlimited = quota?.limit === -1;
  const remaining = quota?.limit === -1 ? "Unlimited" : `${Math.max(0, quota?.remaining ?? 0)} left today`;
  const stepIndex = phase === "idle" ? 0 : phase === "ready" || phase === "processing" ? 1 : 2;
  const busy = phase === "processing";

  return (
    <div className="min-h-screen flex flex-col bg-[#060809] text-zinc-100 selection:bg-emerald-500/30">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[42rem] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-72 w-72 rounded-full bg-teal-500/10 blur-[100px]" />
      </div>

      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#060809]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <img src="/logo.svg" alt="unblurr.site logo" className="h-9 w-9 rounded-xl" />
            <div className="leading-tight min-w-0">
              <div className="text-[15px] font-bold tracking-tight truncate">
                unblurr<span className="text-emerald-400">.site</span>
              </div>
              <div className="text-[11px] text-zinc-500 hidden sm:block">Keep your video quality</div>
            </div>
          </Link>
          {authChecked && user && (
            <div className="flex items-center gap-2 sm:gap-3">
              <Badge
                variant="outline"
                className={`hidden sm:inline-flex border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/10 ${
                  unlimited ? "" : quota && quota.remaining <= 0 ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/10" : ""
                }`}
              >
                {unlimited
                  ? (user.role === "admin" ? <Gauge className="mr-1 h-3 w-3" /> : <Crown className="mr-1 h-3 w-3" />)
                  : <Film className="mr-1 h-3 w-3" />}
                {remaining}
              </Badge>
              {user.role === "admin" && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-9 hidden md:inline-flex border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Link href="/admin/dashboard">
                    <LayoutDashboard className="mr-1.5 h-4 w-4" />
                    Admin
                  </Link>
                </Button>
              )}
              <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-gradient-to-br from-emerald-400/80 to-teal-600/80 text-[11px] font-bold text-[#060809]">
                    {(user.name || user.email)[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate text-xs font-medium text-zinc-300">{user.email}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                aria-label="Sign out"
                className="h-9 w-9 p-0 border-white/10 bg-white/5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------ main */}
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pb-16">
        {/* ------------------------------------------------------- hero */}
        <section className="pt-12 sm:pt-16 text-center">
          <Badge variant="outline" className="mb-5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/10 px-3 py-1">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Upload sharper. Every time.
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1]">
            Keep every pixel.
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              Stop quality loss on upload.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            Platforms love to squeeze your footage when you upload it. unblurr.site prepares
            your video so it keeps the exact quality you exported — <span className="text-zinc-200">no re-encoding,
            no quality loss, and your file never leaves your device.</span>
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            {[
              [FileVideo, ".mp4 & .mov"],
              [Lock, "Private — on your device"],
              [ShieldCheck, "100% quality kept"],
              [Zap, "Ready in seconds"],
            ].map(([Icon, label]: any, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300">
                <Icon className="h-3.5 w-3.5 text-emerald-400" />
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- stepper */}
        <section className="mt-12">
          <div className="mx-auto flex max-w-2xl items-center">
            {["Choose Video", "Enhance", "Download"].map((label, i) => {
              const active = i <= stepIndex;
              const current = i === stepIndex;
              return (
                <div key={label} className={`flex items-center ${i < 2 ? "flex-1" : ""}`}>
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 font-semibold text-sm transition-all ${
                      active
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                        : "border-white/10 bg-white/[0.03] text-zinc-600"
                    } ${current && busy ? "animate-pulse" : ""}`}>
                      {active && i < stepIndex ? <CheckCircle2 className="h-5 w-5" /> : i + 1}
                    </div>
                    <span className={`text-[11px] font-medium ${active ? "text-zinc-200" : "text-zinc-600"}`}>
                      {label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className={`mx-2 mb-5 h-0.5 flex-1 rounded ${i < stepIndex ? "bg-emerald-400/60" : "bg-white/10"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* -------------------------------------------- tool card */}
        <section className="mt-6">
          <Card className="overflow-hidden border-white/10 bg-[#0b0f11]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <CardContent className="p-5 sm:p-8">

              {/* STEP 1 — drop zone / preview */}
              {phase === "idle" && (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Select or drop a video file"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`group flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                    dragging
                      ? "border-emerald-400 bg-emerald-400/10 scale-[1.01]"
                      : "border-white/15 bg-white/[0.02] hover:border-emerald-400/50 hover:bg-emerald-400/[0.04]"
                  }`}
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] transition-colors group-hover:border-emerald-400/40">
                    <Upload className="h-7 w-7 text-emerald-400" />
                  </div>
                  <p className="mt-5 text-base font-semibold text-zinc-100">
                    Select video or drag &amp; drop your file here
                  </p>
                  <p className="mt-1.5 text-sm text-zinc-500">
                    Every common format is supported (.mp4, .mov, .m4v)
                  </p>
                  <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-500">
                    <Lock className="h-3.5 w-3.5 text-emerald-500" />
                    Your video is processed on this device and is never uploaded.
                  </p>
                </div>
              )}

              {(phase === "ready" || phase === "processing" || phase === "done" || phase === "error" || phase === "limit") && (
                <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
                  {/* preview player */}
                  <div className="flex flex-col gap-3">
                    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                      {previewUrl && (
                        <video
                          src={previewUrl}
                          controls
                          playsInline
                          className="aspect-video w-full"
                        />
                      )}
                      <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">
                        <span className="rounded-md bg-black/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-400 backdrop-blur">
                          source
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-zinc-300">
                        <Film className="h-3.5 w-3.5 text-emerald-400" />
                        {file?.name}
                      </span>
                      {meta && (
                        <>
                          <span>{meta.width}×{meta.height}</span>
                          <span>{meta.duration.toFixed(1)}s</span>
                        </>
                      )}
                      <span>{fmtMB(file?.size ?? 0)}</span>
                    </div>
                  </div>

                  {/* controls / progress */}
                  <div className="flex flex-col gap-4">
                    {phase === "ready" && (
                      <>
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                            <Sparkles className="h-4 w-4 text-emerald-400" />
                            Ready to enhance
                          </div>
                          <ul className="space-y-2 text-xs text-zinc-400">
                            <li className="flex items-start gap-2">
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                              <span>Your original video &amp; audio quality is kept — <span className="text-zinc-200">100% lossless</span></span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                              <span>Processed privately on this device — nothing is uploaded</span>
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                              <span>Ready in seconds — download and upload as your final step</span>
                            </li>
                          </ul>
                          {quota && quota.limit !== -1 && (
                            <p className="text-[11px] leading-relaxed text-zinc-500">
                              Free plan: <span className="text-zinc-300">{quota.remaining} of {quota.limit} videos left today</span>.
                              Premium members process unlimited videos.
                            </p>
                          )}
                        </div>

                        <Button
                          size="lg"
                          onClick={processVideo}
                          disabled={quota ? quota.limit !== -1 && quota.remaining <= 0 : false}
                          className="h-12 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25"
                        >
                          <Zap className="mr-2 h-5 w-5" />
                          Enhance Video
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                        <button
                          onClick={reset}
                          className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
                        >
                          choose a different file
                        </button>
                      </>
                    )}

                    {(phase === "processing" || phase === "done") && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                            {phase === "done" ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <span className="relative flex h-3 w-3">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                              </span>
                            )}
                            {phase === "done" ? "Success" : "Enhancing"}
                          </span>
                          <span className={`font-mono text-sm font-semibold ${phase === "done" ? "text-emerald-400" : "text-zinc-300"}`}>
                            {percent}%
                          </span>
                        </div>
                        <Progress
                          value={percent}
                          className="h-2 bg-white/5 *:data-[slot=progress-indicator]:bg-gradient-to-r *:data-[slot=progress-indicator]:from-emerald-500 *:data-[slot=progress-indicator]:to-teal-400"
                        />
                        <p className="mt-2 text-xs text-zinc-500">{stage}</p>
                      </div>
                    )}

                    {phase === "done" && outputUrl && (
                      <>
                        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-sm">
                          <div className="flex items-center gap-2 font-semibold text-emerald-400">
                            <ShieldCheck className="h-4 w-4" />
                            100% of your original quality kept
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                            Your video is ready to download and upload.
                            {outBytes != null && inBytes != null && (
                              <span className="ml-1 font-mono">
                                ({fmtMB(inBytes)} → {fmtMB(outBytes)})
                              </span>
                            )}
                          </p>
                        </div>
                        <Button
                          size="lg"
                          onClick={download}
                          className="h-12 w-full text-[15px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-[#060809] hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25"
                        >
                          <Download className="mr-2 h-5 w-5" />
                          Download Enhanced Video (.mp4)
                        </Button>
                        <Button
                          variant="outline"
                          onClick={reset}
                          className="w-full border-white/15 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06] hover:text-white"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Enhance another video
                        </Button>
                      </>
                    )}

                    {phase === "limit" && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
                          <Gauge className="h-4 w-4" />
                          Daily free limit reached
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                          Your free plan includes <span className="text-zinc-200">2 enhanced videos per day</span>.
                          Premium members enjoy unlimited processing — premium access is granted by the
                          site administrator. Your quota resets every day at 00:00 UTC.
                        </p>
                        <Button
                          variant="outline"
                          onClick={reset}
                          className="mt-4 border-white/15 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06] hover:text-white"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Back
                        </Button>
                      </div>
                    )}

                    {phase === "error" && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
                          <AlertTriangle className="h-4 w-4" />
                          Processing failed
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{errorMsg}</p>
                        <Button
                          variant="outline"
                          onClick={reset}
                          className="mt-3 border-white/15 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06] hover:text-white"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Try another file
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <input
                ref={inputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/mov,.mp4,.mov,.m4v"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
            </CardContent>
          </Card>
        </section>

        {/* ----------------------------------------------- benefits */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Why creators use unblurr.site
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-zinc-400">
            You spend hours getting your edit perfect — don't let a blurry upload undo it.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: ShieldCheck,
                title: "Zero quality loss",
                body: "Your exported video and audio data is preserved exactly as you rendered it. What you upload is what your audience sees.",
              },
              {
                icon: Lock,
                title: "Private by design",
                body: "Enhancement happens right on your device. Your footage is never uploaded, stored, or shared anywhere.",
              },
              {
                icon: Zap,
                title: "Fast & simple",
                body: "Drop your file, enhance, download. Most videos are ready in seconds — no queues, no waiting.",
              },
              {
                icon: Crown,
                title: "Free to start",
                body: "Every account gets free daily enhancements. Premium members unlock unlimited processing, granted by the admin team.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <Card key={title} className="border-white/10 bg-[#0b0f11]/80 backdrop-blur">
                <CardContent className="p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10">
                    <Icon className="h-5 w-5 text-emerald-400" />
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold text-zinc-100">{title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- faq */}
        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mx-auto mt-8 max-w-3xl">
            <Accordion type="single" collapsible className="space-y-3">
              {[
                {
                  q: "Will my video lose quality?",
                  a: "No. unblurr.site never re-encodes your video or audio — the enhancement is lossless, so every pixel and every sound stays exactly as you exported it.",
                },
                {
                  q: "Is my file uploaded anywhere?",
                  a: "No. Your video is enhanced entirely on your device and never leaves your browser. You can even go offline after the page loads and it still works.",
                },
                {
                  q: "Which formats are supported?",
                  a: "MP4 and MOV files with an audio track — this covers virtually every export from modern editing software.",
                },
                {
                  q: "How many videos can I enhance?",
                  a: "Free accounts can enhance 2 videos per day. Premium members get unlimited processing. Premium access is granted by the site administrator.",
                },
                {
                  q: "Which email addresses can sign up?",
                  a: "Currently we support Gmail and iCloud email addresses for account creation and verification.",
                },
                {
                  q: "How do I use the result?",
                  a: "Enhance your video as the final step, download it, then upload it from a desktop web browser for the best outcome.",
                },
              ].map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="rounded-xl border border-white/10 bg-[#0b0f11]/80 px-5 backdrop-blur data-[state=open]:border-emerald-500/25"
                >
                  <AccordionTrigger className="py-4 text-left text-[15px] font-medium text-zinc-200 hover:text-emerald-300 hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 text-[13.5px] leading-relaxed text-zinc-400">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* ---------------------------------------------------- privacy */}
        <section className="mt-12">
          <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] to-transparent">
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left sm:gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
                <MailCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-zinc-100">
                  Your videos stay yours
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                  Enhancement happens privately inside this browser tab — there is no upload step
                  and nothing is stored. Perfect for confidential footage and maximum performance.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="relative z-10 mt-auto border-t border-white/5 bg-[#060809]/90">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Zap className="h-4 w-4 text-emerald-500" />
              <span className="font-medium text-zinc-300">unblurr.site</span>
              <span>· keep your video quality</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-600">
              <Link href="/login" className="hover:text-zinc-400">Sign in</Link>
              <Link href="/signup" className="hover:text-zinc-400">Create account</Link>
              <a
                href="mailto:unblurr@proton.me"
                className="inline-flex items-center gap-1.5 hover:text-zinc-400"
                title="Contact us"
              >
                <Mail className="h-3.5 w-3.5 text-emerald-500" />
                unblurr@proton.me
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
