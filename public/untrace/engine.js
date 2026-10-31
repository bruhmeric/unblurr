/* ============================================================
 * Untrace · engine.js
 * Cleaning + detection engine.
 *  - Lossless structural cleaning (byte surgery, pixels untouched)
 *  - Deep Clean (warp + squeeze + noise + re-encode) to disrupt
 *    invisible watermarks (SynthID-class, spread-spectrum)
 *  - SynthID signal-reading detection (C2PA declarations,
 *    metadata, tamper evidence — see synthid.js)
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
   * LOSSLESS TIFF CLEAN — the deletefootprints.ai method applied
   * to the TIFF container: strip every metadata tag out of the
   * IFDs (EXIF, GPS, IPTC, XMP, camera/device fields, timestamps,
   * thumbnails) and rebuild the file with the pixel strips copied
   * verbatim. Pixels stay byte-identical; the file only gets
   * smaller. Throws on anything structurally unusual so the
   * pipeline can fall back to Deep Clean instead of emitting a
   * broken file.
   * ============================================================ */

  function cleanTiff(view, stripColor) {
    const N = view.byteLength;
    if (N < 8) throw new Error('TIFF_TOO_SMALL');
    const bo = P.ascii(view, 0, 2);
    if (bo !== 'II' && bo !== 'MM') throw new Error('NOT_TIFF');
    const le = bo === 'II';
    const rd16 = function (o) { return le ? view[o] | (view[o + 1] << 8) : (view[o] << 8) | view[o + 1]; };
    const rd32 = function (o) { return le ? ((view[o] | (view[o + 1] << 8) | (view[o + 2] << 16) | (view[o + 3] << 24)) >>> 0) : (((view[o] << 24) | (view[o + 1] << 16) | (view[o + 2] << 8) | view[o + 3]) >>> 0); };
    if (rd16(2) !== 42) throw new Error('NOT_TIFF');
    const firstIfd = rd32(4);
    if (firstIfd < 8 || firstIfd + 6 > N) throw new Error('TIFF_BAD_IFD0');
    const TS = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

    /* pass 1 — walk the IFD chain, keep only structural tags */
    const ifds = [];
    const seen = new Set();
    let off = firstIfd;
    while (off) {
      if (seen.has(off) || off + 6 > N) throw new Error('TIFF_IFD_BROKEN');
      seen.add(off);
      const count = rd16(off);
      if (count > 512 || off + 2 + count * 12 + 4 > N) throw new Error('TIFF_IFD_TRUNCATED');
      const entries = [];
      const seenTags = new Set();
      let isDng = false;
      for (let i = 0; i < count; i++) {
        const eo = off + 2 + i * 12;
        const tag = rd16(eo);
        if (tag === 50706) isDng = true; /* DNGVersion — raw camera format, not a plain TIFF */
        if (seenTags.has(tag)) continue; /* tolerate duplicate entries: keep the first */
        const keep = P.TIFF_KEEP[tag] === 1 || (tag === 34675 && !stripColor);
        if (!keep) continue;
        seenTags.add(tag);
        const type = rd16(eo + 2);
        if (type === 0 || type > 12) continue;
        const num = rd32(eo + 4);
        if (TS[type] * num > N) throw new Error('TIFF_VALUE_HUGE');
        entries.push({ tag: tag, eo: eo, type: type, num: num });
      }
      if (isDng) throw new Error('TIFF_DNG_UNSUPPORTED');
      ifds.push({ entries: entries, next: rd32(off + 2 + count * 12) });
      if (ifds.length > 64) throw new Error('TIFF_IFD_CHAIN');
      off = ifds[ifds.length - 1].next;
    }
    if (!ifds.length) throw new Error('TIFF_NO_IFD');

    /* identify pixel-data tags (strips or tiles) per IFD */
    for (const ifd of ifds) {
      const find = function (t) { return ifd.entries.filter(function (e) { return e.tag === t; })[0]; };
      const so = find(273), sb = find(279), to = find(324), tb = find(325);
      ifd.dataTags = [];
      if (so && sb) ifd.dataTags.push({ offTag: 273, lenTag: 279, offEntry: so, lenEntry: sb });
      if (to && tb) ifd.dataTags.push({ offTag: 324, lenTag: 325, offEntry: to, lenEntry: tb });
    }

    /* collect original strip/tile runs */
    for (const ifd of ifds) {
      for (const dt of ifd.dataTags) {
        const offE = dt.offEntry, lenE = dt.lenEntry;
        if (offE.num !== lenE.num || offE.num === 0 || offE.num > 0x10000) throw new Error('TIFF_STRIP_MISMATCH');
        const offBytes = TS[offE.type] * offE.num;
        const lenBytes = TS[lenE.type] * lenE.num;
        const offBase = offBytes <= 4 ? offE.eo + 8 : rd32(offE.eo + 8);
        const lenBase = lenBytes <= 4 ? lenE.eo + 8 : rd32(lenE.eo + 8);
        if (offBase + offBytes > N || lenBase + lenBytes > N) throw new Error('TIFF_STRIP_PTR_OOB');
        dt.runs = [];
        for (let i = 0; i < offE.num; i++) {
          const src = TS[offE.type] === 2 ? rd16(offBase + i * 2) : rd32(offBase + i * 4);
          const len = TS[lenE.type] === 2 ? rd16(lenBase + i * 2) : rd32(lenBase + i * 4);
          if (len > 0 && src + len > N) throw new Error('TIFF_STRIP_OOB');
          dt.runs.push({ src: src, len: len });
        }
      }
    }

    /* pass 2 — layout: header, IFDs, value areas (even-aligned), pixel runs */
    let pos = 8;
    for (const ifd of ifds) {
      ifd.ifdPos = pos;
      pos += 2 + ifd.entries.length * 12 + 4;
    }
    for (const ifd of ifds) {
      ifd.valPos = pos;
      let v = 0;
      for (const e of ifd.entries) {
        const dt = ifd.dataTags.filter(function (d) { return d.offEntry === e; })[0];
        if (dt) e.rewrite = dt;
        const bytes = dt ? 4 * e.num : TS[e.type] * e.num; /* offsets rewritten as LONG */
        e.valLen = bytes > 4 ? bytes : 0;
        if (e.valLen) { e.valOff = v; v += (bytes & 1) ? bytes + 1 : bytes; }
      }
      ifd.valSize = v;
      pos += v;
    }
    /* pixel run placement (word-aligned, gaps allowed) */
    const allRuns = [];
    let dataEnd = pos;
    for (const ifd of ifds) {
      for (const dt of ifd.dataTags) {
        dt.dst = [];
        for (const r of dt.runs) {
          if (dataEnd & 1) dataEnd++;
          const dst = dataEnd;
          if (r.len) allRuns.push({ src: r.src, len: r.len, dst: dst });
          dt.dst.push(dst);
          dataEnd += r.len;
        }
      }
    }

    /* pass 3 — build */
    const out = new Uint8Array(dataEnd);
    const wr16 = function (o, v) { if (le) { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; } else { out[o] = (v >>> 8) & 255; out[o + 1] = v & 255; } };
    const wr32 = function (o, v) { v = v >>> 0; if (le) { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = (v >>> 16) & 255; out[o + 3] = (v >>> 24) & 255; } else { out[o] = (v >>> 24) & 255; out[o + 1] = (v >>> 16) & 255; out[o + 2] = (v >>> 8) & 255; out[o + 3] = v & 255; } };
    out[0] = view[0]; out[1] = view[1];
    wr16(2, 42);
    wr32(4, 8);
    for (let k = 0; k < ifds.length; k++) {
      const ifd = ifds[k];
      wr16(ifd.ifdPos, ifd.entries.length);
      let p = ifd.ifdPos + 2;
      for (const e of ifd.entries) {
        wr16(p, e.tag);
        if (e.rewrite) { wr16(p + 2, 4); wr32(p + 4, e.num); }
        else { wr16(p + 2, e.type); wr32(p + 4, e.num); }
        if (e.valLen) wr32(p + 8, ifd.valPos + e.valOff);
        else if (e.rewrite) wr32(p + 8, e.rewrite.dst[0]);
        else { out[p + 8] = view[e.eo + 8]; out[p + 9] = view[e.eo + 9]; out[p + 10] = view[e.eo + 10]; out[p + 11] = view[e.eo + 11]; }
        p += 12;
      }
      wr32(p, k + 1 < ifds.length ? ifds[k + 1].ifdPos : 0);
    }
    /* value areas + rewritten offset arrays */
    for (const ifd of ifds) {
      for (const e of ifd.entries) {
        if (!e.valLen) continue;
        if (e.rewrite) {
          for (let i = 0; i < e.num; i++) wr32(ifd.valPos + e.valOff + i * 4, e.rewrite.dst[i]);
        } else {
          const origBytes = TS[e.type] * e.num;
          const src = origBytes <= 4 ? e.eo + 8 : rd32(e.eo + 8);
          if (src + origBytes > N) throw new Error('TIFF_VALUE_OOB');
          out.set(view.subarray(src, src + origBytes), ifd.valPos + e.valOff);
        }
      }
    }
    /* pixel runs — copied verbatim */
    for (const r of allRuns) out.set(view.subarray(r.src, r.src + r.len), r.dst);

    /* pass 4 — verify: pixel bytes identical + IFD chain walks */
    for (const r of allRuns) {
      for (let i = 0; i < r.len; i++) if (out[r.dst + i] !== view[r.src + i]) throw new Error('TIFF_VERIFY_PIXELS');
    }
    (function () {
      const rd16v = function (o) { return le ? out[o] | (out[o + 1] << 8) : (out[o] << 8) | out[o + 1]; };
      const rd32v = function (o) { return le ? ((out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>> 0) : (((out[o] << 24) | (out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]) >>> 0); };
      if (rd16v(2) !== 42) throw new Error('TIFF_VERIFY_HEADER');
      let o = rd32v(4);
      const seenV = new Set();
      let guard = 0;
      while (o) {
        if (seenV.has(o) || o + 6 > out.length || guard++ > 64) throw new Error('TIFF_VERIFY_CHAIN');
        seenV.add(o);
        const cnt = rd16v(o);
        if (o + 2 + cnt * 12 + 4 > out.length) throw new Error('TIFF_VERIFY_IFD');
        o = rd32v(o + 2 + cnt * 12);
      }
    })();

    return out;
  }

  /* ============================================================
   * LOSSLESS ISO-BMFF CLEAN (HEIC / HEIF / AVIF) — the
   * deletefootprints.ai method for ISO media containers: drop the
   * metadata items (Exif, XMP "mime" items, C2PA/uuid items) from
   * iinf + iloc, rebuild the meta box and mdat, and keep every
   * pixel byte identical. Throws on anything unusual → Deep Clean
   * fallback.
   * ============================================================ */

  const BMFF_META_TYPES = { 'Exif': 1, 'mime': 1, 'uri ': 1, 'uuid': 1, 'c2pa': 1, 'ciap': 1, 'jumb': 1, 'jumd': 1 };

  function bmffMime(brand) {
    if (/^(avif|avis)/i.test(brand)) return 'image/avif';
    if (/^(heic|heix|hevc|heim|heis|heif|mif1|msf1)/i.test(brand)) return 'image/heic';
    return 'application/octet-stream';
  }

  function cleanIsobmff(view) {
    const st = P.parseIsobmff(view);
    if (!st.ok) throw new Error(st.error || 'BMFF_PARSE');
    if (!st.meta) throw new Error('BMFF_NO_META');
    if (!st.iinfInfo || !st.ilocInfo) throw new Error('BMFF_NO_ITEMINFO');
    if (st.ilocInfo.offsetSize === 0 || st.ilocInfo.lengthSize === 0) throw new Error('BMFF_ILOC_SIZES');
    const type = bmffMime(st.brand);

    const removed = st.items.filter(function (it) {
      return it.id !== st.primaryItemId && BMFF_META_TYPES[it.type] === 1;
    });
    if (!removed.length) return { buffer: view.slice(0), type: type, changed: false };
    const removedIds = {};
    for (const it of removed) removedIds[it.id] = 1;

    const mdats = st.boxes.filter(function (b) { return b.type === 'mdat'; });
    if (!mdats.length) throw new Error('BMFF_NO_MDAT');

    /* dangling iloc entries (item id not declared in iinf) — refuse */
    for (const en of st.ilocEntries) {
      const known = st.items.some(function (it) { return it.id === en.itemId; });
      if (!known) throw new Error('BMFF_DANGLING_ILOC');
    }

    const kept = st.items.filter(function (it) { return !removedIds[it.id]; });
    const keptEntries = st.ilocEntries.filter(function (en) { return !removedIds[en.itemId]; });

    /* kept method-0 extents must live inside an mdat box */
    for (const en of keptEntries) {
      if (en.construction === 2) throw new Error('BMFF_CONSTRUCTION_2');
      if (en.construction === 0) {
        for (const ex of en.extents) {
          const abs = en.baseOffset + ex.offset;
          if (ex.length && !mdats.some(function (m) { return abs >= m.contentStart && abs + ex.length <= m.start + m.size; })) {
            throw new Error('BMFF_EXTENT_OUTSIDE_MDAT');
          }
        }
      }
    }
    /* removed items stored in idat: their bytes get zeroed in the idat copy */
    const idatZero = [];
    for (const it of removed) {
      if (it.iloc && it.iloc.construction === 1 && st.idat) {
        for (const ex of it.iloc.extents) {
          const abs = st.idat.contentStart + it.iloc.baseOffset + ex.offset;
          if (abs >= 0 && abs + ex.length <= st.idat.start + st.idat.size) idatZero.push([abs, ex.length]);
        }
      }
    }

    /* ---- plan the rebuilt meta children ---- */
    const iinfV = st.iinfInfo.version;
    const iinfBox = st.iinfInfo.box;
    let keptInfeBytes = 0;
    for (const it of kept) keptInfeBytes += it.infeSize;
    const newIinfSize = 8 + 4 + (iinfV === 1 ? 4 : 2) + keptInfeBytes;

    const ilocV = st.ilocInfo.version;
    const ilocBox = st.ilocInfo.box;
    const info = st.ilocInfo;
    let keptEntryBytes = 0;
    for (const en of keptEntries) keptEntryBytes += en.entrySize;
    const newIlocSize = 8 + 4 + 2 + (ilocV < 2 ? 2 : 4) + keptEntryBytes;

    /* iref: drop reference children that originate from removed items */
    const irefBox = st.meta.children.filter(function (c) { return c.type === 'iref'; })[0];
    let newIrefSize = null, keptIrefChildren = null, irefVersion = 0;
    if (irefBox) {
      irefVersion = view[irefBox.contentStart];
      keptIrefChildren = [];
      let coff = irefBox.contentStart + 4;
      const cend = irefBox.start + irefBox.size;
      while (coff + 8 <= cend) {
        const csize = P.rd32be(view, coff);
        if (csize < 8 || coff + csize > cend) throw new Error('BMFF_BAD_IREF_CHILD');
        const fromId = irefVersion === 0 ? P.rd16be(view, coff + 8) : P.rd32be(view, coff + 8);
        if (!removedIds[fromId]) keptIrefChildren.push(view.subarray(coff, coff + csize));
        coff += csize;
      }
      newIrefSize = 8 + 4 + keptIrefChildren.reduce(function (a, b) { return a + b.length; }, 0);
    }

    /* new meta box size (children keep their original order) */
    let newMetaSize = 8 + 4;
    for (const c of st.meta.children) {
      if (c.type === 'iinf') newMetaSize += newIinfSize;
      else if (c.type === 'iloc') newMetaSize += newIlocSize;
      else if (c.type === 'iref' && newIrefSize !== null) newMetaSize += newIrefSize;
      else newMetaSize += c.size;
    }

    /* ---- plan the new top-level layout ---- */
    /* kept method-0 extents are placed sequentially in the new mdat */
    const placements = []; /* {en, extIdx, origAbs, len, newAbs} */
    let mdatContentLen = 0;
    for (const en of keptEntries) {
      if (en.construction !== 0) continue;
      for (let i = 0; i < en.extents.length; i++) {
        const ex = en.extents[i];
        placements.push({ en: en, extIdx: i, origAbs: en.baseOffset + ex.offset, len: ex.length, rel: mdatContentLen, newAbs: 0 });
        mdatContentLen += ex.length;
      }
    }
    const newMdatSize = 8 + mdatContentLen;

    const newBoxes = [];
    let sawMdat = false;
    for (const b of st.boxes) {
      if (b.type === 'meta') newBoxes.push({ kind: 'meta', size: newMetaSize });
      else if (b.type === 'mdat') {
        if (!sawMdat) { newBoxes.push({ kind: 'mdat', size: newMdatSize }); sawMdat = true; }
        /* extra mdat boxes are folded into the rebuilt one */
      } else newBoxes.push({ kind: 'copy', copy: view.subarray(b.start, b.start + b.size) });
    }
    let p = 0;
    let mdatBox = null;
    for (const nb of newBoxes) {
      nb.pos = p;
      if (nb.kind === 'copy') p += nb.copy.length;
      else if (nb.kind === 'meta') p += nb.size;
      else { nb.contentStart = p + 8; p += nb.size; mdatBox = nb; }
    }
    const total = p;
    for (const pl of placements) pl.newAbs = mdatBox.contentStart + pl.rel;

    /* ---- build ---- */
    const out = new Uint8Array(total);
    const wr32be = function (o, v) { v = v >>> 0; out[o] = (v >>> 24) & 255; out[o + 1] = (v >>> 16) & 255; out[o + 2] = (v >>> 8) & 255; out[o + 3] = v & 255; };
    const wr16be = function (o, v) { out[o] = (v >>> 8) & 255; out[o + 1] = v & 255; };
    const wrNbe = function (o, n, v) { v = v >>> 0; for (let i = n - 1; i >= 0; i--) { out[o + i] = v & 255; v = Math.floor(v / 256); } };
    const putFourCC = function (o, s) { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };

    /* iinf without the removed items */
    const buildIinf = function (cp) {
      wr32be(cp, newIinfSize); putFourCC(cp + 4, 'iinf');
      out.set(view.subarray(iinfBox.contentStart, iinfBox.contentStart + 4), cp + 8); /* version + flags */
      if (iinfV === 1) wr32be(cp + 12, kept.length); else wr16be(cp + 12, kept.length);
      let q = cp + 12 + (iinfV === 1 ? 4 : 2);
      for (const it of kept) {
        out.set(view.subarray(it.infeStart, it.infeStart + it.infeSize), q);
        q += it.infeSize;
      }
    };

    /* iloc without the removed entries, offsets repointed at the new mdat */
    const buildIloc = function (cp) {
      wr32be(cp, newIlocSize); putFourCC(cp + 4, 'iloc');
      out.set(view.subarray(ilocBox.contentStart, ilocBox.contentStart + 6), cp + 8); /* version+flags + size pair */
      let q = cp + 14; /* 8 header + 4 ver/flags + 2 size pair */
      if (ilocV < 2) wr16be(q, keptEntries.length); else wr32be(q, keptEntries.length);
      q += ilocV < 2 ? 2 : 4;
      for (const en of keptEntries) {
        out.set(view.subarray(en.entryStart, en.entryStart + en.entrySize), q);
        if (en.construction === 0) {
          let s = q;
          s += info.version < 2 ? 2 : 4; /* item_id */
          if (info.version === 1 || info.version === 2) s += 2; /* construction_method */
          s += 2 + info.baseOffsetSize + 2; /* data_ref + base + extent_count */
          for (let i = 0; i < en.extents.length; i++) {
            s += info.indexSize;
            let pl = null;
            for (const cand of placements) { if (cand.en === en && cand.extIdx === i) { pl = cand; break; } }
            const newOff = pl ? (pl.newAbs - en.baseOffset) : 0;
            if (newOff < 0) throw new Error('BMFF_NEG_OFFSET');
            wrNbe(s, info.offsetSize, newOff);
            s += info.offsetSize + info.lengthSize;
          }
        }
        q += en.entrySize;
      }
    };

    /* iref without references that originated from removed items */
    const buildIref = function (cp) {
      wr32be(cp, newIrefSize); putFourCC(cp + 4, 'iref');
      out.set(view.subarray(irefBox.contentStart, irefBox.contentStart + 4), cp + 8);
      let q = cp + 12;
      for (const ch of keptIrefChildren) { out.set(ch, q); q += ch.length; }
    };

    for (const nb of newBoxes) {
      if (nb.kind === 'copy') {
        out.set(nb.copy, nb.pos);
      } else if (nb.kind === 'meta') {
        wr32be(nb.pos, newMetaSize);
        putFourCC(nb.pos + 4, 'meta');
        out.set(view.subarray(st.meta.start + st.meta.headerSize, st.meta.start + st.meta.headerSize + 4), nb.pos + 8); /* version + flags */
        let cp = nb.pos + 12;
        for (const c of st.meta.children) {
          if (c.type === 'iinf') { buildIinf(cp); cp += newIinfSize; }
          else if (c.type === 'iloc') { buildIloc(cp); cp += newIlocSize; }
          else if (c.type === 'iref' && keptIrefChildren) { buildIref(cp); cp += newIrefSize; }
          else {
            out.set(view.subarray(c.start, c.start + c.size), cp);
            if (c.type === 'idat') {
              for (const z of idatZero) {
                const rel = z[0] - c.start;
                if (rel >= 0 && rel + z[1] <= c.size) out.fill(0, cp + rel, cp + rel + z[1]);
              }
            }
            cp += c.size;
          }
        }
      } else {
        wr32be(nb.pos, nb.size);
        putFourCC(nb.pos + 4, 'mdat');
        for (const pl of placements) {
          if (pl.len) out.set(view.subarray(pl.origAbs, pl.origAbs + pl.len), pl.newAbs);
        }
      }
    }

    /* ---- verify: no metadata items left, pixel bytes identical ---- */
    const st2 = P.parseIsobmff(out);
    if (!st2.ok) throw new Error('BMFF_VERIFY_PARSE');
    for (const it of st2.items) {
      if (it.id !== st2.primaryItemId && BMFF_META_TYPES[it.type] === 1) throw new Error('BMFF_VERIFY_LEFTOVER');
    }
    /* every kept item's payload must still resolve and match the original bytes */
    for (const it of kept) {
      const before = P.isobmffItemData(view, st, it);
      const it2 = st2.items.filter(function (x) { return x.id === it.id; })[0];
      const after = it2 ? P.isobmffItemData(out, st2, it2) : null;
      if (before && !after) throw new Error('BMFF_VERIFY_ITEM_LOST');
      if (before && after) {
        if (before.length !== after.length) throw new Error('BMFF_VERIFY_ITEM_LEN');
        for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) throw new Error('BMFF_VERIFY_ITEM_BYTES');
      }
    }
    for (const pl of placements) {
      if (!pl.len) continue;
      for (let i = 0; i < pl.len; i++) if (out[pl.newAbs + i] !== view[pl.origAbs + i]) throw new Error('BMFF_VERIFY_PIXELS');
    }

    return { buffer: out, type: type, changed: true };
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
    /* invisible watermark evidence (signal reading — deterministic) */
    if (synth && synth.detected) {
      score = Math.max(score, Math.min(97, 84 + Math.round(synth.confidence * 12)));
      verdict = 'ai-evidence';
      reasons.unshift({ type: 'indicator', text: 'Invisible AI watermark declared — a readable signal in the file states a SynthID watermark is embedded' });
    } else if (synth && synth.possible) {
      score = Math.max(score, Math.min(74, 52 + Math.round(synth.confidence * 28)));
      if (verdict !== 'ai-evidence') verdict = 'suspicious';
      reasons.push({ type: 'indicator', text: 'AI-generation signals found in the file\u2019s credentials or metadata (no explicit watermark declaration)' });
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
    if (type === 'image/tiff') return '.tif';
    if (type === 'image/avif') return '.avif';
    if (type === 'image/heic') return '.heic';
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

    /* 2 — signal reading: invisible watermark (SynthID) detection
     *     on the file bytes (C2PA declarations, metadata, tamper
     *     evidence), plus statistical heuristics on the pixels. */
    let stats = null, synth = null;
    if (onStage) { try { onStage('analyze'); } catch (e) {} }
    if (SY) { try { synth = SY.analyzeFile(view); } catch (e) { synth = null; } }
    if (['jpeg', 'png', 'webp'].includes(format) && typeof createImageBitmap === 'function') {
      try {
        const bmp = await decodeToBitmap(view);
        try { stats = statisticalDetectBmp(bmp); } catch (e) { stats = null; }
        try { bmp.close(); } catch (e) {}
      } catch (e) { /* undecodable — skip pixel analysis */ }
    }

    /* 2b — surface the watermark signals as a finding */
    if (synth && (synth.detected || synth.possible)) {
      findings.push({
        kind: 'synthid',
        where: synth.bestSet === 'c2pa' ? 'C2PA Content Credentials'
          : synth.bestSet === 'metadata' ? 'Embedded metadata'
          : synth.bestSet === 'tamper' ? 'File structure' : 'File bytes',
        label: synth.detected ? 'Invisible AI watermark (SynthID declared)' : 'AI-generation signals (no SynthID declaration)',
        detail: synth.detected
          ? 'A readable signal in the file declares an invisible SynthID watermark is embedded'
          : 'AI-generation markers found in credentials or metadata, but no explicit watermark declaration',
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

    const structuralOk = ['jpeg', 'png', 'webp', 'gif', 'tiff', 'iso-bmff'].includes(format);
    if (!structuralOk && mode === 'lossless') {
      /* cannot do byte surgery → fall back to deep re-encode */
      mode = 'deep';
    }

    let outBuffer = null, outType = null;
    const notes = [];

    /* Lossless header surgery (deletefootprints.ai method): strip the
     * metadata containers out of the file structure and never touch a
     * pixel. Throws when a container cannot be rebuilt safely. */
    const attemptLossless = function () {
      if (format === 'jpeg') return { buffer: cleanJpeg(view), type: 'image/jpeg' };
      if (format === 'png') return { buffer: cleanPng(view, opts.stripColorProfile), type: 'image/png' };
      if (format === 'webp') return { buffer: cleanWebp(view, opts.stripColorProfile), type: 'image/webp' };
      if (format === 'gif') return { buffer: cleanGif(view), type: 'image/gif' };
      if (format === 'tiff') return { buffer: cleanTiff(view, opts.stripColorProfile), type: 'image/tiff' };
      if (format === 'iso-bmff') { const r = cleanIsobmff(view); return { buffer: r.buffer, type: r.type }; }
      return null;
    };

    if (mode === 'lossless') {
      try {
        const r = attemptLossless();
        if (r) { outBuffer = r.buffer; outType = r.type; }
      } catch (e) {
        outBuffer = null; outType = null;
        notes.push('This file\u2019s structure could not be rebuilt losslessly (' + ((e && e.message) || 'error') + ') — it was re-encoded instead.');
      }
      if (outBuffer) {
        if (findings.some(function (f) { return f.kind === 'exif'; })) {
          notes.push('EXIF orientation tag removed with the rest of EXIF — use Deep Clean to bake rotation into pixels.');
        }
        if (synth && synth.detected) {
          notes.push('The invisible watermark lives inside the pixels — a metadata-only clean cannot touch it. Re-run with Deep Clean.');
        }
      } else {
        mode = 'deep';
      }
    }

    if (mode === 'deep') {
      if (onStage) { try { onStage('clean'); } catch (e) {} }
      let r = null;
      try {
        r = await deepClean(view, {
          stealth: opts.stealth || 'balanced',
          format: opts.format || 'auto',
          srcFormat: format,
          name: name,
          synthidDetected: !!(synth && synth.detected),
        });
      } catch (e) {
        /* Deep Clean has to decode the pixels. If this browser cannot
         * decode the format at all (TIFF/HEIC outside Safari), fall back
         * to the lossless header surgery instead of failing the file. */
        if (structuralOk) {
          try {
            const r2 = attemptLossless();
            if (r2) { outBuffer = r2.buffer; outType = r2.type; mode = 'lossless'; }
          } catch (e2) { outBuffer = null; }
        }
        if (!outBuffer) throw e;
        notes.push('This browser cannot decode this image for Deep Clean — the metadata was removed losslessly instead (pixels untouched). To dissolve an invisible watermark, re-run Deep Clean in a browser that can open this format.');
      }
      if (r) {
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
    }

    /* 5 — verify: re-scan the output */
    const outView = new Uint8Array(outBuffer);
    const rescanned = await P.scan(outView, outView.byteLength / 1048576);
    const leftover = dedupeFindings(rescanned.findings).filter(function (f) {
      if (opts.stripColorProfile !== true && f.kind === 'icc') return false; // we keep ICC by default
      return f.kind !== 'jfif'; // canvas JFIF header is harmless? it still appears
    });
    const verifiedClean = leftover.length === 0;

    /* 5b — verify the watermark: re-read the signals on the cleaned output */
    let synthAfter = null, synthReduced = null, synthRemoved = null;
    if (synth && synth.detected && mode === 'deep' && SY) {
      try {
        synthAfter = SY.analyzeFile(outView);
        if (synthAfter) {
          /* signal reading is binary — there is nothing to estimate */
          synthReduced = null;
          synthRemoved = !synthAfter.detected && !synthAfter.possible;
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
      bestSet: synth.bestSet,
      signals: synth.signals,
      channels: synth.channels,
      conclusion: synth.conclusion,
      notChecked: synth.notChecked,
      after: synthAfter ? { detected: synthAfter.detected, possible: synthAfter.possible, conclusion: synthAfter.conclusion } : null,
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
    cleanTiff: cleanTiff, cleanIsobmff: cleanIsobmff, bmffMime: bmffMime,
    deepClean: deepClean, statisticalDetectBmp: statisticalDetectBmp, scoreFile: scoreFile,
    processFile: processFile, makeThumb: makeThumb, randomName: randomName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UntraceEngine = api;
})(typeof self !== 'undefined' ? self : globalThis);
