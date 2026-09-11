import type { ComponentType } from "react";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { SectionHeading, TextLink, WindowFrame } from "./primitives";
import { QueueIcon, SettingsIcon, TrayIcon } from "./icons";

/**
 * "What the shop owner sees" — three panels of the desktop software.
 *
 * These are intentionally EMPTY placeholder frames, not fabricated UI. Showing
 * an invented screenshot of software that exists would misrepresent the
 * product; a labelled frame is honest and swaps out cleanly.
 *
 * TODO: replace with real screenshots.
 *   1. Capture each window at 1600×1000 (16:10) on a clean Windows desktop.
 *   2. Drop the files in /public/screenshots/.
 *   3. In each PANEL entry below, set `src` and replace <PlaceholderBody />
 *      with next/image — the frame, caption and aspect ratio stay as-is.
 */

type Panel = {
  id: string;
  chrome: string;
  title: string;
  caption: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const PANELS: Panel[] = [
  {
    id: "settings",
    chrome: "PrintQ Agent — Settings",
    title: "Settings panel",
    caption:
      "Printer defaults, paper sizes, colour and duplex capability, and the retention window for customer files.",
    Icon: SettingsIcon,
  },
  {
    id: "queue",
    chrome: "PrintQ Agent — Live queue",
    title: "Live print queue",
    caption:
      "Every paid order with its token, page count and status. Retry or cancel a job without leaving the window.",
    Icon: QueueIcon,
  },
  {
    id: "tray",
    chrome: "PrintQ Agent — System tray",
    title: "System tray menu",
    caption:
      "Runs quietly in the background. Pause new orders, check connection status, or open the dashboard from the tray.",
    Icon: TrayIcon,
  },
];

export function InsideTheSoftware() {
  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <AnimatedSection>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              eyebrow="Inside the software"
              title="What the shop owner sees"
              lead="One small Windows app on the counter PC. It stays out of the way until an order arrives."
            />
            <div className="shrink-0 md:pb-1">
              <TextLink href="/for-shops">More for shop owners</TextLink>
            </div>
          </div>
        </AnimatedSection>

        <StaggerChildren className="mt-12 grid gap-6 md:grid-cols-3" stagger={0.09}>
          {PANELS.map(({ id, chrome, title, caption, Icon }) => (
            <StaggerItem key={id} className="h-full">
              <figure className="flex h-full flex-col">
                <WindowFrame title={chrome}>
                  {/* Fixed 16:10 box — reserves the exact space a real
                      screenshot will occupy, so swapping it in shifts nothing. */}
                  <div className="relative aspect-[16/10] w-full bg-paper-grey">
                    <PlaceholderBody Icon={Icon} label={title} />
                  </div>
                </WindowFrame>

                <figcaption className="mt-4 flex-1">
                  <h3 className="text-[14.5px] font-semibold tracking-[-0.012em] text-ink">
                    {title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{caption}</p>
                </figcaption>
              </figure>
            </StaggerItem>
          ))}
        </StaggerChildren>

        <AnimatedSection delay={0.2}>
          <p className="mt-8 border-l-2 border-toner-yellow bg-toner-yellow/[0.06] px-4 py-3 font-data text-[11px] leading-relaxed text-ink-soft">
            Placeholder frames — real product screenshots are pending capture.
          </p>
        </AnimatedSection>
      </div>
    </section>
  );
}

/** Empty screenshot placeholder: a labelled frame, not invented UI. */
function PlaceholderBody({
  Icon,
  label,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-dotfield">
      <span className="flex h-12 w-12 items-center justify-center border border-line-strong bg-paper text-ink-soft">
        <Icon size={22} />
      </span>
      <span className="text-center">
        <span className="block font-data text-[10px] uppercase tracking-[0.16em] text-ink-soft/70">
          Screenshot pending
        </span>
        <span className="mt-1 block text-[12px] font-medium text-ink-soft">{label}</span>
      </span>
    </div>
  );
}
