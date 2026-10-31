'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Globe, HardDrive, MonitorSmartphone, Network, ShieldCheck, WifiOff } from 'lucide-react';

const PROOFS = [
  { icon: Network, title: 'Network requests', value: '0', desc: 'Open DevTools → Network while cleaning. You’ll see silence.' },
  { icon: WifiOff, title: 'Works offline', value: '100%', desc: 'Load the page once, go offline, keep cleaning. Nothing changes.' },
  { icon: HardDrive, title: 'Image storage', value: 'none', desc: 'There is no upload endpoint. Images never touch the unblurr servers.' },
  { icon: MonitorSmartphone, title: 'Runs on', value: 'your device', desc: 'Everything happens on your computer — never on ours.' },
];

export function Privacy() {
  const [netCount, setNetCount] = useState(0);

  useEffect(() => {
    /* live proof: count network entries that appear AFTER mount */
    let current = 0;
    const po = new PerformanceObserver((list) => {
      current += list.getEntries().length;
      setNetCount(current);
    });
    po.observe({ entryTypes: ['resource'] });
    return () => po.disconnect();
  }, []);

  return (
    <section id="privacy" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-10">
          <div className="glow-orb right-[-5%] top-[-20%] h-64 w-64 bg-emerald-500/15" aria-hidden="true" />
          <div className="relative grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">Privacy pledge</p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                Nothing leaves your device. <span className="text-gradient">Nothing.</span>
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                Metadata is the most sensitive data an image carries — locations, devices, names, prompts.
                The cleaner has no backend: your images are never uploaded, never stored, never seen.
                Everything happens in your browser and vanishes the moment you close the tab.
              </p>
              <div className="mt-6 inline-flex items-center gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-3">
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
                <div className="text-sm">
                  <span className="font-semibold text-emerald-200">Live network counter since this page loaded:</span>{' '}
                  <span className="font-mono text-emerald-300">
                    {`${netCount} images uploaded`}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                (Static assets like fonts may load once at page load — after that, the counter tracks every
                request the page makes. While cleaning 500 images it stays at zero.)
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {PROOFS.map((p, i) => (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, scale: 0.97 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.35, delay: i * 0.07 }}
                  className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
                >
                  <p.icon className="h-5 w-5 text-cyan-300" />
                  <div className="mt-3 font-display text-lg font-bold text-slate-100">{p.value}</div>
                  <div className="text-xs font-medium text-slate-400">{p.title}</div>
                  <div className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{p.desc}</div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="relative mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/8 pt-6 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5" /> No tracking cookies</span>
            <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> No CDN-called home</span>
            <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Fully auditable client-side code</span>
          </div>
        </div>
      </div>
    </section>
  );
}
