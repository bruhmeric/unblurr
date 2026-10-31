/* ============================================================
 * Untrace · synthid.js
 * SynthID watermark detection + dissolution.
 *
 * DETECTION — signal-reading method (the approach used by
 * synthiddetector.com): no statistical estimation, no
 * percentages. The detector reads the signals a file actually
 * carries, in four deterministic channels, entirely in the
 * browser/worker:
 *   1. c2pa      — Content Credentials (JUMBF manifest store,
 *                  ISO 19566-5): issuer, claim generator, AI
 *                  digital-source declarations, signer
 *                  certificate, SynthID declarations
 *   2. synthid   — SynthID watermark declarations: Google signs
 *                  its generated images (Gemini / Imagen) with a
 *                  credential that declares an invisible SynthID
 *                  watermark is embedded; OpenAI images carry the
 *                  same dual signal since May 2026. An explicit
 *                  "SynthID" mention in credentials or metadata
 *                  counts too.
 *   3. metadata  — EXIF / XMP / PNG text chunks: IPTC
 *                  digitalSourceType codes (e.g.
 *                  trainedAlgorithmicMedia), generator names
 *   4. tamper    — structural evidence that provenance data was
 *                  deliberately removed (emptied credential
 *                  carriers, header-only EXIF, empty text chunks)
 *
 * A signal is present and readable, or it is not — there is
 * nothing to estimate. The Google pixel watermark itself
 * (synthid.google) can only be verified by the key holder and is
 * always reported under notChecked, never guessed.
 *
 * REMOVAL — unchanged geometric dissolution: smooth elastic warp
 * (fragments spatial phase consensus), affine combo (rotation +
 * zoom + shift), resize squeeze, color nudge, carrier notch,
 * JPEG re-encode chain.
 *
 * Works in: Web Worker, main thread, Node (pure functions).
 * ============================================================ */
(function (root) {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;

  /* ============================================================
   * CARRIER TABLES (from published reverse-engineering data) —
   * used by the REMOVAL stage (carrier notch) only.
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

  /* ============================================================
   * FFT — iterative radix-2 (power-of-two sizes only).
   * Used by the removal stage (carrier notch).
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
   * (removal stage: elastic warp fields)
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
   * DETECTION — signal reading (synthiddetector.com method)
   *
   * Four channels, deterministic results. Reads only what the
   * file actually carries; never estimates, never scores.
   * ============================================================ */

  /* ---------- byte helpers ---------- */

  function be32(v, o) {
    return ((v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]) >>> 0;
  }

  function bytesAt(v, o, ascii) {
    for (let i = 0; i < ascii.length; i++) {
      if (v[o + i] !== ascii.charCodeAt(i)) return false;
    }
    return true;
  }

  function asciiOf(v, from, to) {
    let s = '';
    for (let i = from; i < to; i++) s += String.fromCharCode(v[i]);
    return s;
  }

  /* Naive ASCII byte search (needles are short; regions bounded). */
  function findAscii(v, needle, from, to) {
    const n = needle.length;
    const end = Math.min(to === undefined ? v.length : to, v.length) - n;
    outer:
    for (let i = from || 0; i <= end; i++) {
      for (let j = 0; j < n; j++) {
        if (v[i + j] !== needle.charCodeAt(j)) continue outer;
      }
      return i;
    }
    return -1;
  }

  /* Naive binary byte-pattern search (cert OIDs). */
  function findPattern(v, pat, from) {
    const n = pat.length;
    const end = v.length - n;
    outer:
    for (let i = from || 0; i <= end; i++) {
      for (let j = 0; j < n; j++) {
        if (v[i + j] !== pat[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /* Latin-1 (byte-preserving) text of a region, for string/regex
   * matching. Bounded so pathological files stay cheap. */
  function latin1Text(v, cap) {
    const end = Math.min(v.length, cap || 1048576);
    let s = '';
    for (let i = 0; i < end; i += 8192) {
      const n = Math.min(8192, end - i);
      s += String.fromCharCode.apply(null, v.subarray(i, i + n));
    }
    return s;
  }

  function concatU8(arrays) {
    let n = 0;
    for (const a of arrays) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }

  /* ---------- format sniffing ---------- */

  function sniffFormat(view) {
    if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8) return 'jpeg';
    if (view.length >= 8 && view[0] === 0x89 && bytesAt(view, 1, 'PNG')) return 'png';
    if (view.length >= 12 && bytesAt(view, 0, 'RIFF') && bytesAt(view, 8, 'WEBP')) return 'webp';
    if (view.length >= 6 && (bytesAt(view, 0, 'GIF87a') || bytesAt(view, 0, 'GIF89a'))) return 'gif';
    return 'other';
  }

  /* ---------- C2PA manifest store discovery ----------
   * A store is a JUMBF superbox: [len(4)] "jumb" [description
   * box: len(4) "jumd" 16-byte UUID "c2pa…" label…] [payload…].
   * The description UUID of a C2PA manifest store begins with
   * the ASCII bytes "c2pa". */

  function scanJumbStores(bytes) {
    const stores = [];
    if (!bytes || bytes.length < 40) return stores;
    let i = 0;
    while (i + 40 <= bytes.length) {
      let j = findAscii(bytes, 'jumb', i);
      const ju = findAscii(bytes, 'JUMB', i);
      if (j < 0 || (ju >= 0 && ju < j)) j = ju;
      if (j < 0 || j < 4) break;
      const boxStart = j - 4;
      const len = be32(bytes, boxStart);
      let next = j + 4;
      if (len >= 40 && len <= bytes.length - boxStart) {
        if (be32(bytes, j + 4) >= 24 &&
            (bytesAt(bytes, j + 8, 'jumd') || bytesAt(bytes, j + 8, 'JUMD')) &&
            (bytesAt(bytes, j + 12, 'c2pa') || bytesAt(bytes, j + 12, 'C2PA'))) {
          stores.push(bytes.subarray(boxStart, boxStart + len));
          next = boxStart + len;
        }
      }
      i = next;
    }
    return stores;
  }

  /* Raw fallback: scan the file head for JUMBF c2pa stores
   * (covers MP4/AVIF-style ContentProvenanceBox payloads and
   * odd embeddings — the store bytes are validated the same way). */
  function rawFallbackStores(view) {
    const cap = Math.min(view.length, 1572864); /* 1.5 MB head */
    return scanJumbStores(view.subarray(0, cap));
  }

  /* ---------- JPEG ---------- */

  function jpegWalk(view) {
    const app11 = [], meta = [], tamper = [];
    let off = 2;
    const N = view.length;
    while (off + 4 <= N) {
      if (view[off] !== 0xff) break;
      const m = view[off + 1];
      if (m === 0xd8 || m === 0xd9 || m === 0xda) break;
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { off += 2; continue; }
      const len = (view[off + 2] << 8) | view[off + 3];
      if (len < 2 || off + 2 + len > N) break;
      const payload = view.subarray(off + 4, off + 2 + len);
      if (m === 0xeb) {                       /* APP11 — JUMBF/C2PA carrier */
        if (payload.length >= 2 && bytesAt(payload, 0, 'JP')) app11.push(payload);
      } else if (m === 0xe1) {                /* APP1 — EXIF / XMP */
        if (payload.length >= 6 && bytesAt(payload, 0, 'Exif')) {
          if (payload.length <= 8) tamper.push('EXIF container present but empty (header only)');
          else meta.push(payload);
        } else {
          meta.push(payload);
        }
      } else if (m === 0xed) {                /* APP13 — IPTC/Photoshop */
        meta.push(payload);
      } else if (m === 0xfe) {                /* COM — comment */
        if (payload.length === 0) tamper.push('JPEG comment segment present but empty');
        else meta.push(payload);
      }
      off += 2 + len;
    }
    return { app11: app11, meta: meta, tamper: tamper };
  }

  /* Reassemble a multi-segment APP11 store: each segment carries
   * "JP" + box instance + packet sequence (8-byte framing per
   * ISO 19566-5 D.2); the JUMBF bytes are the rest. */
  function storesFromApp11(payloads) {
    const strips = [8, 6, 0];
    for (let s = 0; s < strips.length; s++) {
      const parts = [];
      for (const p of payloads) parts.push(p.subarray(Math.min(strips[s], p.length)));
      const stores = scanJumbStores(concatU8(parts));
      if (stores.length) return stores;
    }
    return [];
  }

  /* ---------- PNG ---------- */

  function pngWalk(view) {
    const c2paChunks = [], meta = [], tamper = [];
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    let off = 8;
    const N = view.length;
    while (off + 8 <= N) {
      const len = dv.getUint32(off);
      const type = asciiOf(view, off + 4, off + 8);
      if (off + 12 + len > N) break;
      const payload = view.subarray(off + 8, off + 8 + len);
      if (type === 'caBX' || type === 'c2pa') {
        c2paChunks.push(payload);
      } else if (type === 'tEXt' || type === 'iTXt' || type === 'eXIf') {
        if (len === 0) tamper.push('PNG ' + type + ' chunk present but empty');
        else meta.push(payload);
      } else if (type !== 'IDAT' && payload.length > 0 && payload.length <= 1048576) {
        /* loose JUMBF fragments in a non-carrier chunk: a credential
         * container that holds no valid manifest store */
        if (findAscii(payload, 'jumb', 0, payload.length) >= 0 ||
            findAscii(payload, 'JUMBF', 0, payload.length) >= 0 ||
            findAscii(payload, 'jumd', 0, payload.length) >= 0) {
          tamper.push('Credential carrier chunk (' + type.replace(/[^ -~]/g, '') + ') present but no valid manifest store');
        }
      }
      off += 12 + len;
      if (type === 'IEND') break;
    }
    let stores = [];
    if (c2paChunks.length) {
      stores = scanJumbStores(concatU8(c2paChunks));
      if (!stores.length) tamper.push('C2PA carrier chunk present but contains no manifest store');
    }
    return { stores: stores, meta: meta, tamper: tamper };
  }

  /* ---------- WebP ---------- */

  function webpWalk(view) {
    const meta = [], candidates = [];
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    let off = 12;
    const N = view.length;
    while (off + 8 <= N) {
      const id = asciiOf(view, off, off + 4);
      const len = dv.getUint32(off + 4, true);
      if (off + 8 + len > N) break;
      const payload = view.subarray(off + 8, off + 8 + len);
      if (id === 'XMP ' || id === 'XMP' || id === 'EXIF') meta.push(payload);
      if (payload.length >= 12 && payload.length <= 1048576 &&
          (findAscii(payload, 'jumb', 0, payload.length) >= 0 ||
           findAscii(payload, 'JUMBF', 0, payload.length) >= 0)) {
        candidates.push(payload);
      }
      off += 8 + len + (len & 1);
    }
    let stores = [];
    for (const c of candidates) stores = stores.concat(scanJumbStores(c));
    const tamper = (candidates.length && !stores.length)
      ? ['Credential carrier present but no valid manifest store'] : [];
    return { stores: stores, meta: meta, tamper: tamper };
  }

  function extractSignals(view, fmt) {
    let ex;
    if (fmt === 'jpeg') {
      const w = jpegWalk(view);
      const stores = w.app11.length ? storesFromApp11(w.app11) : [];
      const tamper = w.tamper.slice();
      if (w.app11.length && !stores.length) {
        tamper.push('C2PA carrier (APP11 "JP") present but contains no manifest store');
      }
      ex = { stores: stores, meta: w.meta, tamper: tamper };
    } else if (fmt === 'png') {
      ex = pngWalk(view);
    } else if (fmt === 'webp') {
      ex = webpWalk(view);
    } else {
      ex = { stores: [], meta: [], tamper: [] };
    }
    if (!ex.stores.length) {
      const raw = rawFallbackStores(view);
      if (raw.length) ex.stores = ex.stores.concat(raw);
    }
    ex.meta = ex.meta.slice(0, 64); /* bound metadata regions */
    return ex;
  }

  /* ---------- channel markers ---------- */

  /* Cert organization names (checked first — X.509 subjects). */
  const CERT_ORGS = [
    'Google LLC', 'OpenAI', 'Adobe Inc.', 'Microsoft Corporation',
    'Anthropic', 'Nikon Corporation', 'Sony Corporation', 'Canon Inc.',
    'Leica Camera AG', 'Fujifilm Corporation',
  ];

  /* Vendor families (claim generators, software agents, certs). */
  const VENDOR_MATCHERS = [
    { vendor: 'google', re: /\b(google|gemini|imagen|veo|deepmind|nano[ \-]?banana)\b/i },
    { vendor: 'openai', re: /\b(openai|chatgpt|gpt-image|dall-e|dalle)\b/i },
    { vendor: 'adobe', re: /\b(adobe|firefly|photoshop|lightroom)\b/i },
    { vendor: 'microsoft', re: /\b(microsoft|azure)\b/i },
    { vendor: 'anthropic', re: /\banthropic\b/i },
  ];

  const CAMERA_RE = /\b(nikon|canon|sony|fujifilm|leica|panasonic|olympus|pentax)\b/i;

  /* IPTC digitalSourceType codes that mean AI involvement. */
  function aiSourceMarkers(lowerText) {
    const found = [];
    if (lowerText.indexOf('compositewithtrainedalgorithmicmedia') >= 0) found.push('compositeWithTrainedAlgorithmicMedia');
    if (lowerText.indexOf('trainedalgorithmicmedia') >= 0) found.push('trainedAlgorithmicMedia');
    if (lowerText.indexOf('compositesynthetic') >= 0) found.push('compositeSynthetic');
    return found;
  }

  /* Generator names in plain metadata (unsigned, weaker evidence). */
  const GENERATOR_RE = /\b(firefly|midjourney|stable[ \-]?diffusion|automatic1111|invokeai|comfyui|novelai|dall-e|dalle3|gpt-image|openai|ideogram|leonardo[. \-]ai|recraft|nightcafe|runwayml|flux[. \-]1|black[ \-]?forest[ \-]?labs|grok)\b/i;

  const SYNTHID_RE = /synthid/i;

  function findIssuer(text, lowerText) {
    for (const org of CERT_ORGS) {
      if (lowerText.indexOf(org.toLowerCase()) >= 0) return org;
    }
    for (const v of VENDOR_MATCHERS) {
      const m = v.re.exec(text);
      if (m) return m[1];
    }
    const cam = CAMERA_RE.exec(text);
    if (cam) return cam[1];
    return null;
  }

  function vendorOf(issuer) {
    if (!issuer) return null;
    const t = issuer.toLowerCase();
    if (/(google|gemini|imagen|veo|deepmind|nano.?banana)/.test(t)) return 'google';
    if (/(openai|chatgpt|gpt-image|dall)/.test(t)) return 'openai';
    if (/(adobe|firefly|photoshop|lightroom)/.test(t)) return 'adobe';
    if (/(microsoft|azure)/.test(t)) return 'microsoft';
    if (/anthropic/.test(t)) return 'anthropic';
    return null;
  }

  /* X.509 OIDs that mark an embedded signer certificate
   * (2.5.4.10 organizationName / 2.5.4.3 commonName). */
  function hasCert(stores) {
    for (const s of stores) {
      if (findPattern(s, [0x06, 0x03, 0x55, 0x04, 0x0a]) >= 0) return true;
      if (findPattern(s, [0x06, 0x03, 0x55, 0x04, 0x03]) >= 0) return true;
    }
    return false;
  }

  /* ============================================================
   * analyzeFile(buffer) — main detection entry.
   * Reads the four channels off the raw file bytes and returns a
   * deterministic result. Works in Worker / main thread / Node.
   * ============================================================ */

  function analyzeFile(buffer) {
    try {
      const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      if (!view || view.length < 16) return null;
      const fmt = sniffFormat(view);
      const ex = extractSignals(view, fmt);

      /* --- channel: c2pa (Content Credentials) --- */
      let storeText = '', storeLower = '';
      for (const s of ex.stores) storeText += latin1Text(s) + '\n';
      storeLower = storeText.toLowerCase();
      const c2pa = {
        found: ex.stores.length > 0,
        issuer: null,
        signed: false,
        aiSource: [],
      };
      let storeSynthid = false;
      if (c2pa.found) {
        c2pa.issuer = findIssuer(storeText, storeLower);
        c2pa.aiSource = aiSourceMarkers(storeLower);
        c2pa.signed = hasCert(ex.stores) || /c2pa\.signature/i.test(storeText);
        storeSynthid = SYNTHID_RE.test(storeText);
      }

      /* --- channel: metadata (EXIF / XMP / text chunks) --- */
      let metaText = '';
      for (const r of ex.meta) metaText += latin1Text(r) + '\n';
      const metaLower = metaText.toLowerCase();
      const metaMarkers = [];
      for (const m of aiSourceMarkers(metaLower)) metaMarkers.push('digitalSourceType: ' + m);
      const metaSynthid = SYNTHID_RE.test(metaText);
      if (metaSynthid) metaMarkers.push('SynthID mentioned');
      const gen = GENERATOR_RE.exec(metaText);
      if (gen) metaMarkers.push('generator named (' + gen[1] + ')');
      const metadata = { found: metaMarkers.length > 0, markers: metaMarkers };

      /* --- channel: synthid (watermark declarations) ---
       * Google signs its generated images with a credential that
       * declares an embedded SynthID watermark; OpenAI carries the
       * same dual signal since May 2026. Read the declaration. */
      const issuerVendor = vendorOf(c2pa.issuer);
      const synthid = { found: false, scope: null };
      if (storeSynthid) {
        synthid.found = true;
        synthid.scope = issuerVendor || 'credentials';
      } else if (metaSynthid) {
        synthid.found = true;
        synthid.scope = 'metadata';
      } else if (c2pa.found && (issuerVendor === 'google' || issuerVendor === 'openai') &&
                 c2pa.aiSource.indexOf('trainedAlgorithmicMedia') >= 0) {
        synthid.found = true;
        synthid.scope = issuerVendor;
      }

      /* --- channel: tamper (structural removal evidence) --- */
      const tamper = { found: ex.tamper.length > 0, signs: ex.tamper };

      /* --- deterministic verdict --- */
      const detected = synthid.found;
      const possible = !detected &&
        ((c2pa.found && c2pa.aiSource.length > 0) || metadata.found || tamper.found);
      const confidence = detected ? 1 : possible ? 0.5 : 0;

      let bestSet = 'none';
      if (detected) bestSet = storeSynthid ? 'c2pa' : (metaSynthid ? 'metadata' : 'c2pa');
      else if (possible) bestSet = (c2pa.found && c2pa.aiSource.length) ? 'c2pa'
        : metadata.found ? 'metadata' : 'tamper';

      /* --- signals read (what the file actually says) --- */
      const signals = [];
      if (storeSynthid) {
        signals.push({
          label: 'SynthID watermark declaration',
          where: 'C2PA Content Credentials' + (c2pa.issuer ? ' (' + c2pa.issuer + ')' : ''),
        });
      }
      if (metaSynthid) {
        signals.push({ label: 'SynthID mentioned', where: 'embedded metadata' });
      }
      if (detected && !storeSynthid && !metaSynthid) {
        signals.push({
          label: (synthid.scope === 'openai' ? 'OpenAI' : 'Google') +
            ' credential declares AI-generated media — SynthID watermark declared',
          where: 'C2PA Content Credentials',
        });
      }
      if (c2pa.found && c2pa.aiSource.length) {
        signals.push({
          label: 'AI-generated media declared (' + c2pa.aiSource.join(', ') + ')',
          where: 'C2PA Content Credentials' + (c2pa.issuer ? ' · ' + c2pa.issuer : ''),
        });
      } else if (c2pa.found) {
        signals.push({
          label: 'Content Credentials present' + (c2pa.issuer ? ' (' + c2pa.issuer + ')' : '') +
            (c2pa.signed ? ', signed' : ''),
          where: 'C2PA',
        });
      }
      for (const m of metadata.markers) {
        signals.push({ label: m.charAt(0).toUpperCase() + m.slice(1), where: 'embedded metadata' });
      }
      for (const s of tamper.signs) {
        signals.push({ label: 'Provenance appears removed: ' + s, where: 'file structure' });
      }

      const conclusion = (detected || possible || signals.length) ? 'signals_found' : 'nothing_found';

      return {
        detected: detected,
        possible: possible,
        confidence: confidence,
        bestSet: bestSet,
        signals: signals,
        channels: {
          c2pa: c2pa,
          synthid: synthid,
          metadata: metadata,
          tamper: tamper,
        },
        conclusion: conclusion,
        notChecked: ['synthid.google'],
      };
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
   * DISSOLUTION — REMOVAL (unchanged)
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
    /* detection — signal reading (synthiddetector.com method) */
    analyzeFile: analyzeFile,
    /* removal / dissolution (unchanged) */
    CARRIERS_DARK: CARRIERS_DARK,
    CARRIERS_WHITE: CARRIERS_WHITE,
    UNIVERSAL_1024: UNIVERSAL_1024,
    ANALYSIS_SIZE: ANALYSIS_SIZE,
    DISSOLVE: DISSOLVE,
    fft1d: fft1d,
    fft2d: fft2d,
    binIndex: binIndex,
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
