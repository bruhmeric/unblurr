'use client';

import { motion } from 'framer-motion';
import {
  BadgeCheck, Calendar, Camera, FileText, Fingerprint, MapPin,
  MessageSquareText, Palette, ShieldAlert, Signature, Stamp, Waves,
} from 'lucide-react';

const ITEMS = [
  { icon: Stamp, title: 'C2PA / Content Credentials', desc: 'The industry “Made with AI” label used by big platforms — detected and removed completely.' },
  { icon: MessageSquareText, title: 'Generation prompts', desc: 'The prompt used to create the image, along with hidden generation settings like seeds and models.' },
  { icon: Fingerprint, title: 'Generator signatures', desc: 'Hidden markers left by Midjourney, DALL·E, GPT Image, Firefly, Imagen, FLUX, Grok, Ideogram and 30+ more.' },
  { icon: Camera, title: 'EXIF camera data', desc: 'Camera make, model, lens, serial numbers and capture details — everything a camera or editor stamps in.' },
  { icon: MapPin, title: 'GPS location', desc: 'Latitude, longitude, altitude. Where you shot it is nobody’s business but yours.' },
  { icon: FileText, title: 'XMP & IPTC', desc: 'Creator tools, editing history, author and copyright fields hidden inside the file.' },
  { icon: Waves, title: 'Invisible watermarks (SynthID)', desc: 'Detects the hidden pattern Google\u2019s SynthID weaves into pixels — and Deep Clean breaks it apart, not just the metadata.' },
  { icon: Signature, title: 'Filename hints', desc: 'DALL_E_1024.png, ComfyUI_00045.png — names are footprints too. Optional one-click randomization.' },
  { icon: Palette, title: 'ICC color profiles', desc: 'Optional removal of embedded color profiles that can carry extra hidden data.' },
  { icon: Calendar, title: 'Timestamps', desc: 'Embedded creation and edit dates that reveal when the image was really made.' },
  { icon: ShieldAlert, title: 'Hidden payloads', desc: 'Data silently attached after the image itself — a classic hiding spot — removed entirely.' },
  { icon: BadgeCheck, title: 'Verification', desc: 'Every cleaned file is double-checked before download, so no known trace survives.' },
];

export function Coverage() {
  return (
    <section id="coverage" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="absolute inset-0 bg-grid mask-fade-y opacity-40" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">Coverage</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            Everything an image can <span className="text-gradient">tell on you</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            If it’s embedded in the file, Untrace finds it, shows it to you, and removes it.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.35, delay: (i % 3) * 0.06 }}
              className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4 transition-colors hover:border-white/15"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                <item.icon className="h-4 w-4 text-emerald-300" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-200">{item.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.desc}</span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
