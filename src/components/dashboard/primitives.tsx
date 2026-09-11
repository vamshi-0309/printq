"use client";

import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/orderStatus";

/**
 * The dashboard's shared vocabulary.
 *
 * PrintQ's identity is a print shop's own materials: paper white on paper
 * grey, ink navy type, square corners, hairline rules, and a mono face for
 * anything a machine produced — tokens, order ids, counts, timestamps. These
 * pieces exist so every screen states things the same way, and so status
 * colour is chosen from a tone the data carries rather than picked per screen.
 */

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-line bg-paper-grey text-ink-soft",
  info: "border-cyan/25 bg-cyan/[0.07] text-cyan-deep",
  active: "border-cyan bg-cyan text-paper",
  success: "border-emerald-600/25 bg-emerald-50 text-emerald-800",
  warning: "border-toner-yellow/40 bg-toner-yellow/[0.12] text-[#8a6a00]",
  danger: "border-magenta/25 bg-magenta/[0.06] text-magenta",
};

const TONE_DOT: Record<StatusTone, string> = {
  neutral: "bg-ink-soft/40",
  info: "bg-cyan",
  active: "bg-paper",
  success: "bg-emerald-600",
  warning: "bg-toner-yellow",
  danger: "bg-magenta",
};

export function StatusPill({
  tone,
  children,
  dot = true,
  className = "",
}: {
  tone: StatusTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-[3px] font-data text-[10.5px] font-medium uppercase tracking-[0.08em] whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A headline number. `hint` carries the qualification the number needs. */
export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusTone;
}) {
  const accent =
    tone === "danger"
      ? "border-l-magenta"
      : tone === "warning"
        ? "border-l-toner-yellow"
        : tone === "success"
          ? "border-l-emerald-600"
          : "border-l-cyan";

  return (
    <div className={`border border-line border-l-2 bg-paper px-4 py-3.5 ${accent}`}>
      <p className="font-data text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </p>
      <p className="mt-1.5 font-data text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="t-eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 font-display text-[17px] font-bold tracking-[-0.02em] text-ink">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

/**
 * "2 minutes ago", rendered from a timestamp.
 *
 * Deliberately not live-ticking: a component that re-renders every second to
 * age a label is a lot of work for a number nobody watches change, and the
 * pages refresh on their own often enough for it to stay honest.
 */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Wall-clock time of a fetch, e.g. "9:42 pm".
 *
 * Deliberately absolute rather than "2 min ago": a relative label has to read
 * the current clock during render, which is exactly the impurity the React
 * Compiler rejects, and it would go stale on screen anyway. A timestamp the
 * owner can compare against their own watch says the same thing honestly.
 */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Absolute time, in the format an Indian shop counter reads. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Inline error, styled as a correction rather than an alarm. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="border-l-2 border-magenta bg-magenta/[0.05] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-magenta"
    >
      {children}
    </p>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-cyan bg-cyan/[0.05] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}

/** The bar above every screen: what you're looking at, and how fresh it is. */
export function PageHeader({
  title,
  description,
  updatedAt,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  description?: string;
  updatedAt?: number | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink sm:text-[26px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-soft">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="group inline-flex items-center gap-2 border border-line bg-paper px-3 py-1.5 font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className={refreshing ? "animate-spin" : ""}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            {refreshing ? "Updating" : updatedAt ? clockTime(updatedAt) : "Refresh"}
          </button>
        )}
      </div>
    </div>
  );
}
