'use client';

/* Worker-pool client for the Untrace engine.
 * Falls back to main-thread engine execution when workers are unavailable. */

import type { CleanOptions, FileResult } from './types';

type Pending = {
  resolve: (r: { result: FileResult; output: Uint8Array | null }) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string) => void;
};

interface Workerish {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(t: 'message', cb: (ev: MessageEvent) => void): void;
  addEventListener(t: 'error', cb: (ev: ErrorEvent) => void): void;
}

class UntraceClient {
  private workers: Workerish[] = [];
  private idle: Workerish[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private engineFallback: any = null;

  get poolSize(): number {
    if (typeof navigator === 'undefined') return 1;
    const hc = navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(hc, 8));
  }

  private ensureWorkers(): Workerish[] {
    if (typeof window === 'undefined') return [];
    if (this.workers.length === 0 && typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < this.poolSize; i++) {
          const w = new Worker('/untrace/worker.js') as unknown as Workerish;
          const workerRef = w as unknown as Worker;
          const handleMsg = (ev: MessageEvent) => {
            const msg = ev.data;
            const p = this.pending.get(msg.id);
            if (!p) return;
            if (msg.type === 'progress') {
              p.onProgress?.(msg.stage);
              return;
            }
            this.pending.delete(msg.id);
            this.idle.push(w);
            if (msg.type === 'done') {
              p.resolve({ result: msg.result as FileResult, output: msg.outputBuffer ?? null });
            } else {
              p.reject(new Error(msg.message || 'Processing failed'));
            }
          };
          const handleErr = () => {
            /* structural worker failure — fail pending task */
            const ids = [...this.pending.keys()];
            for (const id of ids) {
              const p = this.pending.get(id)!;
              p.reject(new Error('Worker crashed'));
              this.pending.delete(id);
            }
            this.idle = this.idle.filter((x) => x !== w);
          };
          workerRef.addEventListener('message', handleMsg as EventListener);
          workerRef.addEventListener('error', handleErr as EventListener);
          this.workers.push(w);
          this.idle.push(w);
        }
      } catch {
        this.workers = [];
      }
    }
    return this.workers;
  }

  private async loadEngineFallback(): Promise<any> {
    if (this.engineFallback) return this.engineFallback;
    const load = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('engine load failed'));
        document.head.appendChild(s);
      });
    await load('/untrace/signatures.js');
    await load('/untrace/parsers.js');
    await load('/untrace/synthid.js');
    await load('/untrace/engine.js');
    this.engineFallback = (window as any).UntraceEngine;
    return this.engineFallback;
  }

  async process(
    file: File,
    options: CleanOptions,
    onProgress?: (stage: string) => void
  ): Promise<{ result: FileResult; blob: Blob | null }> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const workers = this.ensureWorkers();

    if (workers.length > 0) {
      const worker = this.idle.pop() ?? (await this.waitForIdle());
      return this.runOnWorker(worker, buffer, file.name, options, onProgress);
    }

    /* main-thread fallback */
    const engine = await this.loadEngineFallback();
    const result: FileResult = await engine.processFile(buffer, file.name, options);
    const out = (result as any).outputBuffer as Uint8Array | undefined;
    delete (result as any).outputBuffer;
    const blob = out && out.buffer ? new Blob([out.buffer as ArrayBuffer], { type: result.outputType }) : null;
    return { result, blob };
  }

  private waitForIdle(): Promise<Workerish> {
    return new Promise((resolve) => {
      const tick = () => {
        const w = this.idle.pop();
        if (w) resolve(w);
        else setTimeout(tick, 25);
      };
      tick();
    });
  }

  private runOnWorker(
    worker: Workerish,
    buffer: Uint8Array,
    name: string,
    options: CleanOptions,
    onProgress?: (stage: string) => void
  ): Promise<{ result: FileResult; blob: Blob | null }> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: (r) => {
          const blob = r.output && r.output.buffer
            ? new Blob([r.output.buffer as ArrayBuffer], { type: r.result.outputType })
            : null;
          resolve({ result: r.result, blob });
        },
        reject,
        onProgress,
      });
      try {
        worker.postMessage({ type: 'process', id, buffer, name, options }, [buffer.buffer]);
      } catch (e) {
        this.pending.delete(id);
        this.idle.push(worker);
        reject(e as Error);
      }
    });
  }

  terminate(): void {
    for (const w of this.workers) {
      try { w.terminate(); } catch { /* noop */ }
    }
    this.workers = [];
    this.idle = [];
    this.pending.clear();
  }
}

let singleton: UntraceClient | null = null;
export function getClient(): UntraceClient {
  if (!singleton) singleton = new UntraceClient();
  return singleton;
}
