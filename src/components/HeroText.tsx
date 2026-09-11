"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

export function HeroText() {
  const reducedMotion = useReducedMotion();

  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08 } },
  };

  const line = reducedMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { opacity: 0, y: 16 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
        },
      };

  return (
    <motion.div
      className="flex flex-col justify-center"
      variants={container}
      initial="hidden"
      animate="visible"
    >
      <motion.h1
        variants={line}
        className="font-display text-[2.5rem] font-extrabold leading-[1.06] tracking-tight text-ink sm:text-5xl md:text-[3.4rem]"
      >
        Turn your Xerox shop into a{" "}
        <span className="relative inline-block">
          <span className="relative z-10">QR-powered</span>
          <span
            className="absolute bottom-1 left-0 right-0 z-0 h-3 bg-cyan/15"
            aria-hidden="true"
          />
        </span>{" "}
        print counter.
      </motion.h1>

      <motion.p
        variants={line}
        className="mt-5 max-w-md text-base leading-relaxed text-ink-soft sm:text-lg"
      >
        Customers scan your QR, upload their document, pay you directly,
        and get a token number. Their job prints on your counter
        automatically.
      </motion.p>

      <motion.div variants={line} className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href="/pricing"
          className="bg-ink px-6 py-3 text-sm font-medium text-paper transition-colors hover:bg-ink-soft"
        >
          Get PrintQ for your shop
        </Link>
        <Link
          href="/how-it-works"
          className="border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-ink"
        >
          See how it works
        </Link>
      </motion.div>

      <motion.div variants={line} className="mt-8 flex items-center gap-6">
        <Stat label="No app for customers" />
        <div className="h-4 w-px bg-line" aria-hidden="true" />
        <Stat label="No commissions" />
        <div className="hidden sm:block h-4 w-px bg-line" aria-hidden="true" />
        <span className="hidden sm:block"><Stat label="Auto-prints" /></span>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="#0098C7" strokeWidth="1.5" />
        <path d="M8 12l3 3 5-5" stroke="#0098C7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-xs text-ink-soft font-medium">{label}</span>
    </div>
  );
}
