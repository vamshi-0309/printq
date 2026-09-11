"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading, CtaLink } from "./primitives";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  DesktopIcon,
  PrinterIcon,
  QrIcon,
  SettingsIcon,
  SoundOffIcon,
  SoundOnIcon,
} from "./icons";

/**
 * "See the full setup in 2 minutes" walkthrough.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  ▶  WHERE THE REAL VIDEO GOES                                    │
 * │                                                                  │
 * │  There is no screen recording yet, so the 16:9 stage below is    │
 * │  filled with an auto-advancing carousel of illustrated frames.   │
 * │                                                                  │
 * │  To drop in a real recording later, search this file for the     │
 * │  marker line "VIDEO SWAP POINT" and replace ONLY the element     │
 * │  between the two markers — swap <IllustratedStage /> for:        │
 * │                                                                  │
 * │      <video                                                      │
 * │        className="h-full w-full object-cover"                    │
 * │        poster="/setup-poster.jpg"                                │
 * │        src="/setup.mp4"                                          │
 * │        muted={muted} autoPlay loop playsInline                   │
 * │      />                                                          │
 * │                                                                  │
 * │  The surrounding stage keeps its aspect ratio, so nothing else   │
 * │  needs to change. The sound toggle below is already wired to     │
 * │  `muted` state and is a deliberate no-op until then.             │
 * └──────────────────────────────────────────────────────────────────┘
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const FRAME_MS = 4200;

type Frame = {
  id: string;
  step: string;
  title: string;
  body: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  art: React.ReactNode;
};

export function HowToSetup() {
  const reducedMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.4 });

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Dead affordance today — becomes the real <video> mute control later.
  const [muted, setMuted] = useState(true);

  const frames = FRAMES;
  const count = frames.length;

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count]
  );

  const autoplay = !reducedMotion && inView && !paused;

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), FRAME_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, index, count]);

  const active = frames[index];

  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
      <div
        className="pointer-events-none absolute inset-0 bg-blueprint opacity-60"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            eyebrow="Setup walkthrough"
            title="See the full setup in 2 minutes"
            lead="From installing the agent to your first automatic print. No new hardware, no technician visit."
          />
          <div className="shrink-0">
            <CtaLink href="/how-it-works" variant="secondary" withArrow>
              Read the full guide
            </CtaLink>
          </div>
        </div>

        {/* `min-w-0` on both tracks: grid items default to min-width:auto, so
            without it the stage's chrome bar and the step text force the
            column wider than the viewport on small screens. */}
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
          {/* ── Stage ── */}
          <div className="min-w-0">
            <div
              ref={stageRef}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocusCapture={() => setPaused(true)}
              onBlurCapture={() => setPaused(false)}
              className="relative overflow-hidden border border-line-strong bg-ink shadow-2xl shadow-ink/15"
            >
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-paper/10 bg-ink-deep px-3 py-2.5">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-paper/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-paper/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-paper/20" />
                </span>
                <span className="min-w-0 flex-1 truncate font-data text-[11px] text-paper/45">
                  PrintQ setup — illustrated walkthrough
                </span>
                <span className="shrink-0 border border-paper/15 px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.12em] text-paper/40">
                  Preview
                </span>
              </div>

              {/* 16:9 stage — ratio is fixed, so no layout shift between frames
                  and a real <video> drops straight in at the same size. */}
              <div className="relative aspect-[16/10] w-full sm:aspect-[16/9]">
                {/* ▼ VIDEO SWAP POINT ▼
                    Replace this <IllustratedStage> with the <video> element
                    described in the block comment at the top of this file.
                    Everything outside this element is video-ready already. */}
                <IllustratedStage frames={frames} index={index} reduced={!!reducedMotion} />
                {/* ▲ VIDEO SWAP POINT ▲ */}
              </div>

              {/* Transport bar */}
              <div className="flex items-center gap-3 border-t border-paper/10 bg-ink-deep px-3 py-2.5">
                <div className="flex shrink-0 items-center gap-1">
                  <TransportButton label="Previous step" onClick={() => go(index - 1)}>
                    <ArrowLeftIcon size={15} />
                  </TransportButton>
                  <TransportButton label="Next step" onClick={() => go(index + 1)}>
                    <ArrowRightIcon size={15} />
                  </TransportButton>
                </div>

                {/* Progress bar */}
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {frames.map((f, i) => (
                    <span
                      key={f.id}
                      className="relative h-1 flex-1 overflow-hidden bg-paper/15"
                    >
                      {i < index ? <span className="absolute inset-0 bg-cyan" /> : null}
                      {i === index ? (
                        <motion.span
                          key={`${f.id}-${index}-${autoplay}`}
                          className="absolute inset-y-0 left-0 bg-cyan"
                          initial={{ width: autoplay ? "0%" : "100%" }}
                          animate={{ width: "100%" }}
                          transition={{
                            duration: autoplay ? FRAME_MS / 1000 : 0,
                            ease: "linear",
                          }}
                        />
                      ) : null}
                    </span>
                  ))}
                </div>

                <span className="shrink-0 font-data text-[10px] tabular-nums text-paper/40">
                  {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
                </span>

                {/*
                  Sound toggle: intentionally inert. It exists so the control
                  layout is final — when the real <video> lands, bind this
                  `muted` state to the element's `muted` prop and nothing about
                  the layout changes.
                */}
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-pressed={!muted}
                  aria-label={muted ? "Turn sound on" : "Turn sound off"}
                  title="Sound will be available with the recorded walkthrough"
                  className="flex h-7 w-7 shrink-0 items-center justify-center text-paper/40 transition-colors hover:text-paper/80"
                >
                  {muted ? <SoundOffIcon size={15} /> : <SoundOnIcon size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* ── Step list ── */}
          <ol className="flex min-w-0 flex-col gap-1">
            {frames.map((f, i) => {
              const isActive = i === index;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={isActive ? "step" : undefined}
                    className={`group flex w-full items-start gap-3.5 border-l-2 px-4 py-3.5 text-left transition-colors ${
                      isActive
                        ? "border-cyan bg-paper shadow-sm shadow-ink/5"
                        : "border-line bg-transparent hover:border-line-strong hover:bg-paper/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center transition-colors ${
                        isActive ? "bg-cyan text-paper" : "bg-paper text-ink-soft"
                      }`}
                    >
                      <f.Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-data text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan">
                        {f.step}
                      </span>
                      <span className="mt-1 block text-[14px] font-semibold tracking-[-0.01em] text-ink">
                        {f.title}
                      </span>
                      <span
                        className={`mt-1 block text-[12.5px] leading-relaxed text-ink-soft ${
                          isActive ? "" : "hidden sm:block"
                        }`}
                      >
                        {f.body}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Live region so screen-reader users are told which step is showing */}
        <p className="sr-only" aria-live="polite">
          Step {index + 1} of {count}: {active.title}
        </p>
      </div>
    </section>
  );
}

function TransportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center border border-paper/15 text-paper/60 transition-colors hover:border-paper/40 hover:text-paper"
    >
      {children}
    </button>
  );
}

/* ── The illustrated carousel that stands in for the video ────────── */

function IllustratedStage({
  frames,
  index,
  reduced,
}: {
  frames: Frame[];
  index: number;
  reduced: boolean;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-blueprint-dark"
        aria-hidden="true"
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={frames[index].id}
          initial={reduced ? false : { opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0, scale: 1.01 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="absolute inset-0 flex items-center justify-center p-5 sm:p-8"
        >
          {frames[index].art}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ── Illustrated frames ───────────────────────────────────────────── */

/** Shared inner "app panel" look for the illustrated frames. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md border border-paper/15 bg-paper/[0.04] backdrop-blur-[2px]">
      <div className="flex items-center justify-between border-b border-paper/10 px-3.5 py-2">
        <span className="font-data text-[10px] uppercase tracking-[0.14em] text-cyan">
          {title}
        </span>
        <span className="h-1.5 w-1.5 bg-cyan" aria-hidden="true" />
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-paper/[0.07] py-2 last:border-b-0">
      <span className="text-[12px] text-paper/55">{label}</span>
      <span
        className={`font-data text-[11px] ${
          accent ? "border border-cyan/40 bg-cyan/15 px-2 py-0.5 text-cyan" : "text-paper/85"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const FRAMES: Frame[] = [
  {
    id: "install",
    step: "Step 01",
    title: "Install the print agent",
    body: "One small download for the Windows PC already sitting at your counter.",
    Icon: DesktopIcon,
    art: (
      <Panel title="PrintQ Agent · Installer">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-cyan/40 bg-cyan/15 text-cyan">
            <DesktopIcon size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-paper">
              PrintQ-Agent-Setup.exe
            </span>
            <span className="block font-data text-[10px] text-paper/45">
              Windows 10 / 11 &middot; 18 MB
            </span>
          </span>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden bg-paper/10">
          <span className="block h-full w-[78%] bg-cyan" />
        </div>
        <p className="mt-2 font-data text-[10px] text-paper/45">
          Installing services… 78%
        </p>
      </Panel>
    ),
  },
  {
    id: "settings",
    step: "Step 02",
    title: "Set your prices",
    body: "Per-page rates for each paper size, colour mode and duplex option. Your rates, your margins.",
    Icon: SettingsIcon,
    art: (
      <Panel title="Settings · Pricing">
        <Row label="A4 · B&amp;W · single" value="&#8377;2.00" />
        <Row label="A4 · Colour · single" value="&#8377;10.00" />
        <Row label="A3 · B&amp;W · duplex" value="&#8377;6.00" />
        <Row label="Minimum order" value="&#8377;5.00" accent />
      </Panel>
    ),
  },
  {
    id: "pair",
    step: "Step 03",
    title: "Pair your shop QR",
    body: "Enter the pairing code from your dashboard once. The agent binds to your shop permanently.",
    Icon: QrIcon,
    art: (
      <Panel title="Pair device">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center border border-paper/15 bg-paper/[0.06] text-cyan">
            <QrIcon size={32} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-data text-[10px] uppercase tracking-[0.14em] text-paper/45">
              Pairing code
            </span>
            <span className="mt-1 block t-numeric text-2xl font-bold tracking-[0.12em] text-paper">
              7K4 · 92B
            </span>
            <span className="mt-1.5 block font-data text-[10px] text-paper/45">
              Expires in 09:41
            </span>
          </span>
        </div>
      </Panel>
    ),
  },
  {
    id: "printer",
    step: "Step 04",
    title: "Pick your printer",
    body: "The agent lists every printer installed on the PC. Choose a default and set its capabilities.",
    Icon: PrinterIcon,
    art: (
      <Panel title="Printers detected">
        <Row label="HP LaserJet M1136" value="Default" accent />
        <Row label="Canon LBP2900B" value="Enabled" />
        <Row label="Epson L3210 (colour)" value="Enabled" />
        <Row label="Microsoft Print to PDF" value="Ignored" />
      </Panel>
    ),
  },
  {
    id: "first-print",
    step: "Step 05",
    title: "Take your first order",
    body: "A customer scans, pays, and the job lands on your printer — no file transfer, no chat.",
    Icon: CheckCircleIcon,
    art: (
      <Panel title="Live queue">
        <div className="flex items-center gap-3 border border-cyan/30 bg-cyan/10 px-3 py-2.5">
          <span className="t-numeric text-lg font-bold text-cyan">A042</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-paper">
              Assignment_Final.pdf
            </span>
            <span className="block font-data text-[10px] text-paper/45">
              4 pages &middot; 2 copies &middot; A4 B&amp;W
            </span>
          </span>
          <span className="shrink-0 text-emerald-400">
            <CheckCircleIcon size={18} />
          </span>
        </div>
        <Row label="A041 · Resume.pdf" value="Printed" />
        <Row label="A040 · Marksheet.jpg" value="Printed" />
      </Panel>
    ),
  },
];
