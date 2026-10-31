'use client';

import { memo } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Download, Loader2,
  ShieldCheck, X, FileWarning,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUntrace, type QueueItem } from '@/lib/untrace/store';
import { KIND_META, VERDICT_META, formatBytes } from '@/lib/untrace/types';
import { cn } from '@/lib/utils';

const FORMAT_COLORS: Record<string, string> = {
  jpeg: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
  png: 'bg-sky-400/15 text-sky-300 border-sky-400/30',
  webp: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  gif: 'bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-400/30',
};

export const FileRow = memo(function FileRow({
  item,
  onOpenDetail,
}: {
  item: QueueItem;
  onOpenDetail: (id: string) => void;
}) {
  const removeItem = useUntrace((s) => s.removeItem);
  const downloadOne = useUntrace((s) => s.downloadOne);
  const r = item.result;

  const fmt = r?.format ?? item.name.split('.').pop()?.toLowerCase() ?? 'file';
  const fmtChip = FORMAT_COLORS[fmt] ?? 'bg-slate-400/15 text-slate-300 border-slate-400/30';
  const vMeta = r ? VERDICT_META[r.verdict] : null;

  return (
    <div
      className={cn(
        'content-auto flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-2.5 transition-colors hover:border-white/15 hover:bg-white/[0.04]',
        item.status === 'error' && 'border-rose-500/25 bg-rose-500/[0.04]'
      )}
    >
      {/* thumbnail / format */}
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
        {r?.thumb ? (
          <img src={r.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] font-bold uppercase tracking-wider text-slate-400">
            {fmt.slice(0, 4)}
          </span>
        )}
        {item.status === 'processing' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[1px]">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
          </span>
        )}
      </div>

      {/* main */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', fmtChip)}>
            {fmt}
          </span>
          <p className="truncate text-sm font-medium text-slate-200" title={item.name}>
            {r && r.outputName !== item.name ? (
              <span className="text-slate-500 line-through decoration-slate-600">{item.name}</span>
            ) : (
              item.name
            )}
          </p>
          {r && r.outputName !== item.name && (
            <span className="truncate font-mono text-xs text-emerald-300/90" title={r.outputName}>
              → {r.outputName}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          {item.status === 'queued' && <span>Queued…</span>}
          {item.status === 'processing' && (
            <span className="text-cyan-300">
              {item.stage === 'scan'
                ? 'Checking for traces…'
                : item.stage === 'analyze'
                  ? 'Looking for invisible watermarks…'
                  : 'Removing traces…'}
            </span>
          )}
          {item.status === 'error' && (
            <span className="inline-flex items-center gap-1 text-rose-300">
              <AlertTriangle className="h-3 w-3" /> {item.error}
            </span>
          )}
          {r && (
            <>
              <span>{formatBytes(r.originalSize)} → {formatBytes(r.outputSize)}</span>
              {r.verifiedClean ? (
                <span className="inline-flex items-center gap-0.5 text-emerald-300">
                  · <ShieldCheck className="h-3 w-3" /> verified clean
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-amber-300">
                  · <FileWarning className="h-3 w-3" /> {r.leftoverFindings.length} trace{r.leftoverFindings.length === 1 ? '' : 's'} remain
                </span>
              )}
            </>
          )}
        </div>

        {/* findings chips */}
        {r && r.findings.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {dedupeKinds(r.findings).slice(0, 5).map((k) => {
              const meta = KIND_META[k] ?? KIND_META.other;
              return (
                <span key={k} className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', meta.tone)}>
                  {meta.label}
                </span>
              );
            })}
            {dedupeKinds(r.findings).length > 5 && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500">
                +{dedupeKinds(r.findings).length - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* right side */}
      <div className="flex shrink-0 items-center gap-1.5">
        {r && vMeta && (
          <span className={cn('hidden rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold sm:inline-flex', vMeta.tone)}>
            {vMeta.label} · {r.aiScore}
          </span>
        )}
        {item.status === 'done' && r && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-slate-400 hover:text-emerald-300"
              onClick={(e) => {
                e.stopPropagation();
                downloadOne(item.id);
              }}
              aria-label={`Download cleaned ${item.name}`}
              title="Download cleaned file"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-slate-400 hover:text-cyan-300"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(item.id);
              }}
              aria-label={`Details for ${item.name}`}
              title="View detection report"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
        {item.status === 'queued' && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-500 hover:text-rose-300"
            onClick={(e) => {
              e.stopPropagation();
              removeItem(item.id);
            }}
            aria-label={`Remove ${item.name}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {item.status === 'done' && (
          <CheckCircle2 className="h-4 w-4 text-emerald-400/80" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});

function dedupeKinds(findings: { kind: string }[]): string[] {
  return [...new Set(findings.map((f) => f.kind))];
}
