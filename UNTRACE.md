# Untrace — Make AI images untraceable

A free, open-source, **100% client-side** AI footprint & metadata remover.
Drop up to **500 images** at once, watch the engine detect every AI-generation
trace, and download verified-clean copies — with **zero uploads**, because
there is no backend at all.

## What it detects & removes

| Footprint | Detection | Removal |
| --- | --- | --- |
| **C2PA / Content Credentials** (JUMBF manifests, claim generators) | ✅ | ✅ |
| **Generation prompts** (Stable Diffusion / ComfyUI `parameters`, `workflow` chunks) | ✅ | ✅ |
| **Generator signatures** — Midjourney, DALL·E / GPT Image, Stable Diffusion, Adobe Firefly, Imagen / SynthID / Gemini, FLUX, Grok, Ideogram, Leonardo, Recraft, and 30+ more | ✅ | ✅ |
| **EXIF** — camera make/model, lens, serial numbers, timestamps, maker notes | ✅ | ✅ |
| **GPS coordinates** | ✅ | ✅ |
| **XMP / IPTC** — creator tools, digital source declarations, edit history | ✅ | ✅ |
| **JPEG comments, PNG text chunks, WebP EXIF/XMP, GIF comments** | ✅ | ✅ |
| **Trailing payloads** appended after JPEG EOI | ✅ | ✅ |
| **Filename hints** (`DALL_E_1024.png`, `ComfyUI_00045.png`) | ✅ | ✅ (randomized names) |
| **Invisible watermarks** (SynthID-class spread-spectrum) | ✅ carrier-pattern analysis (codebook-free, statistical) | ⚡ dissolved via Deep Clean + re-checked after cleaning |

Every cleaned file is **re-scanned before download** — the UI tells you if a
single known signature survived. When an invisible watermark is found, the
watermark check is **re-run on the cleaned output** and the dialog shows how
much of the signal survived (e.g. “signal down 95% — no longer detectable”).

## Cleaning modes (as shown in the UI)

- **Standard Clean** (internally lossless) — byte-level container surgery.
  Removes every metadata segment/chunk while keeping the pixel data
  bit-identical (verified by test: PNG IDAT and JPEG scan data are untouched).
  The UI labels this “Image quality: identical to original”.
- **Deep Clean** — decodes the image and runs a SynthID-aware dissolution
  pipeline ported from public reverse-engineering research
  ([reverse-SynthID](https://github.com/aloshdenny/reverse-SynthID)):
  1. **Elastic warp** — a smooth sub-pixel displacement field (σ≈50 px,
    ±1.8–2.8 px) that fragments the watermark's spatial phase consensus
    (the “collage effect” the Gemini detector itself lists as a failure mode)
  2. **Affine combo** — micro rotation + zoom + shift in the same warp pass
  3. **Resize squeeze** — downsample to 82–90% then upsample
  4. **Carrier notch** — FFT-domain suppression at the empirically
    reverse-engineered SynthID carrier bins (512/1024 grids, ±2 neighborhood,
    ring-median-capped, Hermitian-pair-safe)
  5. **Color/contrast nudge** — micro brightness/contrast/saturation shifts
  6. **Noise + JPEG chain** — calibrated Gaussian noise and a quality-chain
    re-encode (0.88 → 0.90 on Aggressive)
  Every stage is PSNR-gated with an automatic gentler retry. UI “Watermark
  protection” presets: `Safe` (re-encode only), `Balanced` (recommended),
  `Aggressive` (stronger warp + squeeze + double encode).
- **Smart Auto** (default) — Standard Clean by default; Deep Clean kicks in
  automatically for files where AI traces are detected.

> The UI intentionally keeps things simple — it only tells users *what* gets
> removed. The technical detail lives here in the README for developers.

## Tech stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind CSS 4** + shadcn/ui + Framer Motion
- **Vanilla-JS engine** in `public/untrace/` loaded inside a pool of
  **Web Workers** (parallel bulk processing, zero bundler coupling):
  - `signatures.js` — AI signature database (40+ generators, SD parameter
    patterns, C2PA markers, filename heuristics)
  - `parsers.js` — structure-aware parsers for JPEG segments, PNG chunks,
    WebP RIFF boxes, GIF blocks + EXIF (TIFF IFD) and XMP readers
  - `synthid.js` — SynthID-class watermark detector + dissolver: pure-JS
    radix-2 FFT, empirically-verified carrier tables (512-px dark/white sets,
    1024-px universal bins), band-normalized carrier-vs-background scoring
    with peakiness damping, elastic/affine warp, carrier notch
  - `engine.js` — lossless cleaners, SynthID-aware deep clean, statistical AI
    detector, scoring, before/after watermark verification
  - `worker.js` — worker entry point
- **JSZip** (lazy-loaded) for one-click batch ZIP downloads
- **Zustand** for queue/settings state

No database. No API routes. No environment variables. Works offline after
first load.

## Run locally

```bash
npm install     # or: bun install / pnpm install
npm run dev     # http://localhost:3000
```

## Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm i -g vercel
cd untrace
vercel          # preview deployment
vercel --prod   # production deployment
```

Vercel auto-detects Next.js. No configuration needed.

### Option B — GitHub + Vercel dashboard

1. Create a new GitHub repository and push this folder:
   ```bash
   git init && git add -A && git commit -m "Untrace"
   git branch -M main
   git remote add origin https://github.com/<you>/untrace.git
   git push -u origin main
   ```
2. On [vercel.com/new](https://vercel.com/new), import the repo.
3. Framework preset: **Next.js** (auto-detected). Click **Deploy**.

### Option C — Drag & drop

Unzip, drag the folder onto [vercel.com/new](https://vercel.com/new).

Build command `next build` · Output handled by Vercel · Node 20+

## Engine test suite

The repo includes Node test harnesses that validate detection, cleaning,
pixel identity, and the SynthID pipeline on synthetic images:

```bash
python3 scripts/make_test_images.py     # metadata fixture images
npm run test:engine                     # 35 assertions (scan/clean/verify)
node scripts/test-synthid.mjs           # 23 assertions (FFT, detect, dissolve, notch)
```

Covers: Midjourney-in-EXIF JPEG (+ GPS + trailing payload), Firefly XMP with
`trainedAlgorithmicMedia`, SD/ComfyUI PNG text chunks, C2PA/JUMBF PNG,
DALL·E eXIf, Grok WebP EXIF, SD GIF comments, clean-file zero-finding
behavior, lossless pixel identity (PNG + JPEG), filename heuristics; plus
FFT-vs-DFT correctness, Hermitian symmetry, synthetic-watermark detection
(dark/white carrier sets, flat + buried-in-photo), false-positive controls
(natural-style photos, off-carrier periodic textures), warp PSNR floors,
and carrier-notch energy damping.

## Honesty & limitations

- Statistical detection is a **heuristic** — it flags likely-AI signals
  (noise uniformity, high-frequency falloff, saturation) but never claims
  proof. Metadata evidence is what drives high-confidence verdicts.
- The invisible-watermark check is a **codebook-free statistical estimate**
  built from publicly reverse-engineered carrier frequencies. It does not use
  Google's proprietary decoder and is not an official SynthID verdict. It is
  strongest on flat/simple images and can miss faint marks buried in busy
  photo content.
- Invisible watermark **dissolution** measurably degrades the carrier signal
  (typically 90%+ signal reduction at Balanced on detectable marks) but
  cannot *guarantee* removal of every watermark. That's why the watermark
  check re-runs after cleaning and reports exactly how much signal survived
  — you always know where you stand.
- Platforms may still classify images **visually** — metadata cleaning does
  not change what pixels look like to a classifier.
- GIFs keep their animation in Standard Clean; Deep Clean converts them to
  stills. AVIF/HEIC/BMP/TIFF are re-encoded where the browser can decode them.

## Use responsibly

Removing provenance from content you don't own, or deceiving platforms and
people, may violate laws or terms of service. Untrace exists so creators can
control the privacy of their own work.

## License

MIT — see [LICENSE](LICENSE).
