import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import {
  FinalCta,
  PricingSection,
  ReferralBanner,
  SectionHeading,
  TextLink,
} from "@/components/marketing";
import {
  AutoDeleteIcon,
  DirectPayIcon,
  PrinterIcon,
  RupeeIcon,
} from "@/components/marketing/icons";

export const metadata = {
  title: "Pricing",
  description:
    "One setup fee with 12 months included, then a simple renewal. No per-print charges, no commission — customer payments go straight to your own account.",
};

const MONEY_FLOW = [
  {
    title: "PrintQ charges you",
    body: "For the software, setup and support — the one-time setup fee and, after your first year, the renewal. That's the entire relationship.",
    Icon: RupeeIcon,
    accent: "cyan" as const,
  },
  {
    title: "Customers pay you",
    body: "The money your customers pay to print goes directly to your own UPI ID or payment account. PrintQ does not hold, route or deduct from it.",
    Icon: DirectPayIcon,
    accent: "magenta" as const,
  },
];

const INCLUDED_ALWAYS = [
  {
    title: "Unlimited orders",
    body: "No cap on how many print jobs run through your shop, on any plan.",
    Icon: PrinterIcon,
  },
  {
    title: "Unlimited printers",
    body: "Connect every printer on the counter PC and set capabilities per device.",
    Icon: PrinterIcon,
  },
  {
    title: "File auto-deletion",
    body: "Customer documents are wiped from the shop PC and server after printing.",
    Icon: AutoDeleteIcon,
  },
];

const PRICING_FAQS = [
  {
    q: "Is there a commission on each print?",
    a: "No. PrintQ charges only the setup fee and the renewal. What customers pay for prints is entirely yours.",
  },
  {
    q: "What happens after 12 months?",
    a: "You move onto a renewal plan — monthly or yearly, whichever suits you. Your QR code, dashboard and setup carry over unchanged.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, any time. Your existing setup keeps working until the plan you've paid for runs out.",
  },
  {
    q: "Do I need to buy anything else?",
    a: "No. PrintQ runs on the Windows PC and printer you already have at the counter.",
  },
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader announcement />
      <main className="flex-1">
        <PricingSection
          as="h1"
          eyebrow="Pricing"
          heading="Simple pricing, no commissions"
          lead="One setup cost, then a small renewal after your first year. Nothing else. What your customers pay for prints always goes straight to your own account."
        />

        {/* ── Included on every plan ── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
          <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="On every plan"
                title="Nothing important is gated"
                lead="There is no cheaper tier that quietly drops the things a print counter actually needs."
              />
            </AnimatedSection>

            <StaggerChildren className="mt-12 grid gap-5 md:grid-cols-3" stagger={0.08}>
              {INCLUDED_ALWAYS.map(({ title, body, Icon }) => (
                <StaggerItem key={title} className="h-full">
                  <div className="flex h-full flex-col border border-line bg-paper p-6">
                    <span className="flex h-11 w-11 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                      <Icon size={21} />
                    </span>
                    <h3 className="mt-5 text-[15px] font-semibold tracking-[-0.012em] text-ink">
                      {title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        {/* ── Where the money goes ── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="Money flow"
                title="What customers pay, and who it goes to"
                lead="Two separate flows that never touch each other."
              />
            </AnimatedSection>

            <StaggerChildren className="mt-12 grid gap-6 md:grid-cols-2" stagger={0.1}>
              {MONEY_FLOW.map(({ title, body, Icon, accent }) => (
                <StaggerItem key={title} className="h-full">
                  <div
                    className={`flex h-full gap-5 border-l-2 bg-paper-grey/60 p-6 sm:p-7 ${
                      accent === "cyan" ? "border-cyan" : "border-magenta"
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center border ${
                        accent === "cyan"
                          ? "border-cyan/25 bg-cyan/[0.07] text-cyan"
                          : "border-magenta/25 bg-magenta/[0.07] text-magenta"
                      }`}
                    >
                      <Icon size={21} />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-semibold tracking-[-0.012em] text-ink">
                        {title}
                      </h3>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        {/* ── Pricing FAQ ── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <SectionHeading
                  eyebrow="Pricing FAQ"
                  title="Questions about the money"
                  size="md"
                />
                <div className="shrink-0 md:pb-1">
                  <TextLink href="/faq">See all questions</TextLink>
                </div>
              </div>
            </AnimatedSection>

            <StaggerChildren
              className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-2"
              stagger={0.07}
            >
              {PRICING_FAQS.map(({ q, a }) => (
                <StaggerItem key={q} className="bg-paper">
                  <div className="h-full p-6">
                    <h3 className="text-[14.5px] font-semibold leading-snug tracking-[-0.012em] text-ink">
                      {q}
                    </h3>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-ink-soft">{a}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        <ReferralBanner />

        <FinalCta
          title="Get PrintQ for your shop"
          body="Set up in under 10 minutes on the PC and printer you already have. Start accepting QR print orders today."
          primaryHref="/contact"
          primaryLabel="Contact us to set up"
          secondaryHref="/for-shops"
          secondaryLabel="PrintQ for shops"
        />
      </main>
      <SiteFooter />
    </>
  );
}
