import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { CtaLink, SectionHeading } from "./primitives";
import {
  BankBadgeIcon,
  CardBadgeIcon,
  CheckIcon,
  LockBadgeIcon,
  UpiBadgeIcon,
} from "./icons";

/**
 * Pricing tiers.
 *
 * Deliberately plain: no strikethrough "was ₹X", no countdown, no promo
 * banner. The only emphasis is a "Best value" ribbon on the recommended tier,
 * which describes the plan rather than dangling a discount.
 */

type Tier = {
  id: string;
  name: string;
  blurb: string;
  amount: string;
  unit: string;
  note: string;
  cta: string;
  href: string;
  features: string[];
  recommended?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "setup",
    name: "Setup",
    blurb: "Everything needed to go live, once.",
    amount: "7,500",
    unit: "one-time",
    note: "Includes the first 12 months of service.",
    cta: "Start setup",
    href: "/contact",
    features: [
      "PrintQ software for your shop",
      "Your shop's permanent QR code",
      "Branded customer print page",
      "Shop dashboard and order queue",
      "Windows print agent, installed and configured",
      "Printer setup and test print",
      "Your own pricing configuration",
      "12 months of support included",
    ],
  },
  {
    id: "yearly",
    name: "Yearly renewal",
    blurb: "After your first 12 months.",
    amount: "4,000",
    unit: "per year",
    note: "Billed once a year.",
    cta: "Choose yearly",
    href: "/contact",
    recommended: true,
    features: [
      "Dashboard and order queue stay active",
      "Print agent updates and fixes",
      "Priority support response",
      "Unlimited orders and printers",
      "No per-print or commission fees",
      "Cancel any time",
    ],
  },
  {
    id: "monthly",
    name: "Monthly renewal",
    blurb: "After your first 12 months.",
    amount: "500",
    unit: "per month",
    note: "Billed every month.",
    cta: "Choose monthly",
    href: "/contact",
    features: [
      "Dashboard and order queue stay active",
      "Print agent updates and fixes",
      "Standard support response",
      "Unlimited orders and printers",
      "No per-print or commission fees",
      "Cancel any time",
    ],
  },
];

const PAYMENT_BADGES = [
  { label: "UPI", Icon: UpiBadgeIcon },
  { label: "Cards", Icon: CardBadgeIcon },
  { label: "Net banking", Icon: BankBadgeIcon },
  { label: "Encrypted", Icon: LockBadgeIcon },
];

export function PricingSection({
  heading = "Simple pricing, no commissions",
  eyebrow = "Pricing",
  lead = "One setup cost, then a small renewal after your first year. Nothing else. What your customers pay for prints always goes straight to your own account.",
  as = "h2",
}: {
  heading?: string;
  eyebrow?: string;
  lead?: string;
  /** Use "h1" when this section is the page's primary heading. */
  as?: "h1" | "h2";
}) {
  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <AnimatedSection>
          {as === "h1" ? (
            <div className="max-w-2xl">
              <p className="t-eyebrow flex items-center gap-2.5">
                <span aria-hidden="true" className="inline-block h-px w-6 bg-cyan/40" />
                {eyebrow}
              </p>
              <h1 className="mt-3.5 t-display-lg">{heading}</h1>
              <p className="mt-4 t-lead">{lead}</p>
            </div>
          ) : (
            <SectionHeading eyebrow={eyebrow} title={heading} lead={lead} />
          )}
        </AnimatedSection>

        <StaggerChildren className="mt-12 grid gap-6 lg:grid-cols-3" stagger={0.09}>
          {TIERS.map((tier) => (
            <StaggerItem key={tier.id} className="h-full">
              <TierCard tier={tier} />
            </StaggerItem>
          ))}
        </StaggerChildren>

        {/* ── Payment trust row ── */}
        <AnimatedSection delay={0.2}>
          <div className="mt-8 flex flex-col gap-5 border border-line bg-paper-grey px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-line bg-paper text-cyan">
                <LockBadgeIcon size={18} />
              </span>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">100% secure payments.</span>{" "}
                Subscription payments are processed over an encrypted connection.
              </p>
            </div>

            <ul className="flex flex-wrap items-center gap-2">
              {PAYMENT_BADGES.map(({ label, Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 border border-line bg-paper px-2.5 py-1.5 text-ink-soft"
                >
                  <Icon size={15} />
                  <span className="font-data text-[10.5px] tracking-[0.06em]">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 font-data text-[11px] leading-relaxed text-ink-soft/80">
            Payment methods shown are the options we are working towards for
            subscription billing. Today, setup and renewal are arranged directly
            with us — get in touch and we&apos;ll walk you through it.
          </p>
        </AnimatedSection>
      </div>
    </section>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const { recommended } = tier;

  return (
    <div
      className={`relative flex h-full flex-col border bg-paper ${
        recommended
          ? "border-ink shadow-xl shadow-ink/10 lg:-mt-3 lg:mb-3"
          : "border-line"
      }`}
    >
      {/* Best-value ribbon */}
      {recommended ? (
        <div className="flex items-center justify-center gap-2 bg-ink px-4 py-2">
          <span className="h-1.5 w-1.5 bg-cyan" aria-hidden="true" />
          <span className="font-data text-[10.5px] font-semibold uppercase tracking-[0.18em] text-paper">
            Best value
          </span>
        </div>
      ) : (
        // Matches the ribbon's height so the three cards' bodies stay aligned —
        // but only once they're side by side. Stacked, it's just dead space.
        <div className="h-0 lg:h-[33px]" aria-hidden="true" />
      )}

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <p className="font-data text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan">
          {tier.name}
        </p>
        <p className="mt-2 text-[13px] text-ink-soft">{tier.blurb}</p>

        <p className="mt-6 flex items-baseline gap-1">
          <span className="t-numeric text-xl font-medium text-ink-soft">&#8377;</span>
          <span className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.03em] text-ink">
            {tier.amount}
          </span>
          <span className="ml-1 text-[13px] font-medium text-ink-soft">{tier.unit}</span>
        </p>
        <p className="mt-2 text-[12.5px] text-ink-soft">{tier.note}</p>

        <ul className="mt-6 flex-1 space-y-2.5 border-t border-line pt-6">
          {tier.features.map((f) => (
            <li key={f} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft">
              <CheckIcon size={15} className="mt-1 shrink-0 text-cyan" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7">
          <CtaLink
            href={tier.href}
            variant={recommended ? "primary" : "secondary"}
            className="w-full"
            withArrow
          >
            {tier.cta}
          </CtaLink>
        </div>
      </div>
    </div>
  );
}
