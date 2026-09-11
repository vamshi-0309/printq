"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The dashboard's navigation.
 *
 * Two things the previous version got wrong, both of which matter when this is
 * the screen someone runs their shop from:
 *
 *   - no active state, so nothing told you which page you were on;
 *   - the mobile bar rendered only the first five items, silently dropping the
 *     QR code page on exactly the device most likely to need it.
 *
 * On a phone the nav is a scrolling strip carrying every destination rather
 * than a truncated bar, so nothing is hidden.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({
  items,
  footer,
  variant,
}: {
  items: NavItem[];
  footer?: ReactNode;
  /** "rail" is the desktop sidebar; "strip" is the phone's scrolling tabs. */
  variant: "rail" | "strip";
}) {
  const pathname = usePathname();

  if (variant === "rail") {
    return (
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 border-l-2 px-3 py-2 text-[13.5px] transition-colors ${
                active
                  ? "border-l-cyan bg-cyan/[0.06] font-medium text-ink"
                  : "border-l-transparent text-ink-soft hover:bg-paper-grey hover:text-ink"
              }`}
            >
              <span className={active ? "text-cyan" : "text-ink-soft"} aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
        {footer && <div className="mt-auto px-3 pb-4 pt-6">{footer}</div>}
      </nav>
    );
  }

  // Scrolls, so every destination stays reachable on a phone.
  return (
    <nav className="sticky top-0 z-30 -mx-5 flex gap-1 overflow-x-auto border-b border-line bg-paper px-5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 border px-3 py-1.5 text-[12.5px] whitespace-nowrap transition-colors ${
                active
                  ? "border-ink bg-ink font-medium text-paper"
                  : "border-line text-ink-soft"
              }`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
