/* Shared types mirroring the engine's plain-JS result objects. */

export type EvidenceLevel = 0 | 1 | 2 | 3;

export interface Finding {
  kind:
    | 'exif' | 'gps' | 'xmp' | 'iptc' | 'c2pa' | 'png-text' | 'jpeg-com'
    | 'icc' | 'timestamp' | 'trailing-data' | 'generator' | 'prompt'
    | 'synthid' | 'jfif' | 'other';
  where: string;
  label: string;
  detail?: string;
  evidence: EvidenceLevel;
  removable: boolean;
}

export type Verdict = 'clean' | 'unclear' | 'suspicious' | 'ai-evidence';

export interface ScoreReason {
  type: 'evidence' | 'indicator' | 'name';
  text: string;
}

export interface DetectMetrics {
  resRms: number;
  blockCV: number;
  hfRatio: number;
  meanSat: number;
  uniqueRatio: number;
}

/* Invisible watermark (SynthID-class) analysis — before/after. */
export interface SynthidInfo {
  detected: boolean;
  possible: boolean;
  confidence: number;              /* 0..1 statistical confidence */
  cvr: number;                     /* carrier-to-background signal ratio */
  peak: number;                    /* median top carrier prominence */
  bestSet: string;
  topCarriers: { fy: number; fx: number; prom: number }[];
  after: { confidence: number; cvr: number } | null;
  reduced: number | null;          /* % signal reduction after Deep Clean */
  removed: boolean | null;         /* verified no longer detectable */
}

export interface FileResult {
  originalName: string;
  outputName: string;
  format: string;
  mode: 'lossless' | 'deep';
  cleaned: boolean;
  verifiedClean: boolean;
  leftoverFindings: Finding[];
  findings: Finding[];
  aiScore: number;
  verdict: Verdict;
  reasons: ScoreReason[];
  indicators: string[];
  metrics: DetectMetrics | null;
  synthid: SynthidInfo | null;
  notes: string[];
  originalSize: number;
  outputSize: number;
  outputType: string;
  thumb: string | null;
  ms: number;
}

export type CleanMode = 'auto' | 'lossless' | 'deep';
export type Stealth = 'safe' | 'balanced' | 'aggressive';
export type OutputFormat = 'auto' | 'jpeg' | 'png' | 'webp';

export interface CleanOptions {
  mode: CleanMode;
  stealth: Stealth;
  format: OutputFormat;
  quality: number;
  randomizeName: boolean;
  stripColorProfile: boolean;
  wantThumb: boolean;
}

export const MAX_FILES = 500;
export const SOFT_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB

export const KIND_META: Record<string, { label: string; tone: string }> = {
  exif: { label: 'EXIF', tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  gps: { label: 'GPS', tone: 'bg-red-500/10 text-red-300 border-red-500/30' },
  xmp: { label: 'XMP', tone: 'bg-violet-400/10 text-violet-300 border-violet-400/30' },
  iptc: { label: 'IPTC', tone: 'bg-violet-400/10 text-violet-300 border-violet-400/30' },
  c2pa: { label: 'C2PA', tone: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  'png-text': { label: 'PNG text', tone: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/30' },
  'jpeg-com': { label: 'Comment', tone: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/30' },
  icc: { label: 'ICC', tone: 'bg-slate-400/10 text-slate-300 border-slate-400/30' },
  timestamp: { label: 'Timestamp', tone: 'bg-slate-400/10 text-slate-300 border-slate-400/30' },
  'trailing-data': { label: 'Trailing data', tone: 'bg-red-500/10 text-red-300 border-red-500/30' },
  generator: { label: 'AI signature', tone: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  prompt: { label: 'Prompt data', tone: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  synthid: { label: 'SynthID watermark', tone: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30' },
  jfif: { label: 'JFIF', tone: 'bg-slate-400/10 text-slate-300 border-slate-400/30' },
  other: { label: 'Other', tone: 'bg-slate-400/10 text-slate-300 border-slate-400/30' },
};

export const VERDICT_META: Record<Verdict, { label: string; tone: string; ring: string }> = {
  clean: { label: 'No traces', tone: 'text-emerald-300', ring: 'stroke-emerald-400' },
  unclear: { label: 'Unclear', tone: 'text-slate-300', ring: 'stroke-slate-400' },
  suspicious: { label: 'Suspicious', tone: 'text-amber-300', ring: 'stroke-amber-400' },
  'ai-evidence': { label: 'AI evidence', tone: 'text-rose-300', ring: 'stroke-rose-400' },
};

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
