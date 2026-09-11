"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { CtaLink } from "./primitives";
import { HeroDevice } from "./HeroDevice";
import {
  CheckCircleIcon,
  PrinterIcon,
  QrIcon,
  RupeeIcon,
  ShopIcon,
  UploadIcon,
} from "./icons";

const EASE = [0.22, 1, 0.36, 1] as const;

const PROCESS = [
  { label: "Scan", Icon: QrIcon },
  { label: "Upload", Icon: UploadIcon },
  { label: "Pay", Icon: RupeeIcon },
  { label: "Auto print", Icon: PrinterIcon },
];

export function Hero() {
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // Parallax for the floating chips. Subtle by design — a few dozen pixels
  // across the whole hero, never enough to detach them from the device.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const driftSlow = useTransform(scrollYProgress, [0, 1], [0, -46]);
  const driftFast = useTransform(scrollYProgress, [0, 1], [0, -84]);
  const driftDown = useTransform(scrollYProgress, [0, 1], [0, 38]);

  const stagger = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  };
  const item = reducedMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: { opacity: 0, y: 18 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
      };

  return (
    <section ref={sectionRef} className="relative overflow-x-clip">
      {/* Blueprint grid, faded at the edges so it never ends on a hard line */}
      <div
        className="pointer-events-none absolute inset-0 bg-blueprint mask-fade-edges"
        aria-hidden="true"
      />
      {/* Soft cyan wash top-right */}
      <div
        className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full opacity-[0.13] blur-3xl"
        style={{ background: "radial-gradient(circle, #0098C7 0%, transparent 68%)" }}
        aria-hidden="true"
      />

      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-12 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:items-center md:gap-10 md:pb-28 md:pt-20 lg:gap-16">
        {/* ── Left column ── */}
        <motion.div variants={stagger} initial="hidden" animate="visible">
          <motion.div variants={item} className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-2 border border-cyan/25 bg-cyan/[0.07] px-2.5 py-1">
              <span className="h-1.5 w-1.5 bg-cyan" aria-hidden="true" />
              <span className="font-data text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan">
                For Xerox &amp; photocopy shops
              </span>
            </span>
          </motion.div>

          <motion.h1 variants={item} className="mt-5 t-display-xl">
            Turn your Xerox shop into a{" "}
            <span className="ink-highlight">
              <span>QR-powered</span>
            </span>{" "}
            print counter.
          </motion.h1>

          <motion.p variants={item} className="mt-5 max-w-lg t-lead">
            Customers scan your QR, upload their document, pay you directly, and get a
            token number. The job prints on your counter automatically — no app, no
            pendrives, no commission.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-8 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center"
          >
            <CtaLink href="/pricing" variant="primary" size="lg" withArrow>
              Get PrintQ
            </CtaLink>
            <CtaLink href="/how-it-works" variant="secondary" size="lg">
              See how it works
            </CtaLink>
          </motion.div>

          {/* Process labels */}
          <motion.ol
            variants={item}
            className="mt-10 grid max-w-xl grid-cols-2 gap-x-4 gap-y-5 border-t border-line pt-6 sm:grid-cols-4 sm:gap-x-3"
          >
            {PROCESS.map(({ label, Icon }, i) => (
              <li key={label} className="relative flex min-w-0 items-center gap-2.5 sm:block">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-line bg-paper text-cyan shadow-sm shadow-ink/5">
                  <Icon size={17} />
                </span>
                <span className="sm:mt-2.5 sm:block">
                  <span className="block font-data text-[10px] font-semibold tracking-[0.12em] text-ink-soft/70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="block text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    {label}
                  </span>
                </span>
                {/* Connector arrow between steps, desktop only */}
                {i < PROCESS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-9 top-[18px] hidden h-px w-[calc(100%-2.25rem)] bg-line sm:block"
                  />
                ) : null}
              </li>
            ))}
          </motion.ol>
        </motion.div>

        {/* ── Right column: illustrated device ── */}
        <div className="relative flex justify-center lg:pr-6">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="relative"
          >
            {/* Ink panel behind the phone, offset like a printed registration mark */}
            <span
              aria-hidden="true"
              className="absolute -bottom-6 -right-6 hidden h-[78%] w-[78%] border border-line bg-paper-grey sm:block"
            />
            <span
              aria-hidden="true"
              className="absolute -left-8 -top-8 hidden h-24 w-24 bg-dotfield opacity-70 sm:block"
            />

            <div className="relative">
              <HeroDevice />
            </div>

            {/* ── Floating trust chips (parallax) ── */}
            <motion.div
              style={reducedMotion ? undefined : { y: driftFast }}
              className="absolute top-[36%] right-[calc(100%-20px)] z-20 hidden w-[178px] lg:block"
            >
              <FloatChip
                icon={<CheckCircleIcon size={15} />}
                title="File deleted after print"
                sub="Server + shop PC"
              />
            </motion.div>

            <motion.div
              style={reducedMotion ? undefined : { y: driftSlow }}
              className="absolute -top-6 left-[calc(100%-20px)] z-20 hidden w-[178px] lg:block"
            >
              <FloatChip
                icon={<ShopIcon size={15} />}
                title="376+ shops"
                sub="Onboarding across India"
                accent
              />
            </motion.div>

            <motion.div
              style={reducedMotion ? undefined : { y: driftDown }}
              className="absolute bottom-8 right-[calc(100%-20px)] z-20 hidden w-[178px] lg:block"
            >
              <FloatChip
                icon={<RupeeIcon size={15} />}
                title="0% commission"
                sub="Straight to your UPI"
              />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FloatChip({
  icon,
  title,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 border bg-paper/95 px-3 py-2.5 shadow-lg shadow-ink/10 backdrop-blur-sm ${
        accent ? "border-cyan/35" : "border-line"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center ${
          accent ? "bg-cyan text-paper" : "bg-cyan/10 text-cyan"
        }`}
      >
        {icon}
      </span>
      <span className="block">
        <span className="block text-[12px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {title}
        </span>
        <span className="mt-0.5 block font-data text-[10px] leading-tight text-ink-soft">
          {sub}
        </span>
      </span>
    </div>
  );
}
