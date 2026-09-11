"use client";

import { motion, useReducedMotion } from "framer-motion";

export function HeroMockup() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="relative flex items-center justify-center">
      {/* Decorative dot grid behind the phone */}
      <div className="absolute inset-0 opacity-[0.07]" aria-hidden="true">
        <svg width="100%" height="100%" className="text-ink">
          <pattern id="hero-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="currentColor" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#hero-dots)" />
        </svg>
      </div>

      {/* Phone frame */}
      <motion.div
        initial={reducedMotion ? {} : { opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative z-10"
      >
        <div className="relative w-[260px] sm:w-[280px] overflow-hidden rounded-[28px] border-[3px] border-ink bg-paper shadow-2xl shadow-ink/15">
          {/* Status bar */}
          <div className="flex items-center justify-between bg-ink px-5 py-2">
            <span className="font-data text-[10px] text-paper/70">9:41</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-paper/50" />
              <div className="h-1.5 w-1.5 rounded-full bg-paper/50" />
              <div className="h-1.5 w-1.5 rounded-full bg-paper/70" />
            </div>
          </div>

          {/* App header */}
          <div className="border-b border-line bg-paper-grey px-4 py-3">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
                <rect x="2" y="2" width="28" height="28" rx="2" fill="none" stroke="#0A1F3C" strokeWidth="2.5" />
                <rect x="7" y="7" width="5" height="5" fill="#0A1F3C" />
                <rect x="19" y="7" width="5" height="5" fill="#0098C7" />
                <rect x="7" y="19" width="5" height="5" fill="#0098C7" />
              </svg>
              <span className="font-display text-xs font-bold text-ink">PrintQ</span>
              <span className="ml-auto font-data text-[10px] text-ink-soft">Sharma Xerox</span>
            </div>
          </div>

          {/* Upload step */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] text-ink-soft">
              <StepDot active />
              <div className="h-px flex-1 bg-cyan" />
              <StepDot />
              <div className="h-px flex-1 bg-line" />
              <StepDot />
              <div className="h-px flex-1 bg-line" />
              <StepDot />
            </div>
          </div>

          {/* File uploaded state */}
          <div className="px-4">
            <div className="border border-line bg-paper-grey p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center bg-cyan/10">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#0098C7" strokeWidth="1.5" />
                    <polyline points="14,2 14,8 20,8" stroke="#0098C7" strokeWidth="1.5" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-ink">Assignment_Final.pdf</p>
                  <p className="font-data text-[10px] text-ink-soft">4 pages · 1.2 MB</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="#0098C7" strokeWidth="1.5" />
                  <path d="M8 12l3 3 5-5" stroke="#0098C7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          {/* Print options */}
          <div className="px-4 py-3 space-y-2.5">
            <OptionRow label="Copies" value="2" />
            <OptionRow label="Colour" value="B&W" />
            <OptionRow label="Paper" value="A4" />
            <OptionRow label="Sides" value="Single" />
          </div>

          {/* Price + pay button */}
          <div className="border-t border-line px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-ink-soft">Total</p>
                <p className="font-data text-lg font-semibold text-ink">₹8.00</p>
              </div>
              <motion.div
                initial={reducedMotion ? {} : { scale: 0.95 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.8, duration: 0.3, type: "spring", stiffness: 300 }}
              >
                <div className="bg-cyan px-5 py-2 text-xs font-medium text-paper">
                  Pay with UPI
                </div>
              </motion.div>
            </div>
          </div>

          {/* Home indicator */}
          <div className="flex justify-center pb-2 pt-1">
            <div className="h-1 w-24 rounded-full bg-line" />
          </div>
        </div>
      </motion.div>

      {/* Floating token card */}
      <motion.div
        initial={reducedMotion ? {} : { opacity: 0, x: 20, y: -10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
        className="absolute -right-4 top-12 z-20 hidden sm:block"
      >
        <div className="border border-line bg-paper p-3 shadow-lg shadow-ink/8">
          <p className="text-[10px] text-ink-soft">Your token</p>
          <p className="font-data text-2xl font-bold text-cyan">A042</p>
          <p className="font-data text-[10px] text-ink-soft mt-1">Queue: 3rd</p>
        </div>
      </motion.div>

      {/* Floating printer card */}
      <motion.div
        initial={reducedMotion ? {} : { opacity: 0, x: -20, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.5, delay: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
        className="absolute -left-6 bottom-20 z-20 hidden sm:block"
      >
        <div className="border border-line bg-paper p-3 shadow-lg shadow-ink/8">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-[10px] font-medium text-ink">Printing...</p>
          </div>
          <div className="mt-1.5 h-1 w-20 bg-paper-grey overflow-hidden">
            <motion.div
              className="h-full bg-cyan"
              initial={{ width: "0%" }}
              animate={{ width: "68%" }}
              transition={{ duration: 1.5, delay: 1.2, ease: "easeOut" }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StepDot({ active = false }: { active?: boolean }) {
  return (
    <div
      className={`h-2 w-2 rounded-full ${
        active ? "bg-cyan" : "bg-line"
      }`}
    />
  );
}

function OptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink-soft">{label}</span>
      <span className="border border-line bg-paper-grey px-2.5 py-0.5 font-data text-[11px] text-ink">
        {value}
      </span>
    </div>
  );
}
