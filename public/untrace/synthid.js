/* ============================================================
 * Untrace · synthid.js
 * SynthID-class invisible watermark detection + dissolution.
 *
 * Based on public reverse-engineering research of Google's
 * SynthID (github.com/aloshdenny/reverse-SynthID):
 *   - empirically verified carrier frequency sets on a 512px
 *     analysis grid (dark-image diagonal grid + bright-image
 *     horizontal axis) and universal 1024px bins
 *   - detection: noise-residual FFT, carrier-vs-background
 *     energy ratio + local peak prominence (codebook-free)
 *   - removal: geometric dissolution — smooth elastic warp
 *     (fragments spatial phase consensus), affine combo
 *     (rotation + zoom + shift), resize squeeze, color nudge,
 *     carrier notch, JPEG re-encode chain
 *
 * Works in: Web Worker, main thread, Node (pure functions).
 * ============================================================ */
(function (root) {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;

  /* ============================================================
   * CARRIER TABLES (from published reverse-engineering data)
   * Coordinates are (fy, fx) on an N×N analysis grid, centered.
   * ============================================================ */

  /* Dark-image carriers — diagonal grid, 512px, extracted from
   * 291 Gemini images (black + nano-banana-pro). */
  const CARRIERS_DARK = [
    [-5, -3], [5, 3], [-5, 3], [5, -3],
    [-3, -4], [3, 4], [-3, 4], [3, -4],
    [-4, -3], [4, 3], [-4, 3], [4, -3],
    [-5, -1], [5, 1], [-5, 1], [5, -1],
    [-5, -2], [5, 2], [-5, 2], [5, -2],
    [-2, -5], [2, 5], [-2, 5], [2, -5],
    [-1, -5], [1, 5], [-1, 5], [1, -5],
    [-4, -4], [4, 4], [-4, 4], [4, -4],
    [-1, -6], [1, 6], [-3, -5], [3, 5],
  ];

  /* Bright/white-image carriers — horizontal axis, 512px. */
  const CARRIERS_WHITE = [
    [0, -7], [0, 7], [0, -8], [0, 8],
    [0, -9], [0, 9], [0, -10], [0, 10],
    [0, -11], [0, 11], [0, -12], [0, 12],
    [0, -20], [0, 20], [0, -21], [0, 21],
    [0, -22], [0, 22], [0, -23], [0, 23],
  ];

  /* Universal bins on a 1024px grid (150k image-pair study). */
  const UNIVERSAL_1024 = [
    [14, 14], [14, -14], [-14, 14], [-14, -14],
    [98, 14], [98, -14], [-98, 14], [-98, -14],
    [126, 14], [126, -14], [-126, 14], [-126, -14],
    [128, 128], [128, -128], [-128, 128], [-128, -128],
    [210, 14], [210, -14], [-210, 14], [-210, -14],
    [238, 14], [238, -14], [-238, 14], [-238, -14],
  ];

  const ANALYSIS_SIZE = 512;

  /* ============================================================
   * RNG (xorshift32) — deterministic per file
   * ============================================================ */

  function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ============================================================
   * FFT — iterative radix-2 (power-of-two sizes only)
   * ============================================================ */

  /* In-place 1D FFT. re/im are Float64Array of length n=2^k. */
  function fft1d(re, im, inverse) {
    const n = re.length;
    /* bit reversal */
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
  }

  /* 2D FFT on row-major W×H planes (W, H powers of two). */
  function fft2d(re, im, w, h, inverse) {
    const rowR = new Float64Array(w), rowI = new Float64Array(w);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) { rowR[x] = re[off + x]; rowI[x] = im[off + x]; }
      fft1d(rowR, rowI, inverse);
      for (let x = 0; x < w; x++) { re[off + x] = rowR[x]; im[off + x] = rowI[x]; }
    }
    const colR = new Float64Array(h), colI = new Float64Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) { colR[y] = re[y * w + x]; colI[y] = im[y * w + x]; }
      fft1d(colR, colI, inverse);
      for (let y = 0; y < h; y++) { re[y * w + x] = colR[y]; im[y * w + x] = colI[y]; }
    }
  }

  function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }

  /* Centered frequency (fy, fx) → flat index into an unshifted
   * W×H FFT result. Both (fy,fx) and (−fy,−fx) map correctly. */
  function binIndex(fy, fx, w, h) {
    const yy = ((fy % h) + h) % h;
    const xx = ((fx % w) + w) % w;
    return yy * w + xx;
  }

  /* ============================================================
   * SEPARABLE BOX BLUR (running sum) — ~O(pixels) per pass
   * ============================================================ */

  function boxBlur(src, w, h, r) {
    if (r < 1) return src;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const inv = 1 / (2 * r + 1);
    /* horizontal */
    for (let y = 0; y < h; y++) {
      const off = y * w;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[off + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        tmp[off + x] = acc * inv;
        acc += src[off + Math.min(w - 1, x + r + 1)] - src[off + Math.max(0, x - r)];
      }
    }
    /* vertical */
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc * inv;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  /* Approximate Gaussian blur: k passes of box blur. */
  function gaussianApprox(src, w, h, sigma, passes) {
    const r = Math.max(1, Math.round(sigma / Math.sqrt((passes || 3) / 3) / 1.6));
    let cur = src;
    for (let i = 0; i < (passes || 3); i++) cur = boxBlur(cur, w, h, r);
    return cur;
  }

  /* ============================================================
   * DETECTION — codebook-free statistical detector
   *
   * Mirrors the published detector's structure (residual FFT,
   * carrier-vs-random ratio, peak analysis) with two
   * band-normalized signals that work without reference phases:
   *   cvr  — carrier energy vs. same-frequency-band background
   *   prom — per-carrier local peak prominence (ring median)
   * ============================================================ */

  /**
   * detectGray512(gray) — analyze a 512×512 grayscale plane
   * (Float32Array, 0..255). Returns a plain result object.
   */
  function detectGray512(gray) {
    const S = ANALYSIS_SIZE, N = S * S;
    if (gray.length !== N) return null;

    /* residual: gray − lowpass(gray) (≈ σ2.2 Gaussian high-pass) */
    const low = gaussianApprox(gray, S, S, 2.2, 3);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = gray[i] - low[i];
    fft2d(re, im, S, S, false);

    const magAt = function (fy, fx) {
      const i = binIndex(fy, fx, S, S);
      return Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    };

    /* carrier lookup sets for ring exclusion */
    function makeSet(list) {
      const map = new Set();
      for (const c of list) map.add(c[0] + ',' + c[1]);
      return map;
    }
    const darkSet = makeSet(CARRIERS_DARK);
    const whiteSet = makeSet(CARRIERS_WHITE);

    function analyzeCarriers(list, exclude) {
      let magSum = 0;
      const pairs = [];
      for (const c of list) {
        const m = magAt(c[0], c[1]);
        magSum += m;
        /* ring median (r 4..7, Chebyshev), excluding carrier bins */
        const ring = [];
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const r = Math.max(Math.abs(dy), Math.abs(dx));
            if (r < 4 || r > 7) continue;
            if (exclude.has((c[0] + dy) + ',' + (c[1] + dx))) continue;
            ring.push(magAt(c[0] + dy, c[1] + dx));
          }
        }
        ring.sort(function (a, b) { return a - b; });
        const med = ring.length ? ring[ring.length >> 1] : 0;
        pairs.push({ fy: c[0], fx: c[1], prom: m / (med + 1e-9) });
      }
      pairs.sort(function (a, b) { return b.prom - a.prom; });
      /* median of the top 8 prominences: robust against a handful
       * of image-content harmonics landing near carrier bins */
      const top = pairs.slice(0, Math.min(8, pairs.length));
      const meds = top.map(function (p) { return p.prom; }).sort(function (a, b) { return a - b; });
      const medTop = meds.length ? (meds.length % 2 ? meds[meds.length >> 1] : (meds[meds.length / 2 - 1] + meds[meds.length / 2]) / 2) : 1;
      /* strict local-peak hits: white-noise bins rarely exceed
       * 3.5× their ring median by chance */
      const hitFrac = pairs.filter(function (p) { return p.prom > 3.5; }).length / (pairs.length || 1);
      return { meanMag: magSum / list.length, medTop: medTop, hitFrac: hitFrac, pairs: pairs };
    }

    /* band-matched random background: sample bins whose radius
     * matches the carrier band (3..30), excluding DC vicinity */
    const rng = makeRng(0x5eed51d);
    const randMags = [];
    let guard = 0;
    while (randMags.length < 256 && guard++ < 4096) {
      const fy = Math.floor(rng() * (S - 20)) - (S / 2 - 10);
      const fx = Math.floor(rng() * (S - 20)) - (S / 2 - 10);
      const r = Math.sqrt(fy * fy + fx * fx);
      if (r < 3 || r > 34) continue;
      if (darkSet.has(fy + ',' + fx) || whiteSet.has(fy + ',' + fx)) continue;
      randMags.push(magAt(fy, fx));
    }
    randMags.sort(function (a, b) { return a - b; });
    const randMean = randMags.reduce(function (a, b) { return a + b; }, 0) / (randMags.length || 1);

    /* strongest NON-carrier peak in the band: a genuinely
     * watermarked image has carriers as its dominant peaks, while
     * periodic image content produces its own strong peaks */
    let maxBgProm = 0;
    {
      const band = [];
      for (let fy = -34; fy <= 34; fy++) {
        for (let fx = -34; fx <= 34; fx++) {
          const r = Math.sqrt(fy * fy + fx * fx);
          if (r < 3 || r > 34) continue;
          if (darkSet.has(fy + ',' + fx) || whiteSet.has(fy + ',' + fx)) continue;
          band.push([fy, fx, magAt(fy, fx)]);
        }
      }
      band.sort(function (a, b) { return b[2] - a[2]; });
      for (let i = 0; i < Math.min(24, band.length); i++) {
        const ring = [];
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const rr = Math.max(Math.abs(dy), Math.abs(dx));
            if (rr < 4 || rr > 7) continue;
            const by = band[i][0] + dy, bx = band[i][1] + dx;
            if (darkSet.has(by + ',' + bx) || whiteSet.has(by + ',' + bx)) continue;
            ring.push(magAt(by, bx));
          }
        }
        ring.sort(function (a, b) { return a - b; });
        const med = ring.length ? ring[ring.length >> 1] : 0;
        const prom = band[i][2] / (med + 1e-9);
        if (prom > maxBgProm) maxBgProm = prom;
      }
    }

    /* per-set analysis, best set wins (watermark is content-adaptive) */
    const darkRes = analyzeCarriers(CARRIERS_DARK, darkSet);
    const whiteRes = analyzeCarriers(CARRIERS_WHITE, whiteSet);
    const both = { meanMag: (darkRes.meanMag + whiteRes.meanMag) / 2, medTop: (darkRes.medTop + whiteRes.medTop) / 2, hitFrac: Math.max(darkRes.hitFrac, whiteRes.hitFrac) };
    const bySet = { dark: darkRes, white: whiteRes };

    const scoreSet = function (r) {
      const cvr = randMean > 1e-9 ? r.meanMag / randMean : 1;
      const cvrScore = sigmoid(3.0 * (cvr - 1.45));
      /* peakiness damping: carrier peaks must dominate the image's
       * own strongest non-carrier spectral peak */
      const contrast = r.medTop / Math.max(maxBgProm, 1e-9);
      const damp = clamp01(contrast / 0.75);
      const promScore = sigmoid(2.5 * (r.medTop - 2.4)) * damp;
      const hitScore = sigmoid(8.0 * (r.hitFrac - 0.12)) * damp;
      return 0.4 * cvrScore + 0.35 * promScore + 0.25 * hitScore;
    };

    let bestName = 'dark', best = darkRes, bestScore = scoreSet(darkRes);
    const wScore = scoreSet(whiteRes);
    if (wScore > bestScore) { bestName = 'white'; best = whiteRes; bestScore = wScore; }
    const bScore = scoreSet(both);
    if (bScore > bestScore) { bestName = 'combined'; best = both; bestScore = bScore; }

    const cvr = randMean > 1e-9 ? best.meanMag / randMean : 1;
    const confidence = clamp01(bestScore);

    /* top carriers for the report */
    const bestPairs = (bestName === 'combined' ? darkRes : best).pairs;
    const topCarriers = bestPairs.slice(0, 4).map(function (p) {
      return { fy: p.fy, fx: p.fx, prom: +p.prom.toFixed(2) };
    });

    return {
      detected: confidence >= 0.60,
      possible: confidence >= 0.34 && confidence < 0.60,
      confidence: +confidence.toFixed(3),
      cvr: +cvr.toFixed(3),
      peak: +best.medTop.toFixed(3),
      hitFrac: +best.hitFrac.toFixed(3),
      bestSet: bestName,
      topCarriers: topCarriers,
    };
  }

  /* ============================================================
   * BITMAP ANALYSIS (browser path)
   * ============================================================ */

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
    const c = G.document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /**
   * analyzeBitmap(bmp) — draw an ImageBitmap / image source to a
   * 512×512 canvas and run the detector. Returns null when the
   * image is too small to analyze meaningfully.
   */
  function analyzeBitmap(bmp) {
    try {
      if (!bmp || !bmp.width || !bmp.height) return null;
      if (Math.min(bmp.width, bmp.height) < 256) return null;
      const S = ANALYSIS_SIZE;
      const canvas = makeCanvas(S, S);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;
      const gray = new Float32Array(S * S);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (data[p] + data[p + 1] + data[p + 2]) / 3;
      }
      return detectGray512(gray);
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
   * DISSOLUTION — geometric watermark disruptors
   *
   * Round-06-style stack (minus the VAE stage, which needs a
   * neural net): elastic warp + affine combo in ONE resampling
   * pass, then squeeze + color nudge handled by the caller.
   * ============================================================ */

  /* Smooth random displacement field: white noise → repeated box
   * blur (≈ Gaussian, σ) → normalized so max |d| = alpha px. */
  function elasticField(w, h, sigma, alpha, rng) {
    const n = w * h;
    let f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = rng() * 2 - 1;
    f = gaussianApprox(f, w, h, sigma, 3);
    let mx = 1e-9;
    for (let i = 0; i < n; i++) { const a = Math.abs(f[i]); if (a > mx) mx = a; }
    const k = alpha / mx;
    for (let i = 0; i < n; i++) f[i] *= k;
    return f;
  }

  /**
   * dissolvePixels(img, opts) — single-pass bilinear warp that
   * combines elastic deformation with a global affine (rotation +
   * zoom + shift). img: {data:Uint8ClampedArray, width, height}.
   * opts: { alpha, sigma, rotate, zoom, shiftX, shiftY, rng }.
   * Returns a NEW {data, width, height} (RGBA).
   */
  function dissolvePixels(img, opts) {
    const W = img.width, H = img.height, src = img.data;
    const out = new Uint8ClampedArray(W * H * 4);
    const rng = opts.rng || makeRng((Date.now() & 0xffff) >>> 0);

    let dx = null, dy = null;
    if (opts.alpha > 0) {
      dx = elasticField(W, H, opts.sigma || 50, opts.alpha, rng);
      dy = elasticField(W, H, opts.sigma || 50, opts.alpha, rng);
    }

    /* inverse affine: dest (x,y) ← source = R⁻¹(p − c)/z + c + t */
    const rot = opts.rotate || 0;
    const zoom = opts.zoom || 1;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const cx = W / 2, cy = H / 2;
    const tx = opts.shiftX || 0, ty = opts.shiftY || 0;

    const sample = function (x, y, o) {
      /* bilinear sample with clamp-to-edge, per channel */
      const x0 = x < 0 ? 0 : x > W - 1 ? W - 1 : x | 0;
      const y0 = y < 0 ? 0 : y > H - 1 ? H - 1 : y | 0;
      const x1 = x0 + 1 < W ? x0 + 1 : x0;
      const y1 = y0 + 1 < H ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
      const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = w00 * src[i00 + c] + w10 * src[i10 + c] + w01 * src[i01 + c] + w11 * src[i11 + c];
      }
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const ex = dx ? dx[i] : 0, ey = dy ? dy[i] : 0;
        const px = x - cx, py = y - cy;
        /* rotate by −rot, un-zoom, re-center, translate, elastic */
        const sx = (cos * px + sin * py) / zoom + cx + tx + ex;
        const sy = (-sin * px + cos * py) / zoom + cy + ty + ey;
        sample(sx, sy, i * 4);
      }
    }
    return { data: out, width: W, height: H };
  }

  /**
   * colorNudge(img, opts) — brightness / contrast / saturation
   * micro-shifts. brightness: ±255-scale, contrast: factor around
   * 128, saturation: factor (1 = untouched).
   */
  function colorNudge(img, opts) {
    const d = img.data;
    const b = opts.brightness || 0;
    const c = opts.contrast || 1;
    const s = opts.saturation || 1;
    if (b === 0 && c === 1 && s === 1) return img;
    for (let p = 0; p < d.length; p += 4) {
      let r = d[p], g = d[p + 1], bl = d[p + 2];
      /* contrast around mid-gray */
      r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
      /* saturation toward luminance */
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s;
      d[p] = r + b; d[p + 1] = g + b; d[p + 2] = bl + b;
    }
    return img;
  }

  /**
   * notchCarriers(img, strength, gridSize) — FFT-domain carrier
   * suppression for exact-size square images (512 or 1024).
   * Damps a ±2 neighborhood around each known carrier bin (the
   * warp/squeeze stages spread and shift carrier energy across
   * nearby bins), always treating Hermitian bin pairs identically
   * so the inverse transform stays real. Bins that clearly stick
   * out above their local background are removed decisively;
   * bins at background level are left untouched.
   */
  function notchCarriers(img, strength, gridSize) {
    const W = img.width, H = img.height;
    if (W !== H || !isPow2(W)) return img;
    const size = gridSize || W;
    if (size !== 512 && size !== 1024) return img;

    /* carrier list for this grid */
    let bins = [];
    if (size === 512) {
      bins = CARRIERS_DARK.concat(CARRIERS_WHITE);
    } else {
      bins = UNIVERSAL_1024.slice();
      /* also place the 512-grid sets at 2× positions (covers
       * models whose carriers scale with resolution) */
      for (const c of CARRIERS_DARK) bins.push([c[0] * 2, c[1] * 2]);
      for (const c of CARRIERS_WHITE) bins.push([c[0] * 2, c[1] * 2]);
    }
    const binSet = new Set(bins.map(function (b) { return b[0] + ',' + b[1]; }));

    const N = W * H;
    const re = new Float64Array(N), im = new Float64Array(N);
    const ring = [];
    const out = img.data;
    /* strength falloff by Chebyshev distance from the carrier */
    const FALLOFF = [1.0, 0.8, 0.5];

    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < N; i++) re[i] = out[i * 4 + ch];
      im.fill(0);
      fft2d(re, im, W, W, false);

      for (const b of bins) {
        const fy = b[0], fx = b[1];
        /* local background: ring median r 4..7, carrier-free */
        ring.length = 0;
        for (let dy = -7; dy <= 7; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const r = Math.max(Math.abs(dy), Math.abs(dx));
            if (r < 4 || r > 7) continue;
            if (binSet.has((fy + dy) + ',' + (fx + dx))) continue;
            const ii = binIndex(fy + dy, fx + dx, W, W);
            ring.push(Math.sqrt(re[ii] * re[ii] + im[ii] * im[ii]));
          }
        }
        ring.sort(function (a, b2) { return a - b2; });
        const med = ring.length ? ring[ring.length >> 1] : 0;

        /* damp the carrier neighborhood */
        for (let ndy = -2; ndy <= 2; ndy++) {
          for (let ndx = -2; ndx <= 2; ndx++) {
            const d = Math.max(Math.abs(ndy), Math.abs(ndx));
            const i1 = binIndex(fy + ndy, fx + ndx, W, W);
            const m = Math.sqrt(re[i1] * re[i1] + im[i1] * im[i1]);
            if (m < 1e-9) continue;
            /* decisive removal for clear peaks; gentle for the rest */
            let s = strength * FALLOFF[d];
            if (m > 4 * med) s = Math.max(s, 0.88);
            const target = Math.max(med * 1.15, m * (1 - s));
            if (m > target) {
              const k = target / m;
              re[i1] *= k; im[i1] *= k;
              const i2 = binIndex(-(fy + ndy), -(fx + ndx), W, W);
              re[i2] *= k; im[i2] *= k;
            }
          }
        }
      }

      fft2d(re, im, W, W, true);
      for (let i = 0; i < N; i++) out[i * 4 + ch] = re[i];
    }
    return img;
  }

  /* ============================================================
   * METRICS
   * ============================================================ */

  function psnr(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let se = 0, n = 0;
    for (let p = 0; p < a.length; p += 4) {
      if (a[p + 3] === 0 && b[p + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const d = a[p + c] - b[p + c];
        se += d * d; n++;
      }
    }
    if (!n) return 99;
    const mse = se / n;
    return mse < 1e-9 ? 99 : 10 * Math.log10(255 * 255 / mse);
  }

  /* ============================================================
   * DISSOLVE PRESETS — tuned from the published Round-06 attack
   * (final / nuke), scaled for browser + batch throughput.
   * ============================================================ */

  const DISSOLVE = {
    safe: null,
    balanced: {
      alpha: 1.8, sigma: 48,       /* elastic warp, px */
      rotate: 0.006, zoom: 1.005, shift: 1.0,
      squeeze: 0.90,              /* downsample factor */
      brightness: 0.8, contrast: 1.004, saturation: 1.008,
      noise: 2.0, quality: 0.92, passes: 1,
      notch: 0.65, psnrFloor: 24,
    },
    aggressive: {
      alpha: 2.8, sigma: 52,
      rotate: 0.011, zoom: 1.010, shift: 2.0,
      squeeze: 0.82,
      brightness: 1.5, contrast: 1.008, saturation: 1.015,
      noise: 3.5, quality: 0.88, passes: 2,
      notch: 0.80, psnrFloor: 14,
    },
  };

  /* ============================================================ */

  const api = {
    CARRIERS_DARK: CARRIERS_DARK,
    CARRIERS_WHITE: CARRIERS_WHITE,
    UNIVERSAL_1024: UNIVERSAL_1024,
    ANALYSIS_SIZE: ANALYSIS_SIZE,
    DISSOLVE: DISSOLVE,
    fft1d: fft1d,
    fft2d: fft2d,
    binIndex: binIndex,
    detectGray512: detectGray512,
    analyzeBitmap: analyzeBitmap,
    dissolvePixels: dissolvePixels,
    colorNudge: colorNudge,
    notchCarriers: notchCarriers,
    elasticField: elasticField,
    psnr: psnr,
    makeRng: makeRng,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UntraceSynthid = api;
})(typeof self !== 'undefined' ? self : globalThis);
