'use client';

import { motion } from 'framer-motion';
import { ArrowDown, Fingerprint, Infinity as InfinityIcon, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CHIPS = [
  { icon: ShieldCheck, text: 'Zero uploads — ever' },
  { icon: Zap, text: '500-image batches' },
  { icon: Fingerprint, text: 'C2PA + SynthID aware' },
  { icon: InfinityIcon, text: 'Free & unlimited for members' },
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-14 pb-10 sm:pt-20 sm:pb-14">
      {/* scenery */}
      <div className="absolute inset-0 bg-grid mask-fade-y" aria-hidden="true" />
      <div className="glow-orb left-[-10%] top-[-15%] h-[420px] w-[420px] bg-cyan-500/25" aria-hidden="true" />
      <div className="glow-orb right-[-8%] top-[10%] h-[380px] w-[380px] bg-emerald-500/20" aria-hidden="true" />
      <div className="glow-orb bottom-[-30%] left-[35%] h-[360px] w-[360px] bg-teal-500/10" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
            Included free with every unblurr account · unlimited use
          </div>

          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Make AI images
            <br />
            <span className="text-gradient">untraceable.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Untrace removes every trace hiding in your images —{' '}
            <span className="text-slate-200">AI labels, hidden watermarks, EXIF, GPS, prompts</span>{' '}
            — in bulk, right in your browser. Up to{' '}
            <span className="text-slate-200">500 images at once</span>, with zero uploads.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 bg-gradient-to-r from-cyan-400 to-emerald-400 px-8 text-base font-semibold text-[#04110c] shadow-[0_0_40px_-8px_rgba(45,212,174,0.5)] hover:opacity-90"
            >
              <a href="#tool">
                Clean my images
                <ArrowDown className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 border-white/15 bg-white/[0.03] px-8 text-base text-slate-200 hover:bg-white/[0.07] hover:text-white"
            >
              <a href="#how">How it works</a>
            </Button>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
            {CHIPS.map((c) => (
              <span
                key={c.text}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-slate-300"
              >
                <c.icon className="h-3.5 w-3.5 text-emerald-300" />
                {c.text}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
