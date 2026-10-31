'use client';

import { useMemo } from 'react';
import {
  BadgeCheck, CircleAlert, FileScan, Fingerprint, ImageOff, Info,
  ShieldCheck, Sparkles, Waves,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useUntrace } from '@/lib/untrace/store';
import {
  KIND_META, VERDICT_META, formatBytes, type FileResult, type Finding, type ScoreReason, type SynthidInfo,
} from '@/lib/untrace/types';
import { cn } from '@/lib/utils';

/* Where a detection signal came from, in plain language. */
const REASON_SOURCE: Record<ScoreReason['type'], string> = {
  evidence: 'In the metadata',
  indicator: 'In the image',
  name: 'In the filename',
};

function ScoreGauge({ score, verdict }: { score: number; verdict: FileResult['verdict'] }) {
  const meta = VERDICT_META[verdict];
  const R = 44;
  const C = 2 * Math.PI * R;
  const filled = (score / 100) * C;
  return (
    <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={R} fill="none"
          className={cn('transition-all duration-700', meta.ring)}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${filled} ${C - filled}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('font-display text-2xl font-bold', meta.tone)}>{score}</span>
        <span className="text-[9px] uppercase tracking-widest text-slate-500">AI score</span>
      </div>
    </div>
  );
}

/* --- Invisible watermark (SynthID-class) check panel --- */

function wmStatus(s: SynthidInfo) {
  if (s.detected) return { label: 'Watermark found', tone: 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300', bar: 'bg-fuchsia-400' };
  if (s.possible) return { label: 'Faint signal', tone: 'border-amber-400/40 bg-amber-400/10 text-amber-300', bar: 'bg-amber-400' };
  return { label: 'None found', tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', bar: 'bg-emerald-400' };
}

function WatermarkCheck({ r }: { r: FileResult }) {
  const s = r.synthid;
  if (!s) return null;
  const st = wmStatus(s);
  const pct = Math.round(s.confidence * 100);

  return (
    <section
      aria-label="Invisible watermark check"
      className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Waves className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
          Invisible watermark check
        </h4>
        <span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', st.tone)}>{st.label}</span>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {/* before */}
        <div>
          <p className="text-xs leading-relaxed text-slate-400">
            {s.detected
              ? 'Found a hidden pattern woven into the pixels — the signature of invisible AI watermarks like Google\u2019s SynthID.'
              : s.possible
                ? 'Detected a faint hidden pattern in the pixels. It may be an invisible watermark — or ordinary image texture.'
                : 'No hidden watermark pattern found in the pixels.'}
          </p>
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
              <span>Pattern strength</span>
              <span className="font-mono normal-case text-slate-400">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn('h-full rounded-full transition-all duration-700', st.bar)}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </div>
        </div>

        {/* after */}
        <div className="rounded-lg border border-white/8 bg-black/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">After cleaning</p>
          {s.after ? (
            s.removed ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-emerald-300">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Pattern broken — no longer detectable
                  {typeof s.reduced === 'number' && s.reduced > 0 && (
                    <span className="text-emerald-400/80"> (signal down {s.reduced}%)</span>
                  )}
                  .
                </span>
              </p>
            ) : (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-300">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Signal weakened{typeof s.reduced === 'number' && s.reduced > 0 && ` (${s.reduced}%)`} but traces may remain — try the Aggressive strength for stubborn watermarks.
                </span>
              </p>
            )
          ) : s.detected && r.mode === 'lossless' ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-300">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>This watermark lives inside the pixels — a metadata-only clean can’t touch it. Re-run with Deep Clean.</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {r.mode === 'deep'
                ? 'Deep Clean applied — pixels were subtly reshuffled to break any hidden pattern.'
                : 'Nothing to remove.'}
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        Statistical estimate, computed entirely in your browser — not a Google-supplied verdict.
      </p>
    </section>
  );
}

export function DetailDialog({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const item = useUntrace((s) => s.items.find((i) => i.id === fileId));
  const r = item?.result;

  const grouped = useMemo(() => {
    if (!r) return [] as [string, Finding[]][];
    const map = new Map<string, Finding[]>();
    for (const f of r.findings) {
      const list = map.get(f.kind) ?? [];
      list.push(f);
      map.set(f.kind, list);
    }
    return [...map.entries()];
  }, [r]);

  return (
    <Dialog open={!!fileId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden border-white/10 bg-[#0a1017] p-0 nice-scroll sm:max-w-3xl">
        {r && (
          <>
            {/* header */}
            <DialogHeader className="space-y-0 border-b border-white/8 p-5 text-left sm:p-6">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="font-display truncate text-lg text-slate-100">
                    {r.originalName}
                  </DialogTitle>
                  <DialogDescription className="mt-1 truncate font-mono text-xs text-emerald-300/90">
                    saved as {r.outputName}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="dialog-scroll max-h-[74vh] overflow-y-auto">
              {/* summary band: preview + score + facts */}
              <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6 sm:p-6">
                {/* preview */}
                <div className="mx-auto flex h-36 w-36 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] sm:mx-0">
                  {r.thumb ? (
                    <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1.5 text-slate-600">
                      <ImageOff className="h-7 w-7" aria-hidden="true" />
                      <span className="text-[10px] uppercase tracking-wider">No preview</span>
                    </span>
                  )}
                </div>

                {/* facts */}
                <div className="min-w-0 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold', VERDICT_META[r.verdict].tone)}>
                      {VERDICT_META[r.verdict].label}
                    </span>
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-medium', r.findings.length > 0 ? 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300' : 'border-white/10 bg-white/[0.03] text-slate-400')}>
                      <Sparkles className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      {r.findings.length > 0
                        ? `${r.findings.length} trace${r.findings.length === 1 ? '' : 's'} removed`
                        : 'No traces found'}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-slate-500">Format</dt>
                      <dd className="mt-0.5 font-medium uppercase text-slate-200">{r.format}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Size</dt>
                      <dd className="mt-0.5 font-medium text-slate-200">
                        {formatBytes(r.originalSize)} → {formatBytes(r.outputSize)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Quality</dt>
                      <dd className="mt-0.5 font-medium text-slate-200">
                        {r.mode === 'lossless' ? 'Identical to original' : 'Visually unchanged'}
                      </dd>
                    </div>
                  </dl>
                  <p
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium',
                      r.verifiedClean
                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                        : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                    )}
                  >
                    {r.verifiedClean ? <BadgeCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                    {r.verifiedClean
                      ? 'Double-checked — no known traces remain'
                      : `${r.leftoverFindings.length} trace${r.leftoverFindings.length === 1 ? '' : 's'} could not be fully removed`}
                  </p>
                </div>

                {/* score */}
                <div className="mx-auto sm:mx-0">
                  <ScoreGauge score={r.aiScore} verdict={r.verdict} />
                </div>
              </div>

              <div className="space-y-5 px-5 pb-6 sm:px-6">
                {/* invisible watermark check */}
                <WatermarkCheck r={r} />

                {/* reasons */}
                {r.reasons.length > 0 && (
                  <section aria-label="Why this verdict">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <Fingerprint className="h-3.5 w-3.5 text-emerald-300" /> Why this verdict
                    </h4>
                    <ul className="mt-2.5 space-y-1.5">
                      {r.reasons.map((reason, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                reason.type === 'evidence' ? 'bg-rose-400' : reason.type === 'indicator' ? 'bg-amber-400' : 'bg-slate-500'
                              )}
                            />
                            {reason.text}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-600">
                            {REASON_SOURCE[reason.type]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* findings */}
                <section aria-label="Removed traces">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <FileScan className="h-3.5 w-3.5 text-emerald-300" />
                    What was removed
                  </h4>
                  {r.findings.length === 0 ? (
                    <p className="mt-2.5 rounded-lg border border-white/8 bg-white/[0.02] p-3 text-sm text-slate-500">
                      This file was already clean — no hidden metadata or AI traces were found.
                    </p>
                  ) : (
                    <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {grouped.map(([kind, list]) => {
                        const meta = KIND_META[kind] ?? KIND_META.other;
                        return (
                          <div key={kind} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold', meta.tone)}>{meta.label}</span>
                              <span className="text-[11px] text-slate-500">
                                {list.length} item{list.length > 1 ? 's' : ''}
                              </span>
                            </div>
                            <ul className="mt-2 space-y-1">
                              {list.map((f, i) => (
                                <li key={i} className="text-xs leading-relaxed">
                                  <span className="text-slate-300">{f.label}</span>
                                  {f.detail && <span className="text-slate-500"> — {f.detail}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* notes */}
                {r.notes.length > 0 && (
                  <section aria-label="Notes">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <Info className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                      Good to know
                    </h4>
                    <ul className="mt-2.5 space-y-1.5">
                      {r.notes.map((n, i) => (
                        <li key={i} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-slate-400">
                          {n}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </div>

            {/* scroll affordance: fade hinting more content below */}
            {r.findings.length > 2 && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-lg bg-gradient-to-t from-[#0a1017] via-[#0a1017]/85 to-transparent"
                aria-hidden="true"
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
