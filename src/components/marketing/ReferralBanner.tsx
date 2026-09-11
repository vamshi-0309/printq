import { AnimatedSection } from "@/components/ui/AnimatedSection";
import { CtaLink } from "./primitives";
import { ShopIcon } from "./icons";

/** Slim partner/referral strip. Links to the /partner stub. */
export function ReferralBanner() {
  return (
    <section className="relative overflow-x-clip border-t border-line bg-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-blueprint-dark"
        aria-hidden="true"
      />
      {/* Magenta accent — used sparingly, and this is one of the few places. */}
      <div
        className="pointer-events-none absolute -left-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #D6006E 0%, transparent 70%)" }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-5 py-10 sm:px-6 md:py-12">
        <AnimatedSection>
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-magenta/40 bg-magenta/15 text-magenta">
                <ShopIcon size={21} />
              </span>
              <div>
                <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.18em] text-magenta">
                  Partner programme
                </p>
                <h2 className="mt-2 font-display text-xl font-bold tracking-[-0.022em] text-paper sm:text-2xl">
                  Become a PrintQ partner — earn for every shop you refer
                </h2>
                <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-paper/65">
                  Know print shops in your area? Introduce them to PrintQ and earn on
                  every shop that goes live.
                </p>
              </div>
            </div>

            <div className="shrink-0 md:pl-6">
              <CtaLink href="/partner" variant="onDark" size="lg" withArrow>
                Become a partner
              </CtaLink>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
