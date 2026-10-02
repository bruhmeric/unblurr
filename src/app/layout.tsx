import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "unblurr.site — keep your video quality",
  description:
    "Prepare your videos so they keep their original quality when you upload them. Processed privately on your device — free to start.",
  keywords: ["video quality", "upload quality", "mp4", "video enhancer", "unblurr"],
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "unblurr.site — keep your video quality",
    description:
      "Your videos, exactly as crisp as you edited them. Processed privately on your device.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#060809",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
