'use client';

import { Eraser, Sparkles, Wand2, Gauge, FileOutput, Shuffle, Palette } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useUntrace } from '@/lib/untrace/store';
import type { CleanMode, OutputFormat, Stealth } from '@/lib/untrace/types';
import { cn } from '@/lib/utils';

const MODES: { id: CleanMode; title: string; desc: string; icon: typeof Sparkles; badge?: string }[] = [
  {
    id: 'auto',
    title: 'Smart Auto',
    desc: 'Finds and removes everything automatically — the best choice for most images.',
    icon: Sparkles,
    badge: 'Recommended',
  },
  {
    id: 'lossless',
    title: 'Standard Clean',
    desc: 'Removes all hidden metadata. Image quality stays 100% identical.',
    icon: Eraser,
  },
  {
    id: 'deep',
    title: 'Deep Clean',
    desc: 'Also detects and breaks invisible AI watermarks (like Google\u2019s SynthID) hidden in the pixels. Tiny quality trade-off.',
    icon: Wand2,
  },
];

const STEALTH: { id: Stealth; label: string; hint: string }[] = [
  { id: 'safe', label: 'Safe', hint: 'mildest' },
  { id: 'balanced', label: 'Balanced', hint: 'recommended' },
  { id: 'aggressive', label: 'Aggressive', hint: 'strongest' },
];

export function SettingsPanel() {
  const settings = useUntrace((s) => s.settings);
  const setSettings = useUntrace((s) => s.setSettings);
  const running = useUntrace((s) => s.running);

  const deepRelevant = settings.mode === 'deep' || settings.mode === 'auto';

  return (
    <div className="glass rounded-2xl p-5 sm:p-6">
      <h3 className="font-display text-base font-semibold text-slate-100">Cleaning options</h3>
      <p className="mt-1 text-xs text-slate-500">Choose how thoroughly traces are removed.</p>

      {/* mode */}
      <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Cleaning mode">
        {MODES.map((m) => {
          const active = settings.mode === m.id;
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={active}
              disabled={running}
              onClick={() => setSettings({ mode: m.id })}
              className={cn(
                'group relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all',
                active
                  ? 'border-emerald-400/50 bg-emerald-400/[0.08] shadow-[0_0_24px_-10px_rgba(45,212,174,0.4)]'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
                running && 'cursor-not-allowed opacity-60'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                  active ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-white/10 bg-white/[0.04] text-slate-400'
                )}
              >
                <m.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('text-sm font-semibold', active ? 'text-emerald-200' : 'text-slate-200')}>{m.title}</span>
                  {m.badge && (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                      {m.badge}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{m.desc}</span>
              </span>
              <span
                className={cn(
                  'mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                  active ? 'border-emerald-400 bg-emerald-400' : 'border-white/25'
                )}
              />
            </button>
          );
        })}
      </div>

      {/* stealth */}
      {deepRelevant && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Gauge className="h-3.5 w-3.5 text-emerald-300" /> Watermark protection
            </Label>
            <span className="text-[11px] text-slate-500">applies to Deep Clean</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1" role="radiogroup" aria-label="Watermark protection">
            {STEALTH.map((s) => {
              const active = settings.stealth === s.id;
              return (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={active}
                  disabled={running}
                  onClick={() => setSettings({ stealth: s.id })}
                  className={cn(
                    'rounded-md px-2 py-2 text-center transition-all',
                    active ? 'bg-gradient-to-r from-cyan-400/90 to-emerald-400/90 text-[#04110c]' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                  )}
                >
                  <span className="block text-xs font-semibold">{s.label}</span>
                  <span className={cn('mt-0.5 block text-[10px]', active ? 'text-[#04110c]/70' : 'text-slate-600')}>{s.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* output */}
      <div className="mt-5">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <FileOutput className="h-3.5 w-3.5 text-emerald-300" /> Output format
        </Label>
        <Select
          value={settings.format}
          onValueChange={(v) => setSettings({ format: v as OutputFormat })}
          disabled={running}
        >
          <SelectTrigger className="mt-2 border-white/10 bg-white/[0.03] text-slate-200" aria-label="Output format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#0b1119] text-slate-200">
            <SelectItem value="auto">Match original</SelectItem>
            <SelectItem value="jpeg">JPEG (smallest)</SelectItem>
            <SelectItem value="png">PNG (lossless raster)</SelectItem>
            <SelectItem value="webp">WebP (modern)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* quality */}
      {deepRelevant && settings.format !== 'png' && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              Image quality
            </Label>
            <span className="font-mono text-xs text-emerald-300">{settings.quality}</span>
          </div>
          <Slider
            className="mt-2"
            min={70}
            max={100}
            step={1}
            value={[settings.quality]}
            onValueChange={([q]) => setSettings({ quality: q })}
            disabled={running}
            aria-label="Image quality"
          />
          <p className="mt-1.5 text-[11px] text-slate-600">Higher keeps more detail; 90–94 looks identical for photos.</p>
        </div>
      )}

      {/* toggles */}
      <div className="mt-5 space-y-3 border-t border-white/8 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="rand-name" className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Shuffle className="h-3.5 w-3.5 text-emerald-300" /> Randomize filenames
            </Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
              Names like <span className="font-mono">DALL_E_1024.png</span> are themselves a footprint.
            </p>
          </div>
          <Switch
            id="rand-name"
            checked={settings.randomizeName}
            onCheckedChange={(v) => setSettings({ randomizeName: v })}
            disabled={running}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="strip-icc" className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Palette className="h-3.5 w-3.5 text-emerald-300" /> Strip color profiles
            </Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
              Also removes color profile data. Colors may look slightly different in some apps.
            </p>
          </div>
          <Switch
            id="strip-icc"
            checked={settings.stripColorProfile}
            onCheckedChange={(v) => setSettings({ stripColorProfile: v })}
            disabled={running}
          />
        </div>
      </div>
    </div>
  );
}
