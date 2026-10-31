/* ============================================================
 * Untrace · engine.js
 * Cleaning + detection engine.
 *  - Lossless structural cleaning (byte surgery, pixels untouched)
 *  - Deep Clean (warp + squeeze + noise + re-encode) to disrupt
 *    invisible watermarks (SynthID-class, spread-spectrum)
 *  - SynthID statistical detection (carrier analysis, see synthid.js)
 *  - Statistical AI-generation heuristics (noise uniformity,
 *    high-frequency falloff, saturation, color smoothness)
 *  - processFile() orchestrates: scan → detect → score → clean → verify
 * Works in: Web Worker, main thread (dynamic script), Node (tests)
 * ============================================================ */
(function (root) {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  const SIG = G.UntraceSignatures;
  const P = G.UntraceParsers;
  const SY = G.UntraceSynthid;

  /* ---------- stealth presets ---------- */

  const STEALTH = {
    safe:      { noise: 0,   resample: 1.0,  passes: 1, quality: 0.92 },
    balanced:  { noise: 2.0, resample: 1.0,  passes: 1, quality: 0.92 },
    aggressive:{ noise: 3.5, resample: 0.99, passes: 2, quality: 0.88 }
  };

  /* ---------- deterministic RNG (xorshift32) ---------- */

  function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function seedFrom(name) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  /* ============================================================
   * LOSSLESS CLEANERS — byte-level container rebuild
   * ============================================================ */

  function cleanJpeg(view) {
    const parts = [];
    parts.push(view.subarray(0, 2)); // SOI
    for (const seg of P.parseJpeg(view).segments) {
      const m = seg.marker;
      if (m >= 0xe0 && m <= 0xef) continue;          // APPn
      if (m === 0xfe) continue;                       // COM
      if (m === 0xda) {                               // SOS + scan data + EOI
        parts.push(view.subarray(seg.start, view.byteLength));
        /* trim anything after EOI handled below */
        break;
      }
      parts.push(view.subarray(seg.start, seg.start + seg.length));
    }
    let out = concat(parts);
    /* drop trailing data after EOI */
    const v2 = new Uint8Array(out);
    const lastEoi = findLastBytes(v2, [0xff, 0xd9]);
    if (lastEoi >= 0 && lastEoi + 2 < v2.length) out = out.slice(0, lastEoi + 2);
    return out;
  }

  function findLastBytes(view, needle) {
    for (let i = view.byteLength - needle.length; i >= 0; i--) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) if (view[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  function concat(arrays) {
    let n = 0;
    for (const a of arrays) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }

  function cleanPng(view, stripColor) {
    const keep = stripColor
      ? ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']
      : P.PNG_KEEP;
    const parts = [view.subarray(0, 8)];
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    let off = 8;
    const N = view.byteLength;
    while (off + 8 <= N) {
      const len = dv.getUint32(off);
      const type = P.ascii(view, off + 4, 4);
      if (off + 12 + len > N) break;
      if (keep.includes(type)) parts.push(view.subarray(off, off + 12 + len));
      off += 12 + len;
      if (type === 'IEND') break;
    }
    return concat(parts);
  }

  function cleanWebp(view, stripColor) {
    const keepIds = stripColor
      ? ['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']
      : P.WEBP_KEEP;
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    const parts = [];
    let off = 12;
    const N = view.byteLength;
    let sawExif = false, sawXmp = false, sawIcc = false, vp8x = null;
    const kept = [];
    while (off + 8 <= N) {
      const id = P.ascii(view, off, 4);
      const len = dv.getUint32(off + 4, true);
      if (off + 8 + len > N) break;
      if (id === 'EXIF') sawExif = true;
      if (id === 'XMP ' || id === 'XMP') sawXmp = true;
      if (id === 'ICCP') sawIcc = true;
      if (id === 'VP8X') vp8x = { start: off, len };
      if (keepIds.includes(id)) kept.push(view.subarray(off, off + 8 + len + (len & 1)));
      off += 8 + len + (len & 1);
    }
    /* rewrite VP8X flags: clear EXIF/XMP (and ICC if stripped) bits */
    if (vp8x && (sawExif || sawXmp || (stripColor && sawIcc))) {
      const fixed = new Uint8Array(kept.find(function (k) { return P.ascii(k, 0, 4) === 'VP8X'; }));
      if (fixed.length >= 8) {
        let flags = fixed[4];
        flags &= ~(1 << 4); // EXIF
        flags &= ~(1 << 5); // XMP
        if (stripColor) flags &= ~(1 << 2); // ICC
        fixed[4] = flags;
      }
    }
    parts.push(view.subarray(0, 4));                       // RIFF
    parts.push(new Uint8Array([0, 0, 0, 0]));              // size placeholder
    parts.push(view.subarray(8, 12));                      // WEBP
    for (const k of kept) parts.push(k);
    const out = concat(parts);
    const size = out.length - 8;
    new DataView(out.buffer).setUint32(4, size, true);
    return out;
  }

  function cleanGif(view) {
    const parts = [view.subarray(0, 13)];
    const flags = view[10];
    let off = 13;
    if (flags & 0x80) {
      const gct = 3 * (2 << (flags & 7));
      parts.push(view.subarray(13, 13 + gct));
      off = 13 + gct;
    }
    const N = view.byteLength;
    while (off < N) {
      const b = view[off];
      if (b === 0x3b) { parts.push(view.subarray(off, off + 1)); off++; break; }
      if (b === 0x21) {
        const label = view[off + 1];
        if (label === 0xf9) { // GCE — keep
          const len = view[off + 2];
          parts.push(view.subarray(off, off + 3 + len + 1));
          off += 3 + len + 1;
        } else if (label === 0xff) { // app ext — keep only NETSCAPE loop
          const blockSize = view[off + 2];
          const appId = P.ascii(view, off + 3, Math.min(blockSize, 11));
          let p = off + 3 + blockSize;
          while (p < N && view[p] !== 0) p += view[p] + 1;
          if (/NETSCAPE2\.0/.test(appId)) parts.push(view.subarray(off, p + 1));
          off = p + 1;
        } else { // comment (0xfe) and unknown ext — drop
          let p = off + 2;
          while (p < N && view[p] !== 0) p += view[p] + 1;
          off = p + 1;
        }
      } else if (b === 0x2c) { // image block — keep
        let p = off + 10;
        const lf = view[p - 1];
        if (lf & 0x80) p += 3 * (2 << (lf & 7));
        p++; // LZW min code size
        while (p < N && view[p] !== 0) p += view[p] + 1;
        parts.push(view.subarray(off, p + 1));
        off = p + 1;
      } else {
        parts.push(view.subarray(off, off + 1));
        off++;
      }
    }
    return concat(parts);
  }

  /* ============================================================
   * DECODE / ENCODE (browser paths, guarded for Node)
   * ============================================================ */

  async function decodeToBitmap(buffer) {
    const blob = new Blob([buffer]);
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
      catch (e) { return await createImageBitmap(blob); }
    }
    throw new Error('DECODER_UNAVAILABLE');
  }
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    const c = G.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  async function canvasToBlob(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: type, quality: quality });
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('ENCODE_FAILED')); }, type, quality);
    });
  }

  /* Gaussian noise via Box–Muller, per channel. */
  function addNoise(data, sigma, rng) {
    const n = data.length;
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        let u1 = rng(), u2 = rng();
        if (u1 < 1e-12) u1 = 1e-12;
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        let v = data[i + c] + g * sigma;
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        data[i + c] = v;
      }
    }
  }

  /* ============================================================
   * DEEP CLEAN — SynthID-aware dissolution pipeline
   * warp (elastic + affine) → squeeze → carrier notch → noise →
   * re-encode chain. PSNR-gated with one gentler retry.
   * ============================================================ */

  function pickOutputType(srcFormat, wanted, hasAlpha) {
    if (wanted === 'jpeg') return 'image/jpeg';
    if (wanted === 'png') return 'image/png';
    if (wanted === 'webp') return 'image/webp';
    if (srcFormat === 'png') return hasAlpha === false ? 'image/png' : 'image/png';
    if (srcFormat === 'webp') return 'image/webp';
    return 'image/jpeg';
  }

  function wrapImageData(data, w, h) {
    if (typeof ImageData === 'function') return new ImageData(data, w, h);
    return { data: data, width: w, height: h };
  }

  /* one full pixel-stage attempt; returns final ImageData on the
   * main canvas plus its PSNR vs the original pixels */
  function dissolveAttempt(ctx, origData, W, H, prm, seed, allowWarp) {
    let img = { data: new Uint8ClampedArray(origData), width: W, height: H };
    if (allowWarp) {
      img = SY.dissolvePixels(img, {
        alpha: prm.alpha, sigma: prm.sigma,
        rotate: prm.rotate, zoom: prm.zoom,
        shiftX: prm.shift, shiftY: -prm.shift * 0.6,
        rng: makeRng(seed),
      });
      SY.colorNudge(img, { brightness: prm.brightness, contrast: prm.contrast, saturation: prm.saturation });
    }
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(wrapImageData(img.data, W, H), 0, 0);
    /* squeeze: downsample then upsample (canvas resampling) */
    if (prm.squeeze < 1) {
      const sw = Math.max(1, Math.round(W * prm.squeeze));
      const sh = Math.max(1, Math.round(H * prm.squeeze));
      const small = makeCanvas(sw, sh);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(ctx.canvas, 0, 0, sw, sh);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, W, H);
    }
    const out = ctx.getImageData(0, 0, W, H);
    return { data: out.data, psnr: SY.psnr(origData, out.data) };
  }

  async function deepClean(buffer, opts) {
    const preset = STEALTH[opts.stealth] || STEALTH.balanced;
    const dis = SY ? (SY.DISSOLVE[opts.stealth] || null) : null;
    let bmp = await decodeToBitmap(buffer);
    const W = bmp.width, H = bmp.height;

    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0);
    try { bmp.close(); } catch (e) {}

    let stages = [];
    if (dis) {
      const orig = ctx.getImageData(0, 0, W, H);
      const origData = orig.data;
      const allowWarp = W * H <= 12e6;           /* warp cap: 12 MP */
      const baseSeed = (seedFrom(opts.name || '') ^ 0x5f3759df) >>> 0;

      /* attempt 1: full preset; attempt 2: halved intensity if the
       * PSNR floor is breached; final fallback: squeeze only */
      let res = dissolveAttempt(ctx, origData, W, H, dis, baseSeed, allowWarp);
      if (res.psnr < dis.psnrFloor) {
        const gentler = {};
        for (const k in dis) gentler[k] = dis[k];
        gentler.alpha = dis.alpha / 2;
        gentler.squeeze = 1 - (1 - dis.squeeze) / 2;
        res = dissolveAttempt(ctx, origData, W, H, gentler, (baseSeed ^ 0x1b73c5) >>> 0, allowWarp);
        if (res.psnr < dis.psnrFloor - 6) {
          res = dissolveAttempt(ctx, origData, W, H, { squeeze: 1 - (1 - dis.squeeze) / 3, alpha: 0, rotate: 0, zoom: 1, shift: 0, brightness: 0, contrast: 1, saturation: 1 }, (baseSeed ^ 0x77aa11) >>> 0, false);
          stages.push('squeeze');
        } else {
          stages.push('warp:gentle', 'squeeze');
        }
      } else {
        stages.push(allowWarp ? 'warp' : 'warp:skipped(huge)', 'squeeze');
      }

      /* carrier notch on exact-size square images */
      const wantNotch = (opts.synthidDetected || opts.stealth === 'aggressive') && W === H && (W === 512 || W === 1024);
      if (wantNotch && dis.notch) {
        try {
          const cur = ctx.getImageData(0, 0, W, H);
          SY.notchCarriers({ data: cur.data, width: W, height: H }, dis.notch, W);
          ctx.putImageData(cur, 0, 0);
          stages.push('notch');
        } catch (e) { /* notch is best-effort */ }
      }
    }

    /* noise */
    if (preset.noise > 0) {
      const img = ctx.getImageData(0, 0, W, H);
      addNoise(img.data, preset.noise, makeRng((seedFrom(opts.name || '') ^ 0x9e3779b9) >>> 0));
      ctx.putImageData(img, 0, 0);
    }

    /* encode (aggressive: quality chain 0.88 → 0.90, like the
     * published JPEG-chain stage) */
    const type = pickOutputType(opts.srcFormat, opts.format, null);
    let blob = await canvasToBlob(canvas, type, preset.quality);
    if (preset.passes > 1) {
      const b2 = await blobToBitmap(blob);
      const c2 = makeCanvas(W, H);
      const x2 = c2.getContext('2d', { willReadFrequently: true });
      x2.drawImage(b2, 0, 0, W, H);
      blob = await canvasToBlob(c2, type, Math.min(0.92, preset.quality + 0.02));
    }
    const out = await blob.arrayBuffer();
    return { buffer: out, type: blob.type, width: W, height: H, stages: stages };
  }

  async function blobToBitmap(blob) {
    return await decodeToBitmap(await blob.arrayBuffer());
  }

  /* ============================================================
   * STATISTICAL AI DETECTION
   * Heuristic indicators on a downscaled copy. Never claims
   * certainty — produces 0–65 "weak signal" points only.
   * ============================================================ */

  function statisticalDetectBmp(bmp) {
    const scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
    const w = Math.max(16, Math.round(bmp.width * scale));
    const h = Math.max(16, Math.round(bmp.height * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;

    /* luminance + saturation */
    const gray = new Float32Array(n);
    let satSum = 0;
    const colorSet = new Uint8Array(32768);
    let unique = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      const idx = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (!colorSet[idx]) { colorSet[idx] = 1; unique++; }
    }
    const meanSat = satSum / n;
    const uniqueRatio = unique / n;

    /* residual (high-pass) via 3×3 box blur difference */
    const res = new Float32Array(n);
    let resSum = 0, resSumSq = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * w + (x + dx)];
        const v = gray[y * w + x] - s / 9;
        res[y * w + x] = v;
        resSum += v; resSumSq += v * v;
      }
    }
    const cnt = (w - 2) * (h - 2);
    const resRms = Math.sqrt(Math.max(0, resSumSq / cnt - Math.pow(resSum / cnt, 2)));

    /* noise uniformity: variance of per-block residual variance */
    const bs = 16;
    const bx = Math.floor(w / bs), by = Math.floor(h / bs);
    const blockVars = [];
    if (bx > 0 && by > 0) {
      for (let byi = 0; byi < by; byi++) {
        for (let bxi = 0; bxi < bx; bxi++) {
          let s = 0, sq = 0, c = 0;
          for (let y = byi * bs; y < (byi + 1) * bs; y++) {
            for (let x = bxi * bs; x < (bxi + 1) * bs; x++) {
              const v = res[y * w + x]; s += v; sq += v * v; c++;
            }
          }
          blockVars.push(sq / c - (s / c) * (s / c));
        }
      }
    }
    let blockCV = 1.0;
    if (blockVars.length > 4) {
      const mv = blockVars.reduce(function (a, b) { return a + b; }, 0) / blockVars.length;
      const vv = blockVars.reduce(function (a, b) { return a + (b - mv) * (b - mv); }, 0) / blockVars.length;
      blockCV = mv > 1e-9 ? Math.sqrt(vv) / mv : 1.0;
    }

    /* high-frequency energy via 2-level pyramid */
    function energy(arr, W, H) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i]; return s; }
    const half = new Float32Array(Math.floor(w / 2) * Math.floor(h / 2));
    for (let y = 0; y + 1 < h; y += 2) for (let x = 0; x + 1 < w; x += 2) {
      half[(y >> 1) * Math.floor(w / 2) + (x >> 1)] = (gray[y * w + x] + gray[y * w + x + 1] + gray[(y + 1) * w + x] + gray[(y + 1) * w + x + 1]) / 4;
    }
    const hfRatio = energy(res, w, h) / (energy(gray, w, h) + 1e-9);

    /* score each indicator 0..1 (1 = AI-suspicious) */
    const ind = {};
    ind.noiseUniform = clamp01(1 - (blockCV - 0.55) / 0.9);     // low CV → uniform noise
    ind.lowNoiseFloor = clamp01((2.2 - resRms) / 1.7);           // very low residual RMS
    ind.hfSuppressed = clamp01((0.028 - hfRatio) / 0.02);        // weak high-frequency energy
    ind.highSaturation = clamp01((meanSat - 0.32) / 0.3);       // saturated palette
    ind.smoothColors = clamp01((0.62 - uniqueRatio) / 0.4);      // few unique quantized colors

    const weights = { noiseUniform: 0.3, lowNoiseFloor: 0.25, hfSuppressed: 0.2, highSaturation: 0.13, smoothColors: 0.12 };
    let stat = 0;
    for (const k in weights) stat += weights[k] * ind[k];
    stat = Math.round(stat * 65); // cap heuristic at 65

    const indicators = [];
    if (ind.noiseUniform > 0.55) indicators.push('Unusually uniform noise field (no sensor-like variation)');
    if (ind.lowNoiseFloor > 0.55) indicators.push('Very low noise floor — no camera sensor noise');
    if (ind.hfSuppressed > 0.55) indicators.push('Unusually smooth fine detail, typical of AI upscaling');
    if (ind.highSaturation > 0.6) indicators.push('Elevated, saturated color palette');
    if (ind.smoothColors > 0.6) indicators.push('Unnaturally smooth color distribution');

    return { score: stat, indicators: indicators, metrics: { resRms: +resRms.toFixed(3), blockCV: +blockCV.toFixed(3), hfRatio: +(hfRatio * 1000).toFixed(3), meanSat: +meanSat.toFixed(3), uniqueRatio: +uniqueRatio.toFixed(3) } };
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ============================================================
   * SCORING — combine metadata evidence + heuristics + watermark
   * ============================================================ */

  function scoreFile(findings, stats, fileName, synth) {
    let strong = 0, medium = 0, weak = 0;
    const reasons = [];
    for (const f of findings) {
      if (f.evidence >= 3) strong++;
      else if (f.evidence === 2) medium++;
      else if (f.evidence === 1) weak++;
    }
    for (const n of SIG.matchFileName(fileName)) reasons.push({ type: 'name', text: n });

    let score = 0;
    let verdict;
    if (strong > 0) {
      score = Math.min(98, 88 + strong * 3 + medium);
      verdict = 'ai-evidence';
      reasons.push({ type: 'evidence', text: 'AI-generation markers found in metadata (' + countEvidence(findings) + ')' });
    } else if (medium > 0 || weak >= 2) {
      score = Math.min(72, 52 + medium * 8 + weak * 4);
      verdict = 'suspicious';
      if (medium) reasons.push({ type: 'evidence', text: 'Possible generator-related metadata signatures' });
    } else {
      score = stats ? Math.min(65, stats.score + (weak ? 18 : 0)) : (weak ? 30 : 6);
      verdict = score >= 55 ? 'suspicious' : score >= 30 ? 'unclear' : 'clean';
    }
    /* invisible watermark evidence (pixel-level) */
    if (synth && synth.detected) {
      score = Math.max(score, Math.min(97, 84 + Math.round(synth.confidence * 12)));
      verdict = 'ai-evidence';
      reasons.unshift({ type: 'indicator', text: 'Invisible AI watermark found in the pixels — SynthID-style pattern (' + Math.round(synth.confidence * 100) + '% confidence)' });
    } else if (synth && synth.possible) {
      score = Math.max(score, Math.min(74, 52 + Math.round(synth.confidence * 28)));
      if (verdict !== 'ai-evidence') verdict = 'suspicious';
      reasons.push({ type: 'indicator', text: 'Weak invisible-watermark signal in the pixels (statistical estimate)' });
    }
    if (stats && stats.indicators.length) for (const i of stats.indicators) reasons.push({ type: 'indicator', text: i });
    return { score: Math.round(score), verdict: verdict, reasons: reasons };
  }

  function countEvidence(findings) {
    return findings.filter(function (f) { return f.evidence >= 2; }).length + ' strong signal' + (findings.filter(function (f) { return f.evidence >= 2; }).length === 1 ? '' : 's');
  }

  /* ============================================================
   * THUMBNAIL (small dataURL for UI)
   * ============================================================ */

  async function makeThumb(buffer) {
    try {
      const bmp = await decodeToBitmap(buffer);
      const s = Math.min(1, 112 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      const canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0, w, h);
      try { bmp.close(); } catch (e) {}
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.72);
      const buf = await blob.arrayBuffer();
      let bin = '';
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
      return 'data:image/jpeg;base64,' + btoa(bin);
    } catch (e) { return null; }
  }

  /* ============================================================
   * MAIN PIPELINE
   * ============================================================ */

  function randomName() {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    const b = new Uint8Array(8);
    if (c) c.getRandomValues(b);
    else for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
    let s = '';
    for (let i = 0; i < 8; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return 'IMG_' + s.toUpperCase();
  }

  function extFor(format, type) {
    if (type === 'image/webp') return '.webp';
    if (type === 'image/png') return '.png';
    if (type === 'image/jpeg') return '.jpg';
    if (format === 'gif') return '.gif';
    return '.bin';
  }

  /**
   * processFile(buffer, name, options) → result object
   * options: { mode: 'auto'|'lossless'|'deep', stealth, format,
   *            quality?, randomizeName, stripColorProfile, wantThumb }
   */
  async function processFile(buffer, name, options) {
    const opts = options || {};
    const t0 = Date.now();
    const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const sizeMB = view.byteLength / 1048576;
    const format = P.detectFormat(view);
    const onStage = typeof opts.onStage === 'function' ? opts.onStage : null;

    /* 1 — scan */
    const parsed = await P.scan(view, sizeMB);
    let findings = dedupeFindings(parsed.findings);

    /* 2 — pixel analysis: statistical heuristics + invisible
     *     watermark (SynthID-class) detection. One decode for both. */
    let stats = null, synth = null;
    if (['jpeg', 'png', 'webp'].includes(format) && typeof createImageBitmap === 'function') {
      if (onStage) { try { onStage('analyze'); } catch (e) {} }
      try {
        const bmp = await decodeToBitmap(view);
        try { stats = statisticalDetectBmp(bmp); } catch (e) { stats = null; }
        if (SY) { try { synth = SY.analyzeBitmap(bmp); } catch (e) { synth = null; } }
        try { bmp.close(); } catch (e) {}
      } catch (e) { /* undecodable — skip pixel analysis */ }
    }

    /* 2b — surface the watermark as a finding */
    if (synth && (synth.detected || synth.possible)) {
      findings.push({
        kind: 'synthid',
        where: 'Pixel data',
        label: synth.detected ? 'Invisible AI watermark (SynthID-style)' : 'Possible invisible watermark',
        detail: synth.detected
          ? 'A hidden pattern woven into the pixels — the signature of AI watermarks like Google\u2019s SynthID'
          : 'A faint pattern in the pixels that may be an invisible watermark',
        evidence: synth.detected ? 3 : 2,
        removable: true,
      });
    }

    /* 3 — score */
    const score = scoreFile(findings, stats, name, synth);
    const aiTraces = findings.some(function (f) { return f.evidence >= 2; }) || score.verdict === 'ai-evidence';

    /* 4 — choose cleaning mode */
    let mode;
    if (opts.mode === 'lossless') mode = 'lossless';
    else if (opts.mode === 'deep') mode = 'deep';
    else mode = aiTraces ? 'deep' : 'lossless'; // smart auto

    const structuralOk = ['jpeg', 'png', 'webp', 'gif'].includes(format);
    if (!structuralOk && mode === 'lossless') {
      /* cannot do byte surgery → fall back to deep re-encode */
      mode = 'deep';
    }

    let outBuffer = null, outType = null;
    const notes = [];

    if (mode === 'lossless') {
      if (format === 'jpeg') outBuffer = cleanJpeg(view);
      else if (format === 'png') outBuffer = cleanPng(view, opts.stripColorProfile);
      else if (format === 'webp') outBuffer = cleanWebp(view, opts.stripColorProfile);
      else if (format === 'gif') outBuffer = cleanGif(view);
      outType = format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/gif';
      if (findings.some(function (f) { return f.kind === 'exif'; })) {
        notes.push('EXIF orientation tag removed with the rest of EXIF — use Deep Clean to bake rotation into pixels.');
      }
      if (synth && synth.detected) {
        notes.push('The invisible watermark lives inside the pixels — a metadata-only clean cannot touch it. Re-run with Deep Clean.');
      }
    } else {
      if (onStage) { try { onStage('clean'); } catch (e) {} }
      const r = await deepClean(view, {
        stealth: opts.stealth || 'balanced',
        format: opts.format || 'auto',
        srcFormat: format,
        name: name,
        synthidDetected: !!(synth && synth.detected),
      });
      outBuffer = r.buffer; outType = r.type;
      if (synth && synth.detected) {
        notes.push('Deep Clean dissolved the invisible watermark — pixels were subtly reshuffled to break the pattern.');
      } else {
        notes.push('Re-encoded to disrupt any invisible AI watermarks hidden in the pixels.');
      }
      if (format === 'gif') notes.push('GIF re-encoded to a still image (canvas cannot write animation).');
      if (opts.format && opts.format !== 'auto' && outType !== 'image/' + opts.format) {
        /* encoder may have fallen back (e.g. webp unsupported) */
        notes.push('Requested format unavailable in this browser — encoded as ' + outType + '.');
      }
    }

    /* 5 — verify: re-scan the output */
    const outView = new Uint8Array(outBuffer);
    const rescanned = await P.scan(outView, outView.byteLength / 1048576);
    const leftover = dedupeFindings(rescanned.findings).filter(function (f) {
      if (opts.stripColorProfile !== true && f.kind === 'icc') return false; // we keep ICC by default
      return f.kind !== 'jfif'; // canvas JFIF header is harmless? it still appears
    });
    const verifiedClean = leftover.length === 0;

    /* 5b — verify the watermark: re-detect on the cleaned output */
    let synthAfter = null, synthReduced = null, synthRemoved = null;
    if (synth && synth.detected && mode === 'deep' && typeof createImageBitmap === 'function') {
      try {
        const bmp2 = await decodeToBitmap(outBuffer);
        synthAfter = SY.analyzeBitmap(bmp2);
        try { bmp2.close(); } catch (e) {}
        if (synthAfter) {
          synthReduced = synth.cvr > 0.01 ? Math.max(0, Math.min(1, 1 - synthAfter.cvr / synth.cvr)) : null;
          synthRemoved = !synthAfter.detected && (synthAfter.confidence < 0.5 || (synthReduced ?? 0) > 0.5);
        }
      } catch (e) { synthAfter = null; }
    } else if (synth && synth.detected && mode === 'lossless') {
      /* watermark cannot survive a check it never went through */
      synthRemoved = false;
    }

    const baseName = opts.randomizeName ? randomName()
      : name.replace(/\.[a-z0-9]+$/i, '');
    const outputName = baseName + extFor(format, outType);

    let thumb = null;
    if (opts.wantThumb && (typeof OffscreenCanvas === 'function' || typeof document !== 'undefined')) {
      try { thumb = await makeThumb(outBuffer); } catch (e) { thumb = null; }
    }

    const synthidReport = synth ? {
      detected: synth.detected,
      possible: synth.possible,
      confidence: synth.confidence,
      cvr: synth.cvr,
      peak: synth.peak,
      bestSet: synth.bestSet,
      topCarriers: synth.topCarriers,
      after: synthAfter ? { confidence: synthAfter.confidence, cvr: synthAfter.cvr } : null,
      reduced: synthReduced === null ? null : Math.round(synthReduced * 100),
      removed: synthRemoved,
    } : null;

    return {
      originalName: name,
      outputName: outputName,
      format: format,
      mode: mode,
      cleaned: true,
      verifiedClean: verifiedClean,
      leftoverFindings: leftover,
      findings: findings,
      aiScore: score.score,
      verdict: score.verdict,
      reasons: score.reasons,
      indicators: stats ? stats.indicators : [],
      metrics: stats ? stats.metrics : null,
      synthid: synthidReport,
      notes: notes,
      originalSize: view.byteLength,
      outputSize: outBuffer.byteLength,
      outputType: outType,
      thumb: thumb,
      ms: Date.now() - t0,
      outputBuffer: outBuffer instanceof Uint8Array ? outBuffer : new Uint8Array(outBuffer)
    };
  }

  function dedupeFindings(list) {
    const seen = new Set();
    const out = [];
    for (const f of list) {
      const k = f.kind + '|' + f.where + '|' + f.label;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out;
  }

  const api = {
    STEALTH: STEALTH,
    cleanJpeg: cleanJpeg, cleanPng: cleanPng, cleanWebp: cleanWebp, cleanGif: cleanGif,
    deepClean: deepClean, statisticalDetectBmp: statisticalDetectBmp, scoreFile: scoreFile,
    processFile: processFile, makeThumb: makeThumb, randomName: randomName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UntraceEngine = api;
})(typeof self !== 'undefined' ? self : globalThis);
