'use client';

import { motion } from 'framer-motion';
import { FileSearch, Fingerprint, Scissors, ShieldCheck } from 'lucide-react';

const STEPS = [
  {
    icon: FileSearch,
    step: '01',
    title: 'Drop your images',
    desc: 'Add up to 500 pictures at once — drag & drop, pick a folder, or paste from your clipboard. Nothing gets uploaded anywhere.',
  },
  {
    icon: Fingerprint,
    step: '02',
    title: 'We find the traces',
    desc: 'Every file is checked for hidden AI labels, watermarks, camera details, location data and more — and you see everything we find.',
  },
  {
    icon: Scissors,
    step: '03',
    title: 'Everything gets erased',
    desc: 'All metadata and AI-generation traces are removed. Deep Clean can even disrupt invisible watermarks embedded in the pixels.',
  },
  {
    icon: ShieldCheck,
    step: '04',
    title: 'Download clean files',
    desc: 'Grab your images one by one or as a single ZIP. Every file is double-checked before download, so you know it’s truly clean.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">How it works</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            From flagged to <span className="text-gradient">spotless</span> in four steps
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Untrace removes the metadata and AI traces hiding in your images — quickly,
            in bulk — and nothing ever leaves your device.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] p-5 transition-colors hover:border-emerald-400/25 hover:bg-white/[0.035]"
            >
              <span className="pointer-events-none absolute -right-2 -top-4 font-display text-[64px] font-bold leading-none text-white/[0.045] transition-colors group-hover:text-emerald-400/10">
                {s.step}
              </span>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10">
                <s.icon className="h-5 w-5 text-emerald-300" />
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-slate-100">{s.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
