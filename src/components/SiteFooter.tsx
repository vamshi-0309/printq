import Link from "next/link";
import { PrintQMark } from "./SiteHeader";
import { IndiaFlagIcon } from "./marketing/icons";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/features", label: "Features" },
      { href: "/for-shops", label: "For Xerox shops" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Support",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
      { href: "/login", label: "Shop login" },
      { href: "/register", label: "Register a shop" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/partner", label: "Partner programme" },
      { href: "/for-shops", label: "Why PrintQ" },
      { href: "/contact", label: "Talk to us" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-x-clip border-t border-line bg-paper-grey">
      <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-5 py-14 sm:px-6 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.6fr_2.4fr] lg:gap-16">
          {/* Brand block */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <PrintQMark size={26} />
              <span className="font-display text-[17px] font-bold tracking-[-0.03em] text-ink">
                PrintQ
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">
              QR-based print ordering for Xerox and photocopy shops. Customers scan,
              upload and pay — the job prints itself, and the money goes straight to
              the shop&apos;s own account.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 border border-line bg-paper px-2.5 py-1.5">
                <IndiaFlagIcon size={16} />
                <span className="font-data text-[10.5px] tracking-[0.06em] text-ink-soft">
                  Made in India
                </span>
              </span>
              <span className="inline-flex items-center gap-2 border border-line bg-paper px-2.5 py-1.5">
                <span className="h-1.5 w-1.5 bg-cyan" aria-hidden="true" />
                <span className="font-data text-[10.5px] tracking-[0.06em] text-ink-soft">
                  0% commission
                </span>
              </span>
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <nav key={col.heading} aria-label={col.heading}>
                <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink">
                  {col.heading}
                </p>
                <span
                  className="mt-3 block h-px w-6 bg-cyan"
                  aria-hidden="true"
                />
                <ul className="mt-4 flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={`${col.heading}-${l.href}-${l.label}`}>
                      <FooterLink href={l.href}>{l.label}</FooterLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line pt-7 sm:flex-row sm:items-center">
          <p className="font-data text-[11px] text-ink-soft">
            &copy; {new Date().getFullYear()} PrintQ. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <FooterLink href="/privacy" small>
              Privacy
            </FooterLink>
            <FooterLink href="/terms" small>
              Terms
            </FooterLink>
            <FooterLink href="/contact" small>
              Contact
            </FooterLink>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
  small = false,
}: {
  href: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-ink-soft transition-colors hover:text-cyan ${
        small ? "font-data text-[11px]" : "text-[13.5px]"
      }`}
    >
      {children}
    </Link>
  );
}
