import type { ComponentType } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import {
  CtaLink,
  FinalCta,
  HeroDevice,
  HowToSetup,
  InsideTheSoftware,
  SectionHeading,
} from "@/components/marketing";
import {
  CheckCircleIcon,
  DesktopIcon,
  PagesIcon,
  PrinterIcon,
  QrIcon,
  QueueIcon,
  RupeeIcon,
  SettingsIcon,
  UploadIcon,
} from "@/components/marketing/icons";

export const metadata = {
  title: "How it works",
  description:
    "Two sides, one system: what your customers experience after scanning the QR, and the one-time setup on your counter PC.",
};

type Step = {
  n: string;
  title: string;
  body: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const CUSTOMER_STEPS: Step[] = [
  {
    n: "01",
    title: "Scan the QR",
    body: "It's printed at the counter. No app, no account — it opens straight in the phone browser.",
    Icon: QrIcon,
  },
  {
    n: "02",
    title: "Upload",
    body: "PDF, Word, PowerPoint or a photo, straight from the phone. No file-size drama.",
    Icon: UploadIcon,
  },
  {
    n: "03",
    title: "Choose options",
    body: "Copies, colour, paper size, sides and which pages. The price updates in real time.",
    Icon: SettingsIcon,
  },
  {
    n: "04",
    title: "Pay",
    body: "The exact total is shown before paying — straight to the shop's UPI or payment account.",
    Icon: RupeeIcon,
  },
  {
    n: "05",
    title: "Get a token",
    body: "A queue number and live status, right on the phone. No standing around waiting.",
    Icon: QueueIcon,
  },
  {
    n: "06",
    title: "Collect",
    body: "The shop's printer receives the job automatically once paid. Pick up the printout.",
    Icon: CheckCircleIcon,
  },
];

const SHOP_STEPS: Step[] = [
  {
    n: "01",
    title: "Set up your shop",
    body: "Name, pricing and your own UPI ID or payment account. Takes about five minutes.",
    Icon: SettingsIcon,
  },
  {
    n: "02",
    title: "Install the print agent",
    body: "A small program on your Windows counter PC. One download, one-time setup.",
    Icon: DesktopIcon,
  },
  {
    n: "03",
    title: "Connect your printer",
    body: "PrintQ detects installed printers automatically. Pick a default and set its capabilities.",
    Icon: PrinterIcon,
  },
  {
    n: "04",
    title: "Print your QR",
    body: "Stick it at the counter — your customers do the rest.",
    Icon: PagesIcon,
  },
];

export default function HowItWorksPage() {
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
          <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-6 md:grid-cols-[1fr_auto] md:items-center md:py-20">
            <AnimatedSection direction="left">
              <p className="t-eyebrow flex items-center gap-2.5">
                <span aria-hidden="true" className="inline-block h-px w-6 bg-cyan/40" />
                How it works
              </p>
              <h1 className="mt-3.5 t-display-lg">
                Two sides of the counter, one system
              </h1>
              <p className="mt-4 max-w-xl t-lead">
                Here&apos;s exactly what your customer sees after scanning the QR, and the
                one-time setup you do on the PC that&apos;s already at your counter.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <CtaLink href="/pricing" variant="primary" size="lg" withArrow>
                  Get PrintQ
                </CtaLink>
                <CtaLink href="/features" variant="secondary" size="lg">
                  See all features
                </CtaLink>
              </div>
            </AnimatedSection>

            <AnimatedSection direction="right" className="flex justify-center md:justify-end">
              <HeroDevice />
            </AnimatedSection>
          </div>
        </section>

        {/* ──────── Customer journey ──────── */}
        <section className="relative overflow-x-clip bg-paper-grey">
          <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="For customers"
                title="What happens after they scan"
                lead="Six steps, all on their own phone, none of which need your attention."
              />
            </AnimatedSection>

            <StaggerChildren
              className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3"
              stagger={0.07}
            >
              {CUSTOMER_STEPS.map(({ n, title, body, Icon }) => (
                <StaggerItem key={n} className="bg-paper">
                  <div className="group h-full p-6 transition-colors duration-200 hover:bg-paper-grey/50">
                    <div className="flex items-start justify-between">
                      <span className="flex h-11 w-11 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                        <Icon size={21} />
                      </span>
                      <span className="font-data text-xs font-semibold tracking-[0.14em] text-ink-soft/40">
                        {n}
                      </span>
                    </div>
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

        {/* ──────── Shop setup ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="For shop owners"
                title="One-time setup, about ten minutes"
                lead="No new hardware, no technician visit, no change to how you already print."
              />
            </AnimatedSection>

            {/* Numbered timeline */}
            <StaggerChildren className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" stagger={0.09}>
              {SHOP_STEPS.map(({ n, title, body, Icon }, i) => (
                <StaggerItem key={n} className="h-full">
                  <div className="relative flex h-full flex-col border-t-2 border-ink pt-5">
                    {/* Connector line to the next step, desktop only */}
                    {i < SHOP_STEPS.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="absolute -top-[2px] left-full hidden h-0.5 w-6 bg-line lg:block"
                      />
                    ) : null}
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center border border-line bg-paper text-cyan">
                        <Icon size={19} />
                      </span>
                      <span className="font-data text-xs font-semibold tracking-[0.14em] text-magenta">
                        {n}
                      </span>
                    </div>
                    <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.012em] text-ink">
                      {title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        <HowToSetup />
        <InsideTheSoftware />

        <FinalCta
          title="Ready to set up your counter?"
          body="Ten minutes with the PC and printer you already have, and your QR code is live."
          primaryHref="/pricing"
          primaryLabel="Get PrintQ for your shop"
          secondaryHref="/faq"
          secondaryLabel="Read the FAQ"
        />
      </main>
      <SiteFooter />
    </>
  );
}
