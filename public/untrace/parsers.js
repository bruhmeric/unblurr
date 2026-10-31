/* ============================================================
 * Untrace · parsers.js
 * Structure-aware parsers for JPEG / PNG / WebP / GIF containers
 * plus EXIF (TIFF IFD) and XMP readers.
 * Pure ArrayBuffer logic — no browser APIs (except optional
 * DecompressionStream for zTXt, guarded).
 * ============================================================ */
(function (root) {
  'use strict';

  /* In a worker, importScripts() exposes UntraceSignatures on the global.
   * In Node tests, the harness sets globalThis.UntraceSignatures first. */
  const SIG = root.UntraceSignatures;

  /* ---------- small helpers ---------- */

  function ascii(view, off, len) {
    let s = '';
    const end = Math.min(off + len, view.byteLength);
    for (let i = off; i < end; i++) {
      s += String.fromCharCode(view[i]);
    }
    return s;
  }

  function utf8(u8) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(u8); }
    catch (e) { return ascii(u8, 0, u8.length); }
  }

  function clip(s, n) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (s.length > n) return s.slice(0, n) + '…';
    return s;
  }

  function containsBytes(view, needleAscii, from, to) {
    const n = needleAscii.length;
    const end = (to === undefined ? view.byteLength : to) - n;
    for (let i = from || 0; i <= end; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) {
        if (view[i + j] !== needleAscii.charCodeAt(j)) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  /* ---------- format sniffing ---------- */

  function detectFormat(view) {
    if (view.byteLength < 12) return 'unknown';
    if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return 'jpeg';
    if (view[0] === 0x89 && ascii(view, 1, 3) === 'PNG' && view[4] === 0x0d && view[5] === 0x0a) return 'png';
    if (ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 4) === 'WEBP') return 'webp';
    if (ascii(view, 0, 3) === 'GIF') return 'gif';
    if (view[0] === 0x42 && view[1] === 0x4d) return 'bmp';
    if ((view[0] === 0x49 && view[1] === 0x49 && view[2] === 0x2a) || (view[0] === 0x4d && view[1] === 0x4d)) return 'tiff';
    if (view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) return 'iso-bmff';
    if (view[0] === 0x00 && view[1] === 0x00 && view[2] === 0x01 && view[3] === 0x00) return 'ico';
    return 'unknown';
  }

  /* ---------- EXIF / TIFF IFD ---------- */

  /* Humanize EXIF dates ("2026:10:31 10:00:00" → "Oct 31, 2026, 10:00"). */
  function prettyDate(v) {
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v || '');
    if (!m) return v;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mo = months[+m[2] - 1] || m[2];
    return `${mo} ${+m[3]}, ${m[1]}, ${m[4]}:${m[5]}`;
  }

  /* Friendly one-line summary of EXIF fields for the UI. */
  function coord2(v) { const n = +v; return isFinite(n) ? n.toFixed(2) : v; }
  function exifSummary(fields) {
    const get = function (l) { const f = fields.filter(function (x) { return x.label === l; })[0]; return f ? f.value : ''; };
    return fields
      .filter(function (f) { return !/ref$/i.test(f.label); })
      .slice(0, 6)
      .map(function (f) {
        if (f.label === 'GPS latitude') return 'GPS latitude: ' + coord2(f.value) + '° ' + get('GPS latitude ref');
        if (f.label === 'GPS longitude') return 'GPS longitude: ' + coord2(f.value) + '° ' + get('GPS longitude ref');
        return f.label + (f.value ? ': ' + f.value : '');
      })
      .join(' · ');
  }

  function parseTiff(view, tiffStart) {
    const out = { fields: [], gps: false, hasExif: false };
    try {
      const bo = ascii(view, tiffStart, 2);
      const le = bo === 'II';
      const rd16 = (o) => le ? view[o] | (view[o + 1] << 8) : (view[o] << 8) | view[o + 1];
      const rd32 = (o) => le
        ? (view[o] | (view[o + 1] << 8) | (view[o + 2] << 16) | (view[o + 3] << 24)) >>> 0
        : ((view[o] << 24) | (view[o + 1] << 16) | (view[o + 2] << 8) | view[o + 3]) >>> 0;
      if (rd16(tiffStart + 2) !== 42) return out;
      const ifd0Off = tiffStart + rd32(tiffStart + 4);
      const typeSize = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
      const seen = new Set();

      function readIfd(off, ifdName, depth) {
        if (depth > 4 || off <= tiffStart || off + 2 > view.byteLength) return;
        if (seen.has(off)) return;
        seen.add(off);
        const count = rd16(off);
        if (count > 512) return;
        for (let i = 0; i < count; i++) {
          const eo = off + 2 + i * 12;
          if (eo + 12 > view.byteLength) return;
          const tag = rd16(eo);
          const type = rd16(eo + 2);
          const num = rd32(eo + 4);
          if (type === 0 || type > 12 || num > 0x10000) continue;
          const bytes = typeSize[type] * num;
          const vo = bytes <= 4 ? eo + 8 : tiffStart + rd32(eo + 8);
          let value = '';
          if (type === 2) { value = utf8(view.subarray(vo, vo + num)).replace(/\0+$/, ''); }
          else if ((type === 3 || type === 4 || type === 1) && num === 1) { value = type === 3 ? String(rd16(vo)) : String(type === 1 ? view[vo] : rd32(vo)); }
          else if (type === 5 || type === 10) {
            const a = rd32(vo), b = rd32(vo + 4);
            if (b !== 0) value = (a / b).toFixed(6);
          }
          const label = SIG.EXIF_LABELS[tag];
          /* 0x8769/0x8825 are internal pointers, not user-facing data */
          if (label && tag !== 0x8769 && tag !== 0x8825) {
            const isGps = (ifdName === 'GPS' || (tag >= 0x0001 && tag <= 0x001f && ifdName === 'GPS'));
            out.fields.push({ tag, ifd: ifdName, label, value: clip(prettyDate(value), 90) });
            if (ifdName === 'GPS') out.gps = true;
          }
          if (tag === 0x8769 && num >= 1) readIfd(tiffStart + rd32(eo + 8), 'Exif', depth + 1);
          if (tag === 0x8825 && num >= 1) readIfd(tiffStart + rd32(eo + 8), 'GPS', depth + 1);
          if (tag === 0x014a && depth < 2) { /* sub-IFDs — thumbnails, skip deep walk */ }
        }
      }
      readIfd(ifd0Off, 'IFD0', 0);
      out.hasExif = out.fields.length > 0;
    } catch (e) { /* malformed — ignore */ }
    return out;
  }

  /* ---------- XMP ---------- */

  function parseXmp(text) {
    const out = { present: false, creatorTool: '', software: '', digitalSource: '', hits: [] };
    if (!text || !/<x:xmpmeta|<\?xpacket|xmlns:x=/i.test(text)) return out;
    out.present = true;
    const grab = (re) => {
      const m = text.match(re);
      return m ? m[1] : '';
    };
    out.creatorTool = clip(grab(/xmp:CreatorTool\s*=\s*"([^"]{0,120})"/) || grab(/<xmp:CreatorTool[^>]*>([^<]{0,120})</), 90);
    out.software = clip(grab(/xmpDM:?(?:software|creatorTool)\s*=\s*"([^"]{0,120})"/i) || grab(/photoshop:Credit\s*=\s*"([^"]{0,120})"/), 90);
    const ds = text.match(/digitalSourceType\s*=\s*"([^"]{0,200})"/i) || text.match(/<digitalSourceType[^>]*>([^<]{0,200})</i);
    if (ds) out.digitalSource = clip(ds[1], 90);
    return out;
  }

  /* ============================================================
   * JPEG — segment walk
   * ============================================================ */

  function parseJpeg(view) {
    const res = { format: 'jpeg', segments: [], findings: [], scanStart: -1, eoi: -1, trailing: 0 };
    let off = 2; // after SOI
    const N = view.byteLength;
    while (off < N - 1) {
      if (view[off] !== 0xff) { off++; continue; }
      const marker = view[off + 1];
      if (marker === 0xd9) { res.eoi = off; break; } // EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; } // standalone
      if (off + 4 > N) break;
      const len = (view[off + 2] << 8) | view[off + 3];
      const segStart = off;
      const dataStart = off + 4;
      const seg = { marker, start: segStart, length: len + 2, dataStart, dataLen: len - 2 };
      if (len < 2 || dataStart + seg.dataLen > N) { res.segments.push(seg); break; }

      if (marker === 0xda) { // SOS — scan data follows
        res.scanStart = dataStart + seg.dataLen;
        res.segments.push(seg);
        break;
      }
      res.segments.push(seg);
      off = dataStart + seg.dataLen;
    }

    /* walk scan data to find real EOI (0xFFD9 not escaped) */
    if (res.scanStart >= 0) {
      let p = res.scanStart;
      while (p < N - 1) {
        if (view[p] === 0xff) {
          const nxt = view[p + 1];
          if (nxt === 0x00) { p += 2; continue; }
          if (nxt >= 0xd0 && nxt <= 0xd7) { p += 2; continue; }
          if (nxt === 0xd9) { res.eoi = p; break; }
          if (nxt === 0xff) { p += 1; continue; }
          p += 2; continue;
        }
        p++;
      }
      if (res.eoi < 0) res.eoi = N; // tolerate truncated
      if (res.eoi + 2 < N) res.trailing = N - (res.eoi + 2);
    }

    /* classify segments into findings */
    for (const seg of res.segments) {
      const m = seg.marker;
      const data = view.subarray(seg.dataStart, seg.dataStart + Math.min(seg.dataLen, 70000));
      const text = utf8(data);
      if (m >= 0xe0 && m <= 0xef) { // APPn
        const id = ascii(view, seg.dataStart, Math.min(20, seg.dataLen));
        if (m === 0xe1 && /^Exif\0\0/.test(ascii(view, seg.dataStart, 6))) {
          const tiff = parseTiff(view, seg.dataStart + 6);
          const strongGps = tiff.gps;
          res.findings.push({
            kind: 'exif', where: 'JPEG APP1 (EXIF)', label: 'EXIF metadata block',
            detail: tiff.fields.length
              ? exifSummary(tiff.fields)
              : clip(text.replace(/^Exif\0\0/, ''), 90),
            evidence: 0, removable: true
          });
          if (strongGps) res.findings.push({ kind: 'gps', where: 'JPEG APP1 (EXIF GPS IFD)', label: 'GPS location data', detail: 'Latitude/longitude embedded', evidence: 0, removable: true });
          for (const f of tiff.fields) {
            if (f.label === 'Software' && f.value) {
              const hits = SIG.matchGenerators(f.value);
              for (const h of hits) res.findings.push({ kind: 'generator', where: 'EXIF Software', label: h.label + ' in EXIF Software', detail: clip(f.value, 90), evidence: h.strength, removable: true });
            }
          }
          const rawHits = SIG.matchGenerators(text);
          for (const h of rawHits) {
            if (res.findings.some(function (f) { return f.kind === 'generator' && f.label.indexOf(h.label) >= 0; })) continue;
            res.findings.push({ kind: 'generator', where: 'EXIF block content', label: h.label + ' signature in EXIF', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
          }
        } else if (m === 0xe1 && /http:\/\/ns\.adobe\.com\/xap|<x:xmpmeta|<\?xpacket/.test(text)) {
          const x = parseXmp(text);
          res.findings.push({ kind: 'xmp', where: 'JPEG APP1 (XMP)', label: 'XMP metadata packet', detail: x.creatorTool ? 'CreatorTool: ' + x.creatorTool : clip(text, 90), evidence: 0, removable: true });
          if (x.digitalSource) res.findings.push({ kind: 'xmp', where: 'XMP digitalSourceType', label: 'AI-source declaration', detail: x.digitalSource, evidence: /algorithmic|trained|composite|synthetic/i.test(x.digitalSource) ? 3 : 1, removable: true });
          for (const h of SIG.matchGenerators(text)) {
            res.findings.push({ kind: 'generator', where: 'XMP packet', label: h.label + ' in XMP', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
          }
        } else if (m === 0xe2 && /^ICC_PROFILE/.test(id)) {
          res.findings.push({ kind: 'icc', where: 'JPEG APP2', label: 'ICC color profile', detail: clip(id.replace(/\0.*$/, ''), 60), evidence: 0, removable: true });
        } else if (m === 0xed) { // APP13 Photoshop/IPTC
          res.findings.push({ kind: 'iptc', where: 'JPEG APP13', label: /photoshop/i.test(text) ? 'Photoshop / IPTC block' : 'IPTC metadata block', detail: clip(text, 90), evidence: 0, removable: true });
          for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'APP13 block', label: h.label + ' in Photoshop/IPTC block', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
        } else if (m === 0xe0) {
          res.findings.push({ kind: 'jfif', where: 'JPEG APP0', label: 'JFIF header', detail: 'Basic JPEG file header', evidence: 0, removable: true });
        } else if (m === 0xeb) { // APP11 = JUMBF/C2PA carrier
          const hasJumbf = containsBytes(view, 'JUMBF', seg.dataStart, seg.dataStart + seg.dataLen) >= 0 || containsBytes(view, 'JUMD', seg.dataStart, seg.dataStart + seg.dataLen) >= 0;
          res.findings.push({ kind: hasJumbf ? 'c2pa' : 'other', where: 'JPEG APP11', label: hasJumbf ? 'C2PA / Content Credentials' : 'Unrecognized data block', detail: hasJumbf ? 'Signed AI-content label data' : clip(id.replace(/\0.*$/, ''), 60), evidence: hasJumbf ? 3 : 0, removable: true });
        } else if (m === 0xec) { // APP12 vendor
          res.findings.push({ kind: 'other', where: 'JPEG APP12', label: 'Unrecognized data block', detail: clip(id.replace(/\0.*$/, ''), 60), evidence: 0, removable: true });
        } else if (m === 0xee) {
          res.findings.push({ kind: 'other', where: 'JPEG APP14', label: 'Adobe marker', detail: clip(id.replace(/\0/g, ' '), 40), evidence: 0, removable: true });
        } else if (m === 0xef) {
          res.findings.push({ kind: 'other', where: 'JPEG APP15', label: 'Unrecognized data block', detail: clip(id.replace(/\0.*$/, ''), 60), evidence: 0, removable: true });
        } else if (m >= 0xe3 && m <= 0xea) {
          res.findings.push({ kind: 'other', where: 'JPEG APP' + (m - 0xe0), label: 'Unrecognized data block', detail: clip(id.replace(/\0.*$/, ''), 60), evidence: 0, removable: true });
        }
      } else if (m === 0xfe) { // COM
        res.findings.push({ kind: 'jpeg-com', where: 'JPEG COM', label: 'JPEG comment segment', detail: clip(text, 90), evidence: 0, removable: true });
        const sdHits = SIG.matchSdParams(text);
        if (sdHits.length) res.findings.push({ kind: 'prompt', where: 'JPEG COM', label: 'Generation parameters in comment', detail: sdHits.join(', '), evidence: 3, removable: true });
        for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'JPEG comment', label: h.label + ' in comment', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
      }
    }
    if (res.trailing > 0) {
      res.findings.push({ kind: 'trailing-data', where: 'After JPEG EOI', label: res.trailing + ' bytes of hidden trailing data', detail: 'Data secretly attached after the image — a classic hiding spot', evidence: 1, removable: true });
    }
    return res;
  }

  /* ============================================================
   * PNG — chunk walk
   * ============================================================ */

  const PNG_KEEP = ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'cHRM', 'sBIT', 'iCCP'];

  async function parsePng(view) {
    const res = { format: 'png', chunks: [], findings: [], width: 0, height: 0 };
    let off = 8;
    const N = view.byteLength;
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    while (off + 8 <= N) {
      const len = dv.getUint32(off);
      const type = ascii(view, off + 4, 4);
      const dataStart = off + 8;
      if (dataStart + len + 4 > N) { res.chunks.push({ type, start: off, len, truncated: true }); break; }
      res.chunks.push({ type, start: off, len, dataStart });
      if (type === 'IHDR' && len >= 8) {
        res.width = dv.getUint32(dataStart);
        res.height = dv.getUint32(dataStart + 4);
      }
      off = dataStart + len + 4; // skip CRC
      if (off > N) break;
    }

    for (const ch of res.chunks) {
      if (ch.truncated) break;
      const data = view.subarray(ch.dataStart, ch.dataStart + Math.min(ch.len, 70000));
      const text = utf8(data);
      if (ch.type === 'tEXt' || ch.type === 'zTXt' || ch.type === 'iTXt') {
        let key = '', body = text;
        if (ch.type === 'tEXt') {
          const z = text.indexOf('\0');
          key = z >= 0 ? text.slice(0, z) : '';
          body = z >= 0 ? text.slice(z + 1) : text;
        } else if (ch.type === 'zTXt') {
          const z = text.indexOf('\0');
          key = z >= 0 ? text.slice(0, z) : '';
          body = '<compressed text>';
          try {
            if (typeof DecompressionStream !== 'undefined' && ch.len > 0 && data[z + 1] === 0) {
              const ds = new DecompressionStream('deflate');
              const stream = new Blob([data.subarray(z + 2)]).stream().pipeThrough(ds);
              const ab = await new Response(stream).arrayBuffer();
              body = utf8(new Uint8Array(ab));
            }
          } catch (e) { /* keep placeholder */ }
        } else if (ch.type === 'iTXt') {
          const z = text.indexOf('\0');
          key = z >= 0 ? text.slice(0, z) : '';
          body = text.slice(Math.min(text.length, z + 1 + 2 + 1)); // skip comp flag+method+lang... best-effort
        }
        const isSd = SIG.isSdChunkKey(key);
        const sdHits = SIG.matchSdParams(body);
        const genHits = SIG.matchGenerators(body);
        const kind = isSd || sdHits.length ? 'prompt' : 'png-text';
        res.findings.push({
          kind: kind, where: 'PNG ' + ch.type + ' "' + clip(key, 30) + '"',
          label: isSd ? 'Generation settings & prompt' : (sdHits.length ? 'Generation settings & prompt' : 'Text metadata'),
          detail: clip(body, 120), evidence: (isSd || sdHits.length) ? 3 : 0, removable: true
        });
        for (const h of genHits) res.findings.push({ kind: 'generator', where: 'PNG ' + ch.type + ' "' + clip(key, 30) + '"', label: h.label + ' metadata', detail: 'Found "' + clip(h.match, 40) + '" · ' + clip(body, 60), evidence: h.strength, removable: true });
      } else if (ch.type === 'eXIf') {
        const tiff = parseTiff(view, ch.dataStart);
        res.findings.push({
          kind: 'exif', where: 'PNG eXIf chunk', label: 'EXIF metadata',
          detail: tiff.fields.length ? exifSummary(tiff.fields) : clip(text, 90),
          evidence: 0, removable: true
        });
        if (tiff.gps) res.findings.push({ kind: 'gps', where: 'PNG eXIf (GPS IFD)', label: 'GPS location data', detail: 'Latitude/longitude embedded', evidence: 0, removable: true });
        for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'PNG eXIf chunk', label: h.label + ' in EXIF', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
      } else if (ch.type === 'tIME') {
        let timeDetail = '';
        try {
          const yr = (view[ch.dataStart] << 8) | view[ch.dataStart + 1];
          const mo = view[ch.dataStart + 2], dy = view[ch.dataStart + 3];
          const hh = view[ch.dataStart + 4], mi = view[ch.dataStart + 5];
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          if (yr > 1980 && yr < 2100) timeDetail = (months[mo - 1] || mo) + ' ' + dy + ', ' + yr + ', ' + ('' + hh).padStart(2, '0') + ':' + ('' + mi).padStart(2, '0');
        } catch (e) { /* ignore */ }
        res.findings.push({ kind: 'timestamp', where: 'PNG tIME chunk', label: 'Last-modified timestamp', detail: timeDetail || undefined, evidence: 0, removable: true });
      } else if (ch.type === 'iCCP') {
        res.findings.push({ kind: 'icc', where: 'PNG iCCP chunk', label: 'ICC color profile', detail: clip(text.split('\0')[0], 60), evidence: 0, removable: true });
      } else if (!PNG_KEEP.includes(ch.type)) {
        const isC2pa = /c2pa|cax|jumbf|contentcredentials/i.test(ch.type) || containsBytes(view, 'JUMBF', ch.dataStart, ch.dataStart + ch.len) >= 0;
        res.findings.push({
          kind: isC2pa ? 'c2pa' : 'other', where: 'PNG ' + ch.type + ' chunk',
          label: isC2pa ? 'C2PA / Content Credentials' : 'Unrecognized data block "' + ch.type + '"',
          detail: isC2pa ? 'Signed AI-content label data' : clip(text, 60),
          evidence: isC2pa ? 3 : 0, removable: true
        });
      }
    }
    return res;
  }

  /* ============================================================
   * WebP — RIFF chunk walk
   * ============================================================ */

  const WEBP_KEEP = ['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP'];

  function parseWebp(view) {
    const res = { format: 'webp', chunks: [], findings: [] };
    const N = view.byteLength;
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    let off = 12; // RIFF size WEBP
    while (off + 8 <= N) {
      const id = ascii(view, off, 4);
      const len = dv.getUint32(off + 4, true);
      const dataStart = off + 8;
      res.chunks.push({ id, start: off, len, dataStart });
      off = dataStart + len + (len & 1);
      if (off > N) break;
    }
    for (const ch of res.chunks) {
      const data = view.subarray(ch.dataStart, ch.dataStart + Math.min(ch.len, 70000));
      const text = utf8(data);
      if (ch.id === 'EXIF' || ch.id === 'EXIF') {
        const hasHeader = /^Exif\0\0/.test(ascii(view, ch.dataStart, 6));
        const tiff = parseTiff(view, ch.dataStart + (hasHeader ? 6 : 0));
        res.findings.push({ kind: 'exif', where: 'WebP EXIF chunk', label: 'EXIF metadata', detail: tiff.fields.length ? exifSummary(tiff.fields) : clip(text, 90), evidence: 0, removable: true });
        if (tiff.gps) res.findings.push({ kind: 'gps', where: 'WebP EXIF (GPS)', label: 'GPS location data', evidence: 0, removable: true });
        for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'WebP EXIF', label: h.label + ' in EXIF', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
      } else if (ch.id === 'XMP ' || ch.id === 'XMP') {
        const x = parseXmp(text);
        res.findings.push({ kind: 'xmp', where: 'WebP XMP chunk', label: 'XMP metadata', detail: x.creatorTool ? 'CreatorTool: ' + x.creatorTool : clip(text, 90), evidence: 0, removable: true });
        if (x.digitalSource) res.findings.push({ kind: 'xmp', where: 'XMP digitalSourceType', label: 'AI-source declaration', detail: x.digitalSource, evidence: /algorithmic|trained|composite|synthetic/i.test(x.digitalSource) ? 3 : 1, removable: true });
        for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'WebP XMP', label: h.label + ' in XMP', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
      } else if (ch.id === 'ICCP') {
        res.findings.push({ kind: 'icc', where: 'WebP ICCP chunk', label: 'ICC color profile', evidence: 0, removable: true });
      } else if (!WEBP_KEEP.includes(ch.id)) {
        res.findings.push({ kind: 'other', where: 'WebP "' + ch.id.trim() + '" chunk', label: 'Unrecognized data block "' + ch.id.trim() + '"', detail: clip(text, 60), evidence: 0, removable: true });
      }
    }
    return res;
  }

  /* ============================================================
   * GIF — block walk
   * ============================================================ */

  function parseGif(view) {
    const res = { format: 'gif', findings: [], animated: false, keepBlocks: [] };
    try {
      let off = 13; // header + LSD
      const flags = view[10];
      if (flags & 0x80) off += 3 * (2 << (flags & 7)); // GCT
      const N = view.byteLength;
      while (off < N) {
        const b = view[off];
        if (b === 0x3b) break;
        if (b === 0x21) { // extension
          const label = view[off + 1];
          if (label === 0xf9) { // GCE
            const len = view[off + 2];
            off += 3 + len + 1;
          } else if (label === 0xfe) { // comment
            let p = off + 2, total = 0;
            while (p < N && view[p] !== 0) { total += view[p] + 1; p += view[p] + 1; }
            const text = utf8(view.subarray(off + 2, Math.min(p, off + 2 + 500)));
            res.findings.push({ kind: 'other', where: 'GIF comment extension', label: 'Comment extension', detail: clip(text, 90), evidence: 0, removable: true });
            for (const h of SIG.matchGenerators(text)) res.findings.push({ kind: 'generator', where: 'GIF comment', label: h.label + ' in comment', detail: 'Found "' + clip(h.match, 40) + '"', evidence: h.strength, removable: true });
            off = p + 1;
          } else if (label === 0xff) { // application extension
            const blockSize = view[off + 2];
            const appId = ascii(view, off + 3, Math.min(blockSize, 11));
            let p = off + 3 + blockSize;
            while (p < N && view[p] !== 0) p += view[p] + 1;
            if (/NETSCAPE2\.0|ANIMEXTS1\.0/.test(appId)) { res.animated = true; }
            else {
              const text = ascii(view, off + 3, Math.min(blockSize, 40));
              res.findings.push({ kind: 'other', where: 'GIF application extension', label: 'Application extension "' + clip(appId, 24) + '"', detail: clip(text, 60), evidence: 0, removable: true });
            }
            off = p + 1;
          } else { // unknown ext
            let p = off + 2;
            while (p < N && view[p] !== 0) p += view[p] + 1;
            off = p + 1;
          }
        } else if (b === 0x2c) { // image descriptor
          off += 10;
          const lf = view[off - 1];
          if (lf & 0x80) off += 3 * (2 << (lf & 7));
          off++; // LZW min code size
          while (off < N && view[off] !== 0) off += view[off] + 1;
          off++;
        } else {
          off++;
        }
      }
    } catch (e) { /* tolerate malformed */ }
    return res;
  }

  /* ============================================================
   * Raw whole-file signature scan (catch-all for C2PA etc.)
   * ============================================================ */

  function rawSignatureScan(view, sizeMB) {
    const findings = [];
    /* Only deep-scan files under 25 MB to stay fast; C2PA lives in headers
     * for JPEG/PNG/WebP anyway, which structure parsing already covers. */
    if (sizeMB <= 25) {
      for (const sig of SIG.C2PA_SIGNATURES) {
        const at = containsBytes(view, sig.bytes, 0, view.byteLength);
        if (at >= 0) {
          findings.push({
            kind: 'c2pa', where: 'raw bytes @' + at, label: sig.label,
            detail: 'Found in file body', evidence: sig.bytes === 'JUMBF' || sig.bytes === 'JUMD' ? 3 : 3, removable: true
          });
          break; // one representative hit is enough for raw scan
        }
      }
    }
    return findings;
  }

  /* ============================================================
   * Public scan entry
   * ============================================================ */

  async function scan(view, sizeMB) {
    const fmt = detectFormat(view);
    let parsed = null;
    if (fmt === 'jpeg') parsed = parseJpeg(view);
    else if (fmt === 'png') parsed = await parsePng(view);
    else if (fmt === 'webp') parsed = parseWebp(view);
    else if (fmt === 'gif') parsed = parseGif(view);
    else parsed = { format: fmt, findings: [] };

    const raw = rawSignatureScan(view, sizeMB || 0);
    /* de-dupe raw hits already reported structurally */
    const hasC2pa = parsed.findings.some(function (f) { return f.kind === 'c2pa'; });
    if (!hasC2pa) {
      for (const r of raw) {
        if (!parsed.findings.some(function (f) { return f.where === r.where; })) parsed.findings.push(r);
      }
    }
    return parsed;
  }

  const api = {
    ascii: ascii, utf8: utf8, clip: clip, containsBytes: containsBytes,
    detectFormat: detectFormat, parseTiff: parseTiff, parseXmp: parseXmp,
    parseJpeg: parseJpeg, parsePng: parsePng, parseWebp: parseWebp, parseGif: parseGif,
    rawSignatureScan: rawSignatureScan, scan: scan,
    PNG_KEEP: PNG_KEEP, WEBP_KEEP: WEBP_KEEP
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UntraceParsers = api;
})(typeof self !== 'undefined' ? self : globalThis);
