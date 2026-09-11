"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { MobileNav } from "./MobileNav";
import { AnnouncementBar } from "./marketing/AnnouncementBar";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/features", label: "Features" },
  { href: "/for-shops", label: "For Xerox shops" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

/**
 * Shared site header.
 *
 * `announcement` is opt-in and OFF by default on purpose: this header is also
 * used by the dashboard, login/register and the customer print page, and a
 * marketing promo bar has no business sitting above those. Only the marketing
 * pages pass it.
 */
export function SiteHeader({ announcement = false }: { announcement?: boolean } = {}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    // The announcement bar scrolls away with the header as one sticky block,
    // so dismissing it never leaves a gap behind the nav.
    <div className="sticky top-0 z-30">
      {announcement ? <AnnouncementBar /> : null}

      <header
        className={`border-b transition-[background-color,border-color,box-shadow] duration-200 ${
          scrolled
            ? "border-line bg-paper/92 shadow-sm shadow-ink/5 backdrop-blur-md"
            : "border-line/60 bg-paper"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <PrintQMark />
            <span className="font-display text-[19px] font-bold tracking-[-0.03em] text-ink">
              PrintQ
            </span>
          </Link>

          <nav className="hidden items-center md:flex" aria-label="Main">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative px-3.5 py-2 text-[13.5px] tracking-[-0.005em] transition-colors lg:px-4 ${
                    active ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {l.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-3.5 bottom-0.5 h-0.5 origin-left bg-cyan transition-transform duration-200 lg:inset-x-4 ${
                      active ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/login"
              className="hidden px-3 py-2 text-[13.5px] text-ink-soft transition-colors hover:text-ink lg:inline-flex"
            >
              Shop login
            </Link>
            <Link
              href="/pricing"
              className="hidden border border-ink bg-ink px-4 py-2 text-[13.5px] font-medium text-paper transition-colors hover:bg-ink-deep sm:inline-flex"
            >
              Get PrintQ
            </Link>
            <MobileNav />
          </div>
        </div>
      </header>
    </div>
  );
}

export function PrintQMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="2" fill="none" stroke="#0A1F3C" strokeWidth="2" />
      <rect x="7" y="7" width="6" height="6" fill="#0A1F3C" />
      <rect x="19" y="7" width="6" height="6" fill="#0098C7" />
      <rect x="7" y="19" width="6" height="6" fill="#0098C7" />
      <rect x="19" y="19" width="6" height="6" fill="#D6006E" />
    </svg>
  );
}
