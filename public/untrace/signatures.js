/* ============================================================
 * Untrace · signatures.js
 * AI-generation signature database + matching logic.
 * Pure logic — no browser APIs. Loaded in worker (importScripts)
 * and in the Node test harness.
 * ============================================================ */
(function (root) {
  'use strict';

  /* Metadata keys whose PRESENCE alone is a Stable-Diffusion-style
   * generation-parameter container. */
  const SD_CHUNK_KEYS = [
    'parameters', 'prompt', 'negative_prompt', 'negative prompt',
    'workflow', 'generation_data', 'sui_image_params', 'draft',
    'stable diffusion session', 'sd_metadata', 'generation info'
  ];

  /* Regexes that identify Stable-Diffusion-style parameter text bodies. */
  const SD_PARAM_PATTERNS = [
    { re: /negative prompt\s*:/i, label: 'Negative prompt block' },
    { re: /\bcfg scale\s*:/i, label: 'CFG scale' },
    { re: /\bsampler\s*:/i, label: 'Sampler setting' },
    { re: /\bsteps\s*:\s*\d+/i, label: 'Step count' },
    { re: /\bseed\s*:\s*\d+/i, label: 'Seed value' },
    { re: /denoising strength/i, label: 'Denoising strength' },
    { re: /model hash\s*:/i, label: 'Model hash' },
    { re: /\bvae\s*:/i, label: 'VAE setting' },
    { re: /\blora[^a-z]/i, label: 'LoRA reference' },
    { re: /clip skip/i, label: 'CLIP skip' },
    { re: /hires(?:\.| )?fix/i, label: 'Hires-fix settings' },
    { re: /\bema[a-z]*\s*\(/i, label: 'EMA model tag' },
    { re: /aesthetic score/i, label: 'Aesthetic score' },
    { re: /hypernetwork/i, label: 'Hypernetwork reference' },
    { re: /\brefiner\b/i, label: 'SDXL refiner reference' },
    { re: /control\s*-?net/i, label: 'ControlNet reference' },
    { re: /\bupscale(r)?\s*:/i, label: 'Upscaler settings' },
    { re: /\bcheckpoint\s*:/i, label: 'Checkpoint reference' },
    { re: /\bguidance\s*:?/i, label: 'Guidance scale' }
  ];

  /* Known AI generator / tooling name signatures.
   * strength: 3 = decisive evidence, 2 = strong, 1 = weak-contextual. */
  const GENERATORS = [
    { re: /midjourney/i, label: 'Midjourney', strength: 3 },
    { re: /dall[\s._\-·]?e\s*\d?|openai|gpt[\s.\-]?image|chatgpt|o3\b|sora/i, label: 'OpenAI / DALL·E / GPT Image', strength: 3 },
    { re: /stable[\s._\-]?diffusion|automatic1111|\ba1111\b|invokeai|comfyui|comfy[\s.\-]?ui|stable cascade|\bsdxl\b|\bsd3(\.\d)?\b|\bforge\b|reforge|sd[\s.\-]?webui/i, label: 'Stable Diffusion / ComfyUI', strength: 3 },
    { re: /adobe[\s._\-]?firefly|firefly|\bsui_image_params\b|generative[\s_\-]?fill/i, label: 'Adobe Firefly', strength: 3 },
    { re: /synthid|google[\s._\-]?(imagen|deepmind|ai)|imagen\s*\d?|nano[\s_\-]?banana|\bveo\d?\b|\bgemini\b|ai[\s\-]?test\s+Kitchen/i, label: 'Google Imagen / SynthID / Gemini', strength: 3 },
    { re: /flux(\.1)?\s|black[\s._\-]?forest[\s._\-]?labs|bfl\.ai|\bbfl-?flux\b/i, label: 'FLUX (Black Forest Labs)', strength: 3 },
    { re: /ideogram/i, label: 'Ideogram', strength: 3 },
    { re: /recraft/i, label: 'Recraft', strength: 3 },
    { re: /leonardo\.?ai|leonardo[\s_\-]?ai/i, label: 'Leonardo.Ai', strength: 3 },
    { re: /\bgrok\b|xai\b|x\.ai[\s_\-]?gen/i, label: 'xAI Grok / Aurora', strength: 3 },
    { re: /bing[\s_\-]?image[\s_\-]?creator|copilot[\s_\-]?designer|microsoft[\s_\-]?designer|dall-e-3 by microsoft/i, label: 'Microsoft Designer / Bing', strength: 3 },
    { re: /\brunway\b|runwayml|luma[\s_\-]?(ai|dream)|\bkrea\b|magnific|nightcafe|starryai|playground\s*v?\d|craiyon|pixart[\s.\-]?\w*|hidream|auraflow|hunyuan|kolors|wanx|tongyi|janus[\s\-]?\w*|seedream|seededit|doubao|jimeng|limeline|whisk|photon[\s\-]?(flash|base)|leapai|stability[\s.\-]?ai/i, label: 'Third-party AI generator', strength: 3 },
    { re: /generative[\s_\-]?ai|ai[\s_\-]?generated|aigenerated|trainedalgorithmicmedia|compositesynthetic|algorithmicmedia|trained\s*algorithmic/i, label: 'Explicit AI-generated label', strength: 3 },
    { re: /stable[\s\-]?signature|tree[\s\-]?ring|invisible[\s_\-]?watermark|watermark\s*removal|unwatermark/i, label: 'Watermarking tool signature', strength: 2 },
    { re: /photoshop|lightroom|gimp|canva|pixelmator|affinity|snapseed|picsart/i, label: 'Editing software tag', strength: 1 }
  ];

  /* C2PA / Content-Credentials structural + namespace signatures. */
  const C2PA_SIGNATURES = [
    { bytes: 'JUMBF', label: 'JUMBF container (C2PA carrier)' },
    { bytes: 'JUMD', label: 'JUMD box (C2PA manifest)' },
    { bytes: 'urn:c2pa', label: 'C2PA namespace URI' },
    { bytes: 'c2pa.actions', label: 'C2PA actions record' },
    { bytes: 'contentauthenticity', label: 'Content Authenticity namespace' },
    { bytes: 'contentcredentials', label: 'Content Credentials marker' },
    { bytes: 'content_credentials', label: 'Content Credentials marker' },
    { bytes: 'claim_generator', label: 'C2PA claim generator field' },
    { bytes: 'c2pa:', label: 'C2PA namespace prefix' }
  ];

  /* XMP markers worth reporting even when not AI-specific. */
  const XMP_MARKERS = [
    { re: /<x:xmpmeta|<\?xpacket|xmpDM:|xmlns:x=/i, label: 'XMP packet' }
  ];

  /* EXIF tag ids surfaced in the findings UI. */
  const EXIF_LABELS = {
    0x010f: 'Camera make', 0x0110: 'Camera model', 0x0112: 'Orientation',
    0x0131: 'Software', 0x0132: 'Capture time', 0x013b: 'Artist',
    0x8298: 'Copyright', 0x8769: 'Exif IFD', 0x8825: 'GPS IFD',
    0x9003: 'Original capture time', 0x9004: 'Digitized time',
    0x927c: 'Maker note', 0xa434: 'Lens model', 0xa430: 'Owner name',
    0xa431: 'Body serial number', 0xc614: 'Camera serial number',
    0x001d: 'GPS date', 0x0001: 'GPS latitude ref', 0x0002: 'GPS latitude',
    0x0003: 'GPS longitude ref', 0x0004: 'GPS longitude', 0x0006: 'GPS altitude'
  };

  function matchGenerators(text) {
    if (!text) return [];
    const hits = [];
    for (const g of GENERATORS) {
      const m = text.match(g.re);
      if (m) hits.push({ label: g.label, match: m[0], strength: g.strength });
    }
    return hits;
  }

  function matchSdParams(text) {
    if (!text) return [];
    const hits = [];
    for (const p of SD_PARAM_PATTERNS) {
      if (p.re.test(text)) hits.push(p.label);
    }
    return hits;
  }

  function isSdChunkKey(key) {
    if (!key) return false;
    const k = key.toLowerCase().trim();
    return SD_CHUNK_KEYS.some(function (s) { return k === s || k === s.replace(/[_\s-]+/g, ''); });
  }

  /* Filename forensics: many generators leave hints in the name. */
  function matchFileName(name) {
    if (!name) return [];
    const hits = [];
    const rules = [
      { re: /dall[\s._\-·]?e|openai/i, label: 'DALL·E filename pattern' },
      { re: /midjourney|_mj_|image_\d{4}/i, label: 'Midjourney filename pattern' },
      { re: /stable[\s._\-]?diffusion|\bsd_?gen|img2img|txt2img/i, label: 'Stable Diffusion filename pattern' },
      { re: /comfyui|comfy_\d|output_\d{5,}\.png/i, label: 'ComfyUI filename pattern' },
      { re: /gemini|imagen|nano[\s_\-]?banana|synthid/i, label: 'Google AI filename pattern' },
      { re: /grok_?image|xai/i, label: 'Grok filename pattern' },
      { re: /flux[_\s]?\d|bfl/i, label: 'FLUX filename pattern' },
      { re: /firefly|adobe[\s_]?gen/i, label: 'Firefly filename pattern' },
      { re: /ideogram|recraft|leonardo/i, label: 'Generator-branded filename' },
      { re: /seedimage|generated[_\s]?image|ai[_\s]?image|aiart/i, label: 'Generic AI filename pattern' },
      { re: /screenshot|screen[_\s]?shot/i, label: 'Screenshot filename' }
    ];
    for (const r of rules) if (r.re.test(name)) hits.push(r.label);
    return hits;
  }

  const api = {
    SD_CHUNK_KEYS: SD_CHUNK_KEYS,
    SD_PARAM_PATTERNS: SD_PARAM_PATTERNS,
    GENERATORS: GENERATORS,
    C2PA_SIGNATURES: C2PA_SIGNATURES,
    XMP_MARKERS: XMP_MARKERS,
    EXIF_LABELS: EXIF_LABELS,
    matchGenerators: matchGenerators,
    matchSdParams: matchSdParams,
    isSdChunkKey: isSdChunkKey,
    matchFileName: matchFileName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UntraceSignatures = api;
})(typeof self !== 'undefined' ? self : globalThis);
