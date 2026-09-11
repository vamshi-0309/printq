import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { CtaLink, FinalCta, SectionHeading } from "@/components/marketing";
import { BoltIcon, RupeeIcon, ShopIcon } from "@/components/marketing/icons";

export const metadata = {
  title: "Partner programme",
  description:
    "Refer Xerox and photocopy shops to PrintQ and earn for every shop that goes live.",
};

/**
 * STUB PAGE — content is placeholder.
 *
 * The referral banner links here, so the page exists and matches the site's
 * visual language, but the commercial terms (rates, payout schedule, tiers,
 * agreement) are still TBD. Replace the copy below once they're settled.
 */

const STEPS = [
  {
    n: "01",
    title: "Introduce a shop",
    body: "Tell us about a Xerox or photocopy shop that would benefit from a QR print counter.",
    Icon: ShopIcon,
  },
  {
    n: "02",
    title: "We handle setup",
    body: "Our team demos PrintQ, installs the agent and configures their printers and rates.",
    Icon: BoltIcon,
  },
  {
    n: "03",
    title: "You get paid",
    body: "Earn a referral payout for every shop that completes setup and goes live.",
    Icon: RupeeIcon,
  },
];

export default function PartnerPage() {
  return (
    <>
      <SiteHeader announcement />
      <main className="flex-1">
        <section className="relative overflow-x-clip border-b border-line bg-paper">
          <div
            className="pointer-events-none absolute inset-0 bg-blueprint mask-fade-edges"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <div className="max-w-2xl">
                <p className="t-eyebrow flex items-center gap-2.5">
                  <span aria-hidden="true" className="inline-block h-px w-6 bg-cyan/40" />
                  Partner programme
                </p>
                <h1 className="mt-3.5 t-display-lg">
                  Earn for every shop you bring to PrintQ
                </h1>
                <p className="mt-4 t-lead">
                  If you already know print shop owners — as a supplier, a technician, or
                  simply a regular customer — introduce them to PrintQ and earn on every
                  shop that goes live.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <CtaLink href="/contact" variant="primary" size="lg" withArrow>
                    Register interest
                  </CtaLink>
                  <CtaLink href="/how-it-works" variant="secondary" size="lg">
                    See how PrintQ works
                  </CtaLink>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </section>

        <section className="relative overflow-x-clip bg-paper-grey">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="How it works"
                title="Three steps, no paperwork on your side"
              />
            </AnimatedSection>

            <StaggerChildren
              className="mt-12 grid gap-px border border-line bg-line md:grid-cols-3"
              stagger={0.09}
            >
              {STEPS.map(({ n, title, body, Icon }) => (
                <StaggerItem key={n} className="bg-paper">
                  <div className="h-full p-6 sm:p-7">
                    <div className="flex items-start justify-between">
                      <span className="flex h-11 w-11 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                        <Icon size={21} />
                      </span>
                      <span className="font-data text-xs font-semibold tracking-[0.14em] text-ink-soft/40">
                        {n}
                      </span>
                    </div>
                    <h2 className="mt-5 text-[15px] font-semibold tracking-[-0.012em] text-ink">
                      {title}
                    </h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>

            {/* Placeholder marker — remove once terms are finalised. */}
            <AnimatedSection delay={0.2}>
              <div className="mt-8 border-l-2 border-toner-yellow bg-toner-yellow/[0.06] px-5 py-4">
                <p className="font-data text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
                  Details coming soon
                </p>
                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
                  Payout rates, tiers and the partner agreement are still being finalised.
                  Register your interest and we&apos;ll send you the full terms as soon as
                  they&apos;re published.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </section>

        <FinalCta
          title="Want to partner with PrintQ?"
          body="Tell us a bit about yourself and the shops you'd introduce. We'll get back to you with the programme details."
          primaryHref="/contact"
          primaryLabel="Register interest"
          secondaryHref="/for-shops"
          secondaryLabel="PrintQ for shops"
        />
      </main>
      <SiteFooter />
    </>
  );
}
