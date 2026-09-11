"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRightIcon } from "./icons";

const STORAGE_KEY = "printq.announcement.dismissed.v1";

/**
 * Dismissal is external state (localStorage), so it's read through
 * `useSyncExternalStore` rather than a state-setting effect. That also gets
 * the SSR story right: the server snapshot reports "dismissed", so the bar is
 * absent from the HTML and appears only once the client has actually checked
 * storage — no hydration mismatch, and no flash for people who dismissed it.
 */

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Keep other tabs in sync too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage — treat as not dismissed.
    return false;
  }
}

function getServerSnapshot(): boolean {
  return true;
}

function dismiss() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Non-fatal — the bar still closes for this page view.
  }
  emit();
}

/** Slim dismissible bar that sits above the site header. */
export function AnnouncementBar() {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (dismissed) return null;

  return (
    <div className="announce-in relative z-40 bg-ink text-paper">
      <div
        className="pointer-events-none absolute inset-0 opacity-40 bg-blueprint-dark"
        aria-hidden="true"
      />
      <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 sm:px-6">
        <span className="hidden h-1.5 w-1.5 shrink-0 bg-cyan sm:block" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-paper/85 sm:text-[13px]">
          <span className="mr-2 font-data text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan">
            New
          </span>
          <span className="mr-2 hidden text-paper/25 sm:inline" aria-hidden="true">
            /
          </span>
          <span className="align-middle">
            Now onboarding shops across India —{" "}
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-1 font-medium text-paper underline decoration-paper/30 underline-offset-[3px] transition-colors hover:decoration-paper"
            >
              see how it works
              <ArrowRightIcon
                size={13}
                className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              />
            </Link>
          </span>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center text-paper/50 transition-colors hover:text-paper"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
