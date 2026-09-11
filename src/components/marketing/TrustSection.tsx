import type { ComponentType } from "react";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { Pill, SectionHeading, TextLink } from "./primitives";
import { AutoDeleteIcon, DesktopIcon, ServerIcon, ShieldIcon, UploadIcon } from "./icons";

/**
 * "Privacy by design" — the file lifecycle, stated plainly.
 *
 * The visual argument is the timeline itself: four numbered stages, each one
 * ending in deletion, so the eye reads "nothing is kept" before the copy does.
 */

type Stage = {
  n: string;
  title: string;
  body: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  terminal?: boolean;
};

const STAGES: Stage[] = [
  {
    n: "01",
    title: "Uploaded",
    body: "The customer's file goes into private, per-shop storage. Nobody else's shop — and no public link — can reach it.",
    Icon: UploadIcon,
  },
  {
    n: "02",
    title: "Printed",
    body: "Once payment clears, the agent on your counter PC pulls the file, prints it, and reports the result back.",
    Icon: DesktopIcon,
  },
  {
    n: "03",
    title: "Deleted from the shop PC",
    body: "The working copy on your counter machine is removed as soon as the job finishes. Nothing accumulates on your desktop.",
    Icon: AutoDeleteIcon,
    terminal: true,
  },
  {
    n: "04",
    title: "Deleted from the server",
    body: "The stored original is wiped on the retention schedule you set — as short as you like, 24 hours by default.",
    Icon: ServerIcon,
    terminal: true,
  },
];

export function TrustSection() {
  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
      <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-70" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <AnimatedSection>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              eyebrow="Privacy by design"
              title="Customer files leave no trace"
              lead="Marksheets, Aadhaar copies, medical reports — people hand over sensitive documents at a print counter. PrintQ is built so none of it sticks around."
            />
            <div className="shrink-0 md:pb-1">
              <TextLink href="/privacy">Read the privacy policy</TextLink>
            </div>
          </div>
        </AnimatedSection>

        <StaggerChildren className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
          {STAGES.map(({ n, title, body, Icon, terminal }) => (
            <StaggerItem key={n} className="h-full">
              <div className="relative flex h-full flex-col border border-line bg-paper p-6">
                {/* Stage number + connector notch */}
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-11 w-11 items-center justify-center border ${
                      terminal
                        ? "border-magenta/25 bg-magenta/[0.07] text-magenta"
                        : "border-cyan/25 bg-cyan/[0.07] text-cyan"
                    }`}
                  >
                    <Icon size={21} />
                  </span>
                  <span className="font-data text-xs font-semibold tracking-[0.14em] text-ink-soft/45">
                    {n}
                  </span>
                </div>

                <h3 className="mt-5 text-[15px] font-semibold tracking-[-0.012em] text-ink">
                  {title}
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">{body}</p>

                <div className="mt-5 border-t border-line pt-3.5">
                  <Pill className={terminal ? "!border-magenta/25 !text-magenta" : ""}>
                    {terminal ? "Nothing retained" : "Access-controlled"}
                  </Pill>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerChildren>

        {/* Summary bar */}
        <AnimatedSection delay={0.2}>
          <div className="mt-6 flex flex-col items-start gap-4 border border-ink bg-ink px-6 py-5 sm:flex-row sm:items-center">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-cyan/40 bg-cyan/15 text-cyan">
              <ShieldIcon size={20} />
            </span>
            <p className="flex-1 text-[13.5px] leading-relaxed text-paper/75">
              <span className="font-semibold text-paper">Zero long-term retention.</span>{" "}
              PrintQ keeps the order record — token, pages, amount — for your own
              accounting. The document itself is gone.
            </p>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
