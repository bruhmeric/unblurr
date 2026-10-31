'use client';

import { Check, Minus, X } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Cell = boolean | string;

const ROWS: { feature: string; us: Cell; dfp: Cell; exiftool: Cell }[] = [
  { feature: 'Runs fully in-browser, zero uploads', us: true, dfp: 'Partial — files retained up to 30 min', exiftool: false },
  { feature: 'Bulk batch size', us: '500 images', dfp: '5 per batch', exiftool: 'CLI scripting' },
  { feature: 'C2PA / Content Credentials removal', us: true, dfp: true, exiftool: 'Manual flags' },
  { feature: 'EXIF / XMP / IPTC removal', us: true, dfp: true, exiftool: true },
  { feature: 'Generation prompt removal', us: true, dfp: true, exiftool: 'Manual' },
  { feature: 'AI-generation detection + risk score', us: true, dfp: false, exiftool: false },
  { feature: 'Invisible watermark detection (SynthID-class)', us: true, dfp: false, exiftool: false },
  { feature: 'Invisible watermark removal (Deep Clean)', us: true, dfp: false, exiftool: false },
  { feature: 'Image quality unchanged (Standard Clean)', us: true, dfp: true, exiftool: true },
  { feature: 'Filename randomization', us: true, dfp: false, exiftool: false },
  { feature: 'Every file double-checked after cleaning', us: true, dfp: 'Post-clean scan', exiftool: false },
  { feature: 'One-click batch ZIP download', us: true, dfp: false, exiftool: false },
  { feature: 'Installation required', us: false, dfp: false, exiftool: 'Perl + CLI' },
];

function CellView({ v, highlight }: { v: Cell; highlight?: boolean }) {
  if (v === true) return <Check className={cn('mx-auto h-4 w-4', highlight ? 'text-emerald-300' : 'text-slate-400')} aria-label="Yes" />;
  if (v === false) return <X className="mx-auto h-4 w-4 text-slate-600" aria-label="No" />;
  return <span className={cn('text-center text-xs', highlight ? 'font-semibold text-emerald-300' : 'text-slate-400')}>{v}</span>;
}

export function Comparison() {
  return (
    <section id="compare" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">Comparison</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            Stack it against <span className="text-gradient">the alternatives</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Researched from public feature pages of deletefootprints.ai and ExifTool, October 2026.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="h-12 bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">Capability</TableHead>
                <TableHead className="h-12 bg-emerald-400/[0.08] text-center text-xs font-bold uppercase tracking-wider text-emerald-300">
                  Untrace
                </TableHead>
                <TableHead className="h-12 bg-white/[0.03] text-center text-xs uppercase tracking-wider text-slate-400">deletefootprints.ai</TableHead>
                <TableHead className="h-12 bg-white/[0.03] text-center text-xs uppercase tracking-wider text-slate-400">ExifTool (manual)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r.feature} className="border-white/8">
                  <TableCell className="py-3 text-sm text-slate-300">{r.feature}</TableCell>
                  <TableCell className="py-3"><CellView v={r.us} highlight /></TableCell>
                  <TableCell className="py-3"><CellView v={r.dfp} /></TableCell>
                  <TableCell className="py-3"><CellView v={r.exiftool} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-600">
          <Minus className="mr-1 inline h-3 w-3" />
          Third-party claims summarized from their public sites; verify independently before relying on them.
        </p>
      </div>
    </section>
  );
}
