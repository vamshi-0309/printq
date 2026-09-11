import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://printq.in";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "PrintQ — QR print ordering for Xerox shops",
    template: "%s · PrintQ",
  },
  description:
    "Turn your Xerox shop into a QR-powered print counter. Customers scan, upload, pay, and get a token — the job prints automatically.",
  openGraph: {
    title: "PrintQ — QR print ordering for Xerox shops",
    description:
      "Turn your Xerox shop into a QR-powered print counter. Customers scan, upload, pay, and get a token — the job prints automatically.",
    url: appUrl,
    siteName: "PrintQ",
    locale: "en_IN",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      {/*
        suppressHydrationWarning: browser extensions inject attributes onto
        <body> before React hydrates (ColorZilla adds `cz-shortcut-listen`,
        Grammarly adds `data-gr-*`, and so on). React then reports a mismatch
        for markup we never wrote. This suppression is one level deep — it
        covers attributes on <body> itself, NOT the app inside it, so genuine
        hydration bugs in our own components still surface.
      */}
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-paper text-ink"
      >
        {children}
      </body>
    </html>
  );
}
