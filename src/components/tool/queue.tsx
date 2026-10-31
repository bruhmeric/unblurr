'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ban, FileArchive, Loader2, Play, RefreshCw, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useUntrace } from '@/lib/untrace/store';
import { formatBytes } from '@/lib/untrace/types';
import { FileRow } from './file-row';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'ai' | 'footprints' | 'errors';

export function QueuePanel({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const items = useUntrace((s) => s.items);
  const running = useUntrace((s) => s.running);
  const start = useUntrace((s) => s.start);
  const cancel = useUntrace((s) => s.cancel);
  const clearAll = useUntrace((s) => s.clearAll);
  const downloadAll = useUntrace((s) => s.downloadAll);
  const zipProgress = useUntrace((s) => s.zipProgress);
  const startedAt = useUntrace((s) => s.startedAt);
  const finishedAt = useUntrace((s) => s.finishedAt);
  const [filter, setFilter] = useState<Filter>('all');

  const s = useMemo(() => {
    const done = items.filter((i) => i.status === 'done');
    let footprints = 0, ai = 0, bytesSaved = 0, deep = 0;
    for (const it of done) {
      footprints += it.result!.findings.length;
      if (it.result!.verdict === 'ai-evidence' || it.result!.verdict === 'suspicious') ai++;
      bytesSaved += it.result!.originalSize - it.result!.outputSize;
      if (it.result!.mode === 'deep') deep++;
    }
    return {
      total: items.length,
      processed: items.filter((i) => i.status === 'done' || i.status === 'error').length,
      errors: items.filter((i) => i.status === 'error').length,
      ai, footprints, bytesSaved, deep,
    };
  }, [items]);

  const pct = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
  const allDone = !running && s.total > 0 && s.processed === s.total;
  const elapsed = startedAt && finishedAt ? ((finishedAt - startedAt) / 1000).toFixed(1) : null;

  const filtered = useMemo(() => {
    if (filter === 'ai') return items.filter((i) => i.result && (i.result.verdict === 'ai-evidence' || i.result.verdict === 'suspicious'));
    if (filter === 'footprints') return items.filter((i) => i.result && i.result.findings.length > 0);
    if (filter === 'errors') return items.filter((i) => i.status === 'error');
    return items;
  }, [items, filter]);

  if (items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-4 sm:p-6"
    >
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-slate-100">
            Batch queue
            <span className="ml-2 text-sm font-normal text-slate-500">{s.total} image{s.total > 1 ? 's' : ''}</span>
          </h3>
          {running && (
            <p className="mt-0.5 text-xs text-cyan-300">
              Processing… {s.processed}/{s.total} done
            </p>
          )}
          {allDone && (
            <p className="mt-0.5 text-xs text-emerald-300">
              Finished {s.total} image{s.total > 1 ? 's' : ''}{elapsed ? ` in ${elapsed}s` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {running ? (
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={cancel}>
              <Ban className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : (
            <>
              {!allDone && (
                <Button
                  size="sm"
                  className="gap-1.5 bg-gradient-to-r from-cyan-400 to-emerald-400 font-semibold text-[#04110c] hover:opacity-90"
                  onClick={() => {
                    start().catch((e) => toast.error('Failed to start', { description: String(e) }));
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                  {s.processed > 0 ? 'Continue' : 'Start cleaning'}
                </Button>
              )}
              {allDone && (
                <Button
                  size="sm"
                  className="gap-1.5 bg-gradient-to-r from-cyan-400 to-emerald-400 font-semibold text-[#04110c] hover:opacity-90"
                  onClick={() => downloadAll().catch((e) => toast.error('ZIP failed', { description: String(e) }))}
                  disabled={zipProgress !== null}
                >
                  {zipProgress !== null ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileArchive className="h-3.5 w-3.5" />
                  )}
                  {zipProgress !== null ? `Zipping ${Math.round(zipProgress * 100)}%` : 'Download all (ZIP)'}
                </Button>
              )}
              {!allDone && s.processed > 0 && (
                <Button
                  size="sm" variant="secondary"
                  className="gap-1.5 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
                  onClick={() => downloadAll().catch((e) => toast.error('ZIP failed', { description: String(e) }))}
                  disabled={zipProgress !== null || s.total - s.errors === 0}
                  title="Download the files finished so far"
                >
                  <FileArchive className="h-3.5 w-3.5" /> Partial ZIP
                </Button>
              )}
              <Button
                size="sm" variant="ghost"
                className="gap-1.5 text-slate-400 hover:text-rose-300"
                onClick={clearAll}
                aria-label="Clear batch"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            </>
          )}
        </div>
      </div>

      {/* progress */}
      {(running || allDone) && (
        <div className="mt-4">
          <Progress
            value={pct}
            className="h-2 bg-white/[0.06] *:data-[slot=progress-indicator]:bg-gradient-to-r *:data-[slot=progress-indicator]:from-cyan-400 *:data-[slot=progress-indicator]:to-emerald-400"
          />
        </div>
      )}

      {/* live stats */}
      {(running || allDone) && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Processed" value={`${s.processed}/${s.total}`} tone="text-slate-100" />
          <Stat
            label="Footprints found"
            value={s.footprints.toLocaleString()}
            tone={s.footprints > 0 ? 'text-amber-300' : 'text-slate-300'}
          />
          <Stat
            label="AI-flagged"
            value={String(s.ai)}
            tone={s.ai > 0 ? 'text-rose-300' : 'text-emerald-300'}
          />
          <Stat
            label={s.bytesSaved >= 0 ? 'Bytes stripped' : 'Size change'}
            value={formatBytes(Math.abs(s.bytesSaved))}
            tone="text-cyan-300"
          />
        </div>
      )}

      {/* filters */}
      {allDone && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {([
            ['all', `All (${s.total})`],
            ['ai', `AI-flagged (${s.ai})`],
            ['footprints', `Had footprints (${items.filter((i) => i.result && i.result.findings.length > 0).length})`],
            ['errors', `Errors (${s.errors})`],
          ] as [Filter, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filter === id
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                  : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* list */}
      <div className="mt-4 max-h-[420px] space-y-1.5 overflow-y-auto pr-1 nice-scroll">
        <AnimatePresence initial={false}>
          {filtered.map((item) => (
            <motion.div
              key={item.id}
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FileRow item={item} onOpenDetail={onOpenDetail} />
            </motion.div>
          ))}
        </AnimatePresence>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-600">No files match this filter.</p>
        )}
      </div>

      {allDone && s.errors > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <RefreshCw className="h-3 w-3" />
          Failed files can be retried — hit “Continue”. Some formats (like HEIC) aren’t supported by every browser.
        </p>
      )}
    </motion.div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5">
      <div className={cn('font-display text-lg font-bold leading-none', tone)}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
