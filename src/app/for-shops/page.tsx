import type { ComponentType } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import {
  CtaLink,
  FinalCta,
  HowToSetup,
  InsideTheSoftware,
  ReferralBanner,
  SectionHeading,
  StatsBar,
  TestimonialCarousel,
  TrustSection,
} from "@/components/marketing";
import {
  AutoDeleteIcon,
  CheckIcon,
  DirectPayIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/marketing/icons";

export const metadata = {
  title: "For Xerox shops",
  description:
    "PrintQ adds a QR-based front counter to the Windows PC and printer you already have — no new hardware, no commission, no pendrives.",
};

const PAIN_POINTS = [
  {
    before: "Customers send files on WhatsApp",
    after: "They upload directly from the QR page",
  },
  {
    before: "You discuss price over chat",
    after: "Price is calculated automatically before payment",
  },
  {
    before: "You manually open and print each file",
    after: "Paid jobs print automatically on your counter",
  },
  {
    before: "Customers wait without knowing when",
    after: "They get a token and live queue status",
  },
  {
    before: "Pendrives with unknown files and viruses",
    after: "Phone to printer, no USB touches your PC",
  },
];

type Control = {
  title: string;
  body: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const CONTROLS: Control[] = [
  {
    title: "Your printer, your rules",
    body: "Set your own prices for A4 and A3, colour and B&W, single and double sided. Enable only the paper sizes you actually stock.",
    Icon: SettingsIcon,
  },
  {
    title: "Your payment account",
    body: "Enter your own UPI ID or connect your own payment gateway account. Customer print payments go there directly — PrintQ is never in that path.",
    Icon: DirectPayIcon,
  },
  {
    title: "No surprise print jobs",
    body: "A job only reaches your printer after payment is verified. If your counter PC goes offline, new orders pause automatically until it reconnects.",
    Icon: ShieldIcon,
  },
  {
    title: "Files aren't kept around",
    body: "Customer documents are stored privately and deleted on a schedule you control after printing — including sensitive files like ID documents and marksheets.",
    Icon: AutoDeleteIcon,
  },
];

export default function ForShopsPage() {
  return (
    <>
      <SiteHeader announcement />
      <main className="flex-1">
        {/* ──────── Hero ──────── */}
        <section className="relative overflow-x-clip border-b border-line bg-paper">
          <div
            className="pointer-events-none absolute inset-0 bg-blueprint mask-fade-edges"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-5 py-14 sm:px-6 md:py-20">
            <AnimatedSection>
              <div className="max-w-2xl">
                <p className="t-eyebrow flex items-center gap-2.5">
                  <span aria-hidden="true" className="inline-block h-px w-6 bg-cyan/40" />
                  For Xerox shops
                </p>
                <h1 className="mt-3.5 t-display-lg">Built for how your shop already runs</h1>
                <p className="mt-4 t-lead">
                  PrintQ doesn&apos;t ask you to change hardware or software you already
                  trust. It adds a QR-based front counter to the Windows PC and printer
                  sitting on your desk right now.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <CtaLink href="/pricing" variant="primary" size="lg" withArrow>
                    See pricing
                  </CtaLink>
                  <CtaLink href="/how-it-works" variant="secondary" size="lg">
                    How it works
                  </CtaLink>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </section>

        <StatsBar />

        {/* ──────── Before / after ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
          <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="Before and after"
                title="The same shop, minus the chaos"
                lead="Nothing about your printer, your prices or your customers changes. Only the counter workflow does."
              />
            </AnimatedSection>

            <div className="mt-12 border border-line bg-paper">
              {/* Column headers */}
              <div className="grid grid-cols-2 border-b border-line bg-paper-grey">
                <p className="px-5 py-3 font-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-soft/70 sm:px-7">
                  Today
                </p>
                <p className="border-l border-line px-5 py-3 font-data text-[10.5px] font-semibold uppercase tracking-[0.16em] text-cyan sm:px-7">
                  With PrintQ
                </p>
              </div>

              <StaggerChildren className="block" stagger={0.06}>
                {PAIN_POINTS.map((p, i) => (
                  <StaggerItem key={p.before}>
                    <div
                      className={`grid grid-cols-2 ${
                        i < PAIN_POINTS.length - 1 ? "border-b border-line" : ""
                      }`}
                    >
                      <div className="flex items-start gap-3 px-5 py-5 sm:px-7">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-ink-soft/30"
                          aria-hidden="true"
                        />
                        <p className="text-[13px] leading-relaxed text-ink-soft/70 line-through decoration-ink-soft/25">
                          {p.before}
                        </p>
                      </div>
                      <div className="flex items-start gap-3 border-l border-line bg-cyan/[0.025] px-5 py-5 sm:px-7">
                        <CheckIcon size={15} className="mt-0.5 shrink-0 text-cyan" />
                        <p className="text-[13px] font-medium leading-relaxed text-ink">
                          {p.after}
                        </p>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerChildren>
            </div>
          </div>
        </section>

        {/* ──────── You stay in control ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="Your shop, your call"
                title="You stay in control"
                lead="Every decision that affects your margins, your printer or your customers' files stays with you."
              />
            </AnimatedSection>

            <StaggerChildren className="mt-12 grid gap-5 md:grid-cols-2" stagger={0.08}>
              {CONTROLS.map(({ title, body, Icon }) => (
                <StaggerItem key={title} className="h-full">
                  <div className="flex h-full gap-5 border border-line bg-paper p-6 transition-shadow duration-200 hover:shadow-lg hover:shadow-ink/8 sm:p-7">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                      <Icon size={21} />
                    </span>
                    <div>
                      <h2 className="text-[15px] font-semibold tracking-[-0.012em] text-ink">
                        {title}
                      </h2>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        <HowToSetup />
        <InsideTheSoftware />
        <TestimonialCarousel />
        <TrustSection />
        <ReferralBanner />

        <FinalCta
          title="Try it on your own shop"
          body="Set up in under 10 minutes, starting with the PC and printer you already have."
          primaryHref="/pricing"
          primaryLabel="See pricing"
          secondaryHref="/contact"
          secondaryLabel="Talk to us"
        />
      </main>
      <SiteFooter />
    </>
  );
}
