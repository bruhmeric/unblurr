'use client';

/* Zustand store: file queue, settings, processing orchestration, summary. */

import { create } from 'zustand';
import { getClient } from './client';
import {
  MAX_FILES, SOFT_TOTAL_BYTES,
  type CleanOptions, type FileResult, type Verdict,
} from './types';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'queued' | 'processing' | 'done' | 'error';
  stage?: string;
  result?: FileResult;
  blob?: Blob | null;
  error?: string;
}

interface UntraceState {
  items: QueueItem[];
  settings: CleanOptions;
  running: boolean;
  cancelled: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  zipProgress: number | null; // 0..1 while building zip
  addFiles: (files: File[]) => { added: number; skipped: number; reason?: string };
  removeItem: (id: string) => void;
  clearAll: () => void;
  setSettings: (patch: Partial<CleanOptions>) => void;
  start: () => Promise<void>;
  cancel: () => void;
  downloadOne: (id: string) => void;
  downloadAll: () => Promise<void>;
  summary: () => Summary;
}

export interface Summary {
  total: number;
  done: number;
  errors: number;
  aiFlagged: number;
  footprints: number;
  bytesSaved: number;
  deepCleaned: number;
  lossless: number;
  verifiedClean: number;
}

let uid = 0;
const nextId = () => `f${Date.now().toString(36)}-${(uid++).toString(36)}`;

function randomToken(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const useUntrace = create<UntraceState>((set, get) => ({
  items: [],
  running: false,
  cancelled: false,
  startedAt: null,
  finishedAt: null,
  zipProgress: null,
  settings: {
    mode: 'auto',
    stealth: 'balanced',
    format: 'auto',
    quality: 92,
    randomizeName: true,
    stripColorProfile: false,
    wantThumb: true,
  },

  addFiles: (files) => {
    const items = get().items;
    const room = MAX_FILES - items.length;
    if (room <= 0) {
      return { added: 0, skipped: files.length, reason: `Batch limit of ${MAX_FILES} images reached.` };
    }
    const accepted = files.slice(0, room);
    const skipped = files.length - accepted.length;

    /* duplicate guard by name+size+lastModified */
    const seen = new Set(items.map((i) => `${i.name}|${i.size}|${i.file.lastModified}`));
    const fresh: QueueItem[] = [];
    let dupes = 0;
    for (const file of accepted) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) { dupes++; continue; }
      seen.add(key);
      fresh.push({
        id: nextId(), file, name: file.name, size: file.size, status: 'queued',
      });
    }
    if (fresh.length) set({ items: [...items, ...fresh], cancelled: false });

    /* soft total-size warning */
    const total = [...get().items].reduce((a, i) => a + i.size, 0);
    let reason: string | undefined;
    if (total > SOFT_TOTAL_BYTES) {
      reason = 'Heads up: this batch exceeds 1.5 GB. Very large batches may strain browser memory.';
    } else if (dupes > 0) {
      reason = `${dupes} duplicate file${dupes > 1 ? 's' : ''} skipped.`;
    } else if (skipped > 0) {
      reason = `Batch limit: added ${accepted.length}, skipped ${skipped}.`;
    }
    return { added: fresh.length, skipped: skipped + dupes, reason };
  },

  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  clearAll: () => {
    if (get().running) return;
    set({ items: [], cancelled: false, startedAt: null, finishedAt: null, zipProgress: null });
  },

  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  start: async () => {
    const state = get();
    if (state.running) return;
    const todo = state.items.filter((i) => i.status === 'queued' || i.status === 'error');
    if (todo.length === 0) return;

    set({ running: true, cancelled: false, startedAt: Date.now(), finishedAt: null });
    const client = getClient();
    const opts = { ...get().settings, wantThumb: get().items.length <= 80 };
    const CONCURRENCY = client.poolSize;

    const patchItem = (id: string, patch: Partial<QueueItem>) =>
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (true) {
        if (get().cancelled) return;
        const items = get().items;
        if (cursor >= todo.length) return;
        const target = todo[cursor++];
        /* item may have been removed while queued */
        if (!items.find((i) => i.id === target.id)) continue;
        patchItem(target.id, { status: 'processing', stage: 'scan' });
        try {
          const { result, blob } = await client.process(target.file, opts, (stage) =>
            patchItem(target.id, { stage })
          );
          patchItem(target.id, { status: 'done', result, blob, stage: undefined });
        } catch (e) {
          patchItem(target.id, {
            status: 'error',
            error: e instanceof Error ? e.message : 'Processing failed',
            stage: undefined,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, runNext));
    set({ running: false, finishedAt: Date.now() });
  },

  cancel: () => set({ cancelled: true }),

  downloadOne: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item?.blob || !item.result) return;
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.result.outputName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  downloadAll: async () => {
    const items = get().items.filter((i) => i.status === 'done' && i.blob && i.result);
    if (items.length === 0) return;
    set({ zipProgress: 0 });
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const used = new Set<string>();
      for (const it of items) {
        let name = it.result!.outputName;
        while (used.has(name)) {
          name = name.replace(/(\.[a-z0-9]+)$/i, `_${randomToken()}$1`);
        }
        used.add(name);
        zip.file(name, it.blob!);
      }
      zip.file(
        'README.txt',
        'Cleaned with Untrace — AI footprint & metadata remover.\n' +
        'All processing happened locally in your browser. Nothing was uploaded.\n\n' +
        `Files cleaned: ${items.length}\n` +
        `Generated: ${new Date().toLocaleString()}\n`
      );
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (meta) => set({ zipProgress: meta.percent / 100 })
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      a.href = url;
      a.download = `untrace-cleaned-${stamp}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      set({ zipProgress: null });
    }
  },

  summary: () => {
    const items = get().items;
    const done = items.filter((i) => i.status === 'done');
    const byVerdict = new Set<Verdict>();
    let footprints = 0, aiFlagged = 0, bytesSaved = 0, deepCleaned = 0, lossless = 0, verified = 0;
    for (const it of done) {
      const r = it.result!;
      footprints += r.findings.length;
      byVerdict.add(r.verdict);
      if (r.verdict === 'ai-evidence' || r.verdict === 'suspicious') aiFlagged++;
      bytesSaved += r.originalSize - r.outputSize;
      if (r.mode === 'deep') deepCleaned++; else lossless++;
      if (r.verifiedClean) verified++;
    }
    return {
      total: items.length,
      done: done.length,
      errors: items.filter((i) => i.status === 'error').length,
      aiFlagged,
      footprints,
      bytesSaved,
      deepCleaned,
      lossless,
      verifiedClean: verified,
    };
  },
}));
