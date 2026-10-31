'use client';

import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';

const FAQS = [
  {
    q: 'Does Untrace really never upload my images?',
    a: 'Correct. The cleaner has no backend and no storage bucket — everything runs inside your browser. You can pull your network cable after the page loads and clean 500 images offline. Your unblurr account is only used to sign you in.',
  },
  {
    q: 'What is C2PA / Content Credentials, exactly?',
    a: 'C2PA is an industry standard (backed by Adobe, Microsoft, Google and others) that embeds a signed “Made with AI” label inside the image file. Midjourney, DALL·E 3, GPT Image, Firefly and Nano Banana all embed it, and platforms like Instagram and Facebook read it to apply AI labels. Untrace detects the label, shows you what it declares, and removes it completely.',
  },
  {
    q: 'What is the difference between Standard and Deep Clean?',
    a: 'Standard Clean removes all hidden metadata while keeping image quality 100% identical. Deep Clean goes further and also disrupts invisible AI watermarks hidden inside the pixels — with a trade-off so small it’s practically invisible to the eye.',
  },
  {
    q: 'Can it really remove SynthID-style invisible watermarks?',
    a: 'It detects them and breaks them — and then tells you honestly how well it worked. Every image gets a watermark check that looks for the hidden pixel patterns used by AI watermarks like Google’s SynthID. Deep Clean dissolves what it finds, and the result is re-checked so you can see how much of the signal survived. Extremely robust marks may partially survive (Balanced keeps more quality, Aggressive removes more signal) — you always know what state your file is in.',
  },
  {
    q: 'Why did a platform still label my image as AI?',
    a: 'Platforms also run visual classifiers that analyze the image content itself — smooth noise, generation artifacts, familiar styles. Metadata removal defeats metadata-based labeling; it cannot change what the pixels look like to a classifier. Also note: if an image was already uploaded and labeled before cleaning, the label stays attached to that upload. Clean first, then upload.',
  },
  {
    q: 'Will Deep Clean hurt my image quality?',
    a: 'In most cases the change is invisible to the eye at normal viewing sizes. Aggressive mode can soften ultra-fine detail on very close inspection — if that matters to you, stick with Balanced or Standard Clean.',
  },
  {
    q: 'Which formats are supported?',
    a: 'JPEG, PNG, WebP and GIF are fully supported (GIF keeps its animation). AVIF, HEIC, BMP and TIFF work wherever your browser can open them — Safari handles HEIC, most browsers handle AVIF. Anything unsupported fails with a clear message instead of pretending.',
  },
  {
    q: 'Is Untrace included in my unblurr plan?',
    a: 'Yes — Untrace is free and unlimited for every signed-in unblurr member, on both free and premium accounts. It never counts against your daily video quota: cleaning images happens entirely on your device, so there is nothing to meter.',
  },
  {
    q: 'Is removing AI metadata legal?',
    a: 'In most jurisdictions, stripping metadata from files you own is legal — it’s the same as EXIF scrubbing, a standard privacy practice. But platform terms of service may prohibit evading their labeling systems, and removing provenance from someone else’s content can violate copyright or fraud laws. Use Untrace for privacy and creative control of your own work, and stay on the right side of the platforms you post to.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">FAQ</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            Straight <span className="text-gradient">answers</span>
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-10">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-white/8">
              <AccordionTrigger className="text-left text-sm font-medium text-slate-200 hover:text-emerald-200 hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-slate-400">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
