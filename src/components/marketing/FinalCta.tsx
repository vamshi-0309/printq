import { AnimatedSection } from "@/components/ui/AnimatedSection";
import { CtaLink, CornerTicks } from "./primitives";
import { CheckIcon } from "./icons";

const ASSURANCES = [
  "No new hardware",
  "Set up in ~10 minutes",
  "No commission on prints",
];

/** Closing call-to-action band, shared across the marketing pages. */
export function FinalCta({
  title = "Ready to put a QR code on your counter?",
  body = "Your customers scan, upload, pay and collect — while you get on with running the shop.",
  primaryHref = "/pricing",
  primaryLabel = "Get PrintQ for your shop",
  secondaryHref = "/how-it-works",
  secondaryLabel = "See how it works",
}: {
  title?: string;
  body?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="relative overflow-x-clip bg-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-80 bg-blueprint-dark"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] max-w-full -translate-x-1/2 opacity-25 blur-3xl"
        style={{ background: "radial-gradient(ellipse at top, #0098C7 0%, transparent 65%)" }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-3xl px-5 py-16 text-center sm:px-6 md:py-24">
        <AnimatedSection>
          <div className="relative inline-block px-6 py-2">
            <CornerTicks />
            <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.2em] text-cyan">
              Get started
            </p>
          </div>

          <h2 className="mx-auto mt-6 max-w-2xl font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.03em] text-paper md:text-[2.75rem]">
            {title}
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-paper/65">
            {body}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <CtaLink href={primaryHref} variant="onDark" size="lg" withArrow>
              {primaryLabel}
            </CtaLink>
            <CtaLink href={secondaryHref} variant="onDarkGhost" size="lg">
              {secondaryLabel}
            </CtaLink>
          </div>

          <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-paper/10 pt-7">
            {ASSURANCES.map((a) => (
              <li key={a} className="flex items-center gap-2 text-[12.5px] text-paper/60">
                <CheckIcon size={14} className="shrink-0 text-cyan" />
                {a}
              </li>
            ))}
          </ul>
        </AnimatedSection>
      </div>
    </section>
  );
}
