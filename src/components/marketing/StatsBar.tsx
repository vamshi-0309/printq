"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import { GaugeIcon, IndiaFlagIcon, PagesIcon, ShopIcon } from "./icons";

/**
 * Full-width stat strip below the hero.
 *
 * Numbers count up once, when the strip scrolls into view. Under
 * `prefers-reduced-motion` the final value is rendered immediately.
 *
 * Placeholder figures — replace with real numbers before launch.
 */

type Stat = {
  value: number;
  suffix?: string;
  decimals?: number;
  label: string;
  sub: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const STATS: Stat[] = [
  { value: 376, suffix: "+", label: "Shops onboarded", sub: "and counting", Icon: ShopIcon },
  { value: 1.4, suffix: "M+", decimals: 1, label: "Pages printed", sub: "through PrintQ", Icon: PagesIcon },
  { value: 99.5, suffix: "%", decimals: 1, label: "Agent uptime", sub: "last 90 days", Icon: GaugeIcon },
];

export function StatsBar() {
  return (
    <section className="relative border-y border-line bg-ink text-paper">
      <div
        className="pointer-events-none absolute inset-0 opacity-60 bg-blueprint-dark"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid divide-y divide-paper/10 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x lg:divide-paper/10">
          {STATS.map((s, i) => (
            <StatCell key={s.label} stat={s} index={i} />
          ))}

          {/* Made in India chip */}
          <div className="flex items-center gap-3.5 px-0 py-6 sm:px-0 lg:px-7">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-paper/15 bg-paper/5">
              <IndiaFlagIcon size={20} />
            </span>
            <span className="block">
              <span className="block font-display text-xl font-bold tracking-[-0.02em] text-paper">
                Made in India
              </span>
              <span className="mt-1 block font-data text-[11px] tracking-[0.04em] text-paper/55">
                Built for Indian print shops
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCell({ stat, index }: { stat: Stat; index: number }) {
  const { Icon } = stat;
  return (
    <div
      className={`flex items-center gap-3.5 py-6 lg:px-7 ${index === 0 ? "lg:pl-0" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-cyan/30 bg-cyan/10 text-cyan">
        <Icon size={19} />
      </span>
      <span className="block">
        <span className="flex items-baseline gap-0.5">
          <CountUp
            value={stat.value}
            decimals={stat.decimals ?? 0}
            delay={index * 0.09}
          />
          {stat.suffix ? (
            <span className="t-numeric text-xl font-bold text-cyan">{stat.suffix}</span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] font-semibold tracking-[-0.01em] text-paper">
          {stat.label}
        </span>
        <span className="block font-data text-[11px] tracking-[0.04em] text-paper/55">
          {stat.sub}
        </span>
      </span>
    </div>
  );
}

function CountUp({
  value,
  decimals,
  delay,
}: {
  value: number;
  decimals: number;
  delay: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reducedMotion = useReducedMotion();

  // The counter writes straight to the DOM node rather than going through
  // React state: no re-render per frame, and no setState inside an effect.
  // React only ever renders the resting value ("0", or the final figure when
  // motion is off), so the imperative text is never clobbered.
  useEffect(() => {
    if (reducedMotion || !inView) return;
    const node = ref.current;
    if (!node) return;
    const controls = animate(0, value, {
      duration: 1.15,
      delay,
      ease: "easeOut",
      onUpdate: (v) => {
        node.textContent = v.toFixed(decimals);
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, delay, reducedMotion]);

  return (
    // `tabular-nums` (via t-numeric) keeps the width stable while counting,
    // so neighbouring text never jitters.
    <span ref={ref} className="t-numeric text-3xl font-bold text-paper">
      {(reducedMotion ? value : 0).toFixed(decimals)}
    </span>
  );
}
