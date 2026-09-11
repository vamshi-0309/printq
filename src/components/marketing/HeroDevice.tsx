"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Illustrated, animated device mockup for the hero.
 *
 * Deliberately NOT real footage — it's SVG + Framer Motion, so it stays crisp
 * at any size, needs no asset pipeline, and can be edited as code. It loops a
 * four-step sequence that mirrors the real product flow:
 *
 *   scan QR → upload file → payment confirmed → printer feeds a page
 *
 * Layout: the screen is a fixed 296px-tall box, so swapping steps never
 * reflows the hero. `prefers-reduced-motion` freezes on the final frame
 * (a printed page + token), which reads clearly with no motion at all.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const STEP_MS = 3200;
const STEP_COUNT = 4;

const STEP_LABELS = ["Scan", "Upload", "Pay", "Print"] as const;

export function HeroDevice() {
  const reducedMotion = useReducedMotion();
  const [tick, setTick] = useState(0);

  // The frozen frame is derived, not stored: with reduced motion we simply
  // read the last step and never start the timer.
  const step = reducedMotion ? STEP_COUNT - 1 : tick % STEP_COUNT;

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setTick((t) => t + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  return (
    <div className="relative">
      {/* Phone shell */}
      <div className="relative w-[264px] sm:w-[288px]">
        <div className="relative overflow-hidden rounded-[30px] border-[3px] border-ink bg-paper shadow-2xl shadow-ink/20">
          {/* Status bar */}
          <div className="flex items-center justify-between bg-ink px-5 pb-2 pt-2.5">
            <span className="font-data text-[10px] tracking-tight text-paper/60">9:41</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-paper/35" />
              <span className="h-1.5 w-1.5 rounded-full bg-paper/35" />
              <span className="h-1.5 w-1.5 rounded-full bg-paper/70" />
            </span>
          </div>

          {/* App bar */}
          <div className="flex items-center gap-2 border-b border-line bg-paper-grey px-4 py-2.5">
            <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="2" y="2" width="28" height="28" rx="2" fill="none" stroke="#0A1F3C" strokeWidth="2.5" />
              <rect x="7" y="7" width="5" height="5" fill="#0A1F3C" />
              <rect x="20" y="7" width="5" height="5" fill="#0098C7" />
              <rect x="7" y="20" width="5" height="5" fill="#0098C7" />
            </svg>
            <span className="font-display text-[11px] font-bold tracking-tight text-ink">
              PrintQ
            </span>
            <span className="ml-auto truncate font-data text-[10px] text-ink-soft">
              Sharma Xerox
            </span>
          </div>

          {/* Step rail */}
          <div className="flex items-center gap-1.5 px-4 py-3" aria-hidden="true">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-1.5">
                <span
                  className={`h-1 flex-1 transition-colors duration-500 ${
                    i <= step ? "bg-cyan" : "bg-line"
                  }`}
                />
              </div>
            ))}
          </div>

          {/* ── Screen: fixed height so step changes never reflow ── */}
          <div className="relative h-[296px] overflow-hidden px-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.32, ease: EASE }}
                className="absolute inset-x-4 top-0"
              >
                {step === 0 ? <ScanFrame reduced={!!reducedMotion} /> : null}
                {step === 1 ? <UploadFrame reduced={!!reducedMotion} /> : null}
                {step === 2 ? <PayFrame reduced={!!reducedMotion} /> : null}
                {step === 3 ? <PrintFrame reduced={!!reducedMotion} /> : null}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Home indicator */}
          <div className="flex justify-center pb-2.5 pt-1">
            <span className="h-1 w-24 rounded-full bg-line" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Screen-reader description of what the animation depicts. */}
      <p className="sr-only">
        Illustration of the PrintQ customer flow: scanning a shop QR code,
        uploading a document, confirming payment, and the shop printer producing
        the printed page.
      </p>
    </div>
  );
}

/* ── Step 1: QR scan ──────────────────────────────────────────────── */

// Fixed pattern (not random) so server and client markup always match.
const QR_CELLS = [
  "1111111011010001111111",
  "1000001010111001000001",
  "1011101001001101011101",
  "1011101011100101011101",
  "1011101000110101011101",
  "1000001010101101000001",
  "1111111010101011111111",
  "0000000011001100000000",
  "1101011101101010110110",
  "0100110010010111001001",
  "1110101101101000110111",
  "0010010011010111011010",
  "1101110100101001100101",
  "0011001011010110010110",
  "1010110110101001101011",
  "0000000010110101100110",
  "1111111011001011010101",
  "1000001001101100110010",
  "1011101010101011011011",
  "1011101101010010101100",
  "1000001011011101100101",
  "1111111000110100110110",
];

function QrGlyph() {
  const size = 22;
  const cell = 100 / size;
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      {QR_CELLS.map((row, y) =>
        row.split("").map((v, x) =>
          v === "1" ? (
            <rect
              key={`${x}-${y}`}
              x={x * cell}
              y={y * cell}
              width={cell}
              height={cell}
              fill="#0A1F3C"
            />
          ) : null
        )
      )}
    </svg>
  );
}

function ScanFrame({ reduced }: { reduced: boolean }) {
  return (
    <div className="pt-1">
      <FrameHeading label="Step 1" title="Scan the shop QR" />

      <div className="relative mt-4 aspect-square w-full border border-line bg-paper p-5">
        <QrGlyph />

        {/* Viewfinder brackets */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-2">
          <span className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-cyan" />
          <span className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-cyan" />
          <span className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-cyan" />
          <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-cyan" />
        </span>

        {/* Sweeping scan line */}
        {reduced ? null : (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 h-8"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,152,199,0) 0%, rgba(0,152,199,0.22) 60%, rgba(0,152,199,0.9) 100%)",
            }}
            initial={{ top: "8px", opacity: 0 }}
            // Keyframe counts must match `times` entry-for-entry.
            animate={{
              top: ["8px", "24px", "calc(100% - 56px)", "calc(100% - 40px)"],
              opacity: [0, 1, 1, 0],
            }}
            transition={{
              duration: 1.6,
              ease: "linear",
              times: [0, 0.15, 0.85, 1],
              repeat: Infinity,
              repeatDelay: 0.25,
            }}
          />
        )}
      </div>

      <p className="mt-3 text-center text-[11px] leading-snug text-ink-soft">
        Opens in the browser. No app to install.
      </p>
    </div>
  );
}

/* ── Step 2: upload ───────────────────────────────────────────────── */

function UploadFrame({ reduced }: { reduced: boolean }) {
  return (
    <div className="pt-1">
      <FrameHeading label="Step 2" title="Upload your file" />

      <div className="mt-4 border border-line bg-paper-grey p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-cyan/10 text-cyan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">
              Assignment_Final.pdf
            </span>
            <span className="block font-data text-[10px] text-ink-soft">
              4 pages &middot; 1.2 MB
            </span>
          </span>
        </div>

        {/* Progress bar — height reserved, fill animates */}
        <div className="mt-3 h-1.5 w-full overflow-hidden bg-line/60">
          <motion.div
            className="h-full bg-cyan"
            initial={reduced ? { width: "100%" } : { width: "4%" }}
            animate={{ width: "100%" }}
            transition={reduced ? { duration: 0 } : { duration: 2, ease: "easeOut" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between font-data text-[10px] text-ink-soft">
          <span>Uploading</span>
          <span>1.2 / 1.2 MB</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <OptionRow label="Copies" value="2" />
        <OptionRow label="Colour" value={"B&W"} />
        <OptionRow label="Paper" value="A4" />
        <OptionRow label="Sides" value="Double" />
      </div>
    </div>
  );
}

/* ── Step 3: payment ──────────────────────────────────────────────── */

function PayFrame({ reduced }: { reduced: boolean }) {
  return (
    <div className="pt-1">
      <FrameHeading label="Step 3" title="Pay the shop directly" />

      <div className="mt-5 flex flex-col items-center">
        {/* Confirmation tick — the circle and check draw themselves in */}
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
          <circle cx="36" cy="36" r="33" stroke="#EDF1F5" strokeWidth="4" />
          <motion.circle
            cx="36"
            cy="36"
            r="33"
            stroke="#0098C7"
            strokeWidth="4"
            strokeLinecap="round"
            transform="rotate(-90 36 36)"
            initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          />
          <motion.path
            d="M23 37.5 32.5 47 50 27"
            stroke="#0098C7"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={
              reduced ? { duration: 0 } : { duration: 0.35, delay: 0.55, ease: "easeOut" }
            }
          />
        </svg>

        <p className="mt-4 t-numeric text-3xl font-semibold text-ink">&#8377;8.00</p>
        <p className="mt-1 text-[11px] text-ink-soft">Paid to Sharma Xerox via UPI</p>
      </div>

      <div className="mt-5 border border-line bg-paper-grey px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-soft">Your token</span>
          <span className="t-numeric text-base font-bold text-cyan">A042</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-ink-soft">Queue position</span>
          <span className="t-numeric text-[11px] font-medium text-ink">3rd</span>
        </div>
      </div>
    </div>
  );
}

/* ── Step 4: printing ─────────────────────────────────────────────── */

function PrintFrame({ reduced }: { reduced: boolean }) {
  return (
    <div className="pt-1">
      <FrameHeading label="Step 4" title="Printing at the counter" />

      <div className="mt-3 flex justify-center">
        <svg width="180" height="150" viewBox="0 0 180 150" fill="none" aria-hidden="true">
          {/* Page sliding out of the top output slot */}
          <motion.g
            initial={reduced ? { y: 0, opacity: 1 } : { y: 34, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 1.3, delay: 0.35, ease: EASE }}
          >
            <rect x="57" y="6" width="66" height="46" fill="#ffffff" stroke="#0A1F3C" strokeWidth="1.6" />
            <path
              d="M66 18h48M66 26h48M66 34h34"
              stroke="#0098C7"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.65"
            />
            <path d="M66 42h26" stroke="#0A1F3C" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
          </motion.g>

          {/* Printer body */}
          <rect x="34" y="52" width="112" height="52" rx="4" fill="#EDF1F5" stroke="#0A1F3C" strokeWidth="1.8" />
          {/* Output slot — sits over the page so it reads as feeding through */}
          <rect x="52" y="50" width="76" height="7" rx="2" fill="#0A1F3C" />
          {/* Control panel */}
          <rect x="44" y="66" width="30" height="4" rx="2" fill="#0A1F3C" opacity="0.25" />
          <rect x="44" y="74" width="20" height="4" rx="2" fill="#0A1F3C" opacity="0.15" />

          {/* Status LED */}
          <motion.circle
            cx="132"
            cy="70"
            r="4"
            fill="#0098C7"
            initial={{ opacity: 1 }}
            animate={reduced ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
            transition={reduced ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Paper tray */}
          <path d="M46 104h88v14a4 4 0 0 1-4 4H50a4 4 0 0 1-4-4z" fill="#ffffff" stroke="#0A1F3C" strokeWidth="1.8" />
          <path d="M62 104v-6h56v6" stroke="#0A1F3C" strokeWidth="1.6" opacity="0.3" />

          {/* Feet */}
          <path d="M56 122v6M124 122v6" stroke="#0A1F3C" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>

      <div className="mt-2 border border-line bg-paper-grey px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-[11px] font-medium text-ink">Token A042 &middot; printing now</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden bg-line/60">
          <motion.div
            className="h-full bg-cyan"
            initial={reduced ? { width: "100%" } : { width: "12%" }}
            animate={{ width: "100%" }}
            transition={reduced ? { duration: 0 } : { duration: 2.2, ease: "easeOut" }}
          />
        </div>
        <p className="mt-2 text-[10px] leading-snug text-ink-soft">
          File deleted from the shop PC and the server once the job completes.
        </p>
      </div>
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────── */

function FrameHeading({ label, title }: { label: string; title: string }) {
  return (
    <div>
      <p className="font-data text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan">
        {label}
      </p>
      <p className="mt-1 font-display text-[15px] font-bold tracking-[-0.015em] text-ink">
        {title}
      </p>
    </div>
  );
}

function OptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink-soft">{label}</span>
      <span className="border border-line bg-paper px-2.5 py-0.5 font-data text-[11px] text-ink">
        {value}
      </span>
    </div>
  );
}
