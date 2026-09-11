/**
 * Shared marketing primitives.
 *
 * These exist so every marketing section shares one heading rhythm, one CTA
 * shape and one decorative vocabulary. Server-safe — no client hooks here.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "./icons";

/* ── Section heading ──────────────────────────────────────────────── */

type Tone = "light" | "dark";

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  tone = "light",
  size = "lg",
  className = "",
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  tone?: Tone;
  size?: "lg" | "md";
  className?: string;
  children?: ReactNode;
}) {
  const centered = align === "center";
  return (
    <div
      className={`${centered ? "mx-auto text-center" : ""} ${
        centered ? "max-w-2xl" : "max-w-2xl"
      } ${className}`}
    >
      {eyebrow ? (
        <p
          className={`t-eyebrow flex items-center gap-2.5 ${centered ? "justify-center" : ""} ${
            tone === "dark" ? "text-cyan" : ""
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-px w-6 ${tone === "dark" ? "bg-cyan/50" : "bg-cyan/40"}`}
          />
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`mt-3.5 ${size === "lg" ? "t-display-lg" : "t-display-md"} ${
          tone === "dark" ? "!text-paper" : ""
        }`}
      >
        {title}
      </h2>
      {lead ? (
        <p className={`mt-4 t-lead ${tone === "dark" ? "!text-paper/70" : ""}`}>{lead}</p>
      ) : null}
      {children}
    </div>
  );
}

/* ── CTA links ────────────────────────────────────────────────────── */

type CtaVariant = "primary" | "secondary" | "accent" | "onDark" | "onDarkGhost";

const ctaStyles: Record<CtaVariant, string> = {
  primary:
    "bg-ink text-paper border-ink hover:bg-ink-deep hover:shadow-lg hover:shadow-ink/20",
  secondary:
    "bg-paper text-ink border-line-strong hover:border-ink hover:shadow-md hover:shadow-ink/8",
  accent:
    "bg-cyan text-paper border-cyan hover:bg-cyan-deep hover:shadow-lg hover:shadow-cyan/25",
  onDark: "bg-cyan text-paper border-cyan hover:bg-cyan-deep",
  onDarkGhost:
    "bg-transparent text-paper border-paper/25 hover:border-paper/60 hover:bg-paper/5",
};

export function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  withArrow = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: CtaVariant;
  size?: "sm" | "md" | "lg";
  withArrow?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: "px-4 py-2 text-[13px]",
    md: "px-6 py-3 text-sm",
    lg: "px-7 py-3.5 text-[15px]",
  } as const;

  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 border font-medium tracking-[-0.005em] transition-all duration-200 ${ctaStyles[variant]} ${sizes[size]} ${className}`}
    >
      {children}
      {withArrow ? (
        <ArrowRightIcon
          size={16}
          className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        />
      ) : null}
    </Link>
  );
}

/** Inline "read more" style text link with a sliding arrow. */
export function TextLink({
  href,
  children,
  tone = "light",
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
        tone === "dark" ? "text-cyan hover:text-paper" : "text-cyan hover:text-ink"
      } ${className}`}
    >
      <span className="border-b border-current/30 pb-0.5 group-hover:border-current">
        {children}
      </span>
      <ArrowRightIcon
        size={15}
        className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}

/* ── Decorative chrome ────────────────────────────────────────────── */

/** Small mono pill used for trust chips and labels. */
export function Pill({
  children,
  tone = "light",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-data text-[11px] font-medium tracking-[0.04em] ${
        tone === "dark"
          ? "border-paper/20 bg-paper/5 text-paper/80"
          : "border-line bg-paper-grey/70 text-ink-soft"
      } ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Window-chrome wrapper for desktop-app mockups. Deliberately a *frame only* —
 * callers pass their own body, which for the software showcase is a labelled
 * placeholder rather than a fabricated screenshot.
 */
export function WindowFrame({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden border border-line-strong bg-paper shadow-xl shadow-ink/8 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line bg-paper-grey px-3 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="truncate font-data text-[11px] text-ink-soft">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** Corner tick marks — a recurring "technical drawing" motif. */
export function CornerTicks({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-cyan/50" />
      <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-cyan/50" />
      <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-cyan/50" />
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-cyan/50" />
    </span>
  );
}
