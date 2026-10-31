'use client';

import { useState } from 'react';
import { Lock, Cpu, HardDriveDownload } from 'lucide-react';
import { Dropzone } from './dropzone';
import { SettingsPanel } from './settings-panel';
import { QueuePanel } from './queue';
import { DetailDialog } from './detail-dialog';

export function ToolSection() {
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <section id="tool" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">The cleaner</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
              Drop. Detect. <span className="text-gradient">Erase.</span>
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              Your files never leave this tab. Drop them in, get clean copies back —
              every trace found, erased, and double-checked before download.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-emerald-300" /> Free &amp; unlimited with your account</span>
            <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-emerald-300" /> Handles batches up to 500 images</span>
            <span className="inline-flex items-center gap-1.5"><HardDriveDownload className="h-3.5 w-3.5 text-emerald-300" /> One-click ZIP of the whole batch</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Dropzone />
            <QueuePanel onOpenDetail={setDetailId} />
          </div>
          <SettingsPanel />
        </div>
      </div>

      <DetailDialog fileId={detailId} onClose={() => setDetailId(null)} />
    </section>
  );
}
