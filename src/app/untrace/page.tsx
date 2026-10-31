import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { UntracePage } from "@/components/untrace/untrace-page";

/* Display typeface used by the Untrace feature UI. Loaded here — and only
 * here — so the rest of unblurr.site is completely unaffected. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Untrace — Make AI images untraceable · unblurr.site",
  description:
    "Detect and erase AI footprints from your images: C2PA Content Credentials, EXIF, XMP, IPTC, generation prompts, GPS — plus invisible-watermark disruption. 100% in-browser, zero uploads, bulk up to 500 images. Free and unlimited for unblurr members.",
  keywords: [
    "AI metadata remover", "C2PA remover", "EXIF remover", "XMP cleaner",
    "AI footprint", "SynthID", "Content Credentials", "bulk image cleaner",
    "privacy tools", "browser image processing", "unblurr",
  ],
  icons: { icon: "/untrace/icon.svg" },
  openGraph: {
    title: "Untrace — Make AI images untraceable · unblurr.site",
    description:
      "Strip C2PA, EXIF, XMP, prompts and watermark patterns from up to 500 images at once. Fully local, nothing ever uploads. Free and unlimited for members.",
    siteName: "unblurr.site",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#04070c",
};

export default function UntraceRoute() {
  return <UntracePage fontClass={spaceGrotesk.variable} />;
}
