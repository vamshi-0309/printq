import type { ComponentType } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import {
  CtaLink,
  FeatureGrid,
  FinalCta,
  InsideTheSoftware,
  Pill,
  SectionHeading,
  TrustSection,
} from "@/components/marketing";
import {
  AutoDeleteIcon,
  DirectPayIcon,
  OfflineQueueIcon,
  PrinterIcon,
  QrIcon,
  QueueIcon,
  RupeeIcon,
  ShieldIcon,
} from "@/components/marketing/icons";

export const metadata = {
  title: "Features",
  description:
    "QR-to-print with no app, automatic printing, a real token queue, live price calculation, shop-owned payments and duplicate-print protection.",
};

type Capability = {
  title: string;
  body: string;
  tag: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const CAPABILITIES: Capability[] = [
  {
    title: "QR to print, no app required",
    body: "Customers scan a QR code, upload from their phone browser, and go. Nothing to download, no account to create, no login to forget.",
    tag: "Customer",
    Icon: QrIcon,
  },
  {
    title: "Automatic printing",
    body: "The PrintQ agent on your Windows PC receives paid jobs and sends them to your printer. No manual file transfer, no opening attachments.",
    tag: "Counter",
    Icon: PrinterIcon,
  },
  {
    title: "Token queue",
    body: "Every paid order gets a token number. Customers watch their position and status on their phone; you see the same queue on your dashboard.",
    tag: "Both",
    Icon: QueueIcon,
  },
  {
    title: "Live price calculation",
    body: "You set per-page rates for each paper size, colour mode and duplex option. The price updates as the customer changes their selection.",
    tag: "Customer",
    Icon: RupeeIcon,
  },
  {
    title: "Shop-owned payments",
    body: "Customer payments go to your own UPI or payment gateway account. PrintQ is not in the money flow and takes no cut.",
    tag: "Money",
    Icon: DirectPayIcon,
  },
  {
    title: "Document privacy",
    body: "Files are stored privately, access-controlled per shop, and deleted automatically after a retention period you configure.",
    tag: "Privacy",
    Icon: AutoDeleteIcon,
  },
  {
    title: "Multiple printers",
    body: "The agent detects every installed printer. Pick a default, enable or disable each one, and set colour and duplex capability per device.",
    tag: "Counter",
    Icon: PrinterIcon,
  },
  {
    title: "Duplicate print protection",
    body: "A strict state machine stops a lost network acknowledgement from printing the same document twice. Ambiguous outcomes wait for you to review.",
    tag: "Reliability",
    Icon: ShieldIcon,
  },
  {
    title: "Offline-safe queueing",
    body: "If the counter PC drops off the network, new orders pause automatically and resume cleanly once it reconnects.",
    tag: "Reliability",
    Icon: OfflineQueueIcon,
  },
];

export default function FeaturesPage() {
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
                  Features
                </p>
                <h1 className="mt-3.5 t-display-lg">
                  Everything you need to run a QR-powered print counter
                </h1>
                <p className="mt-4 t-lead">
                  No special hardware. No complicated setup. Real tools built around how a
                  print shop actually works on a busy evening.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <CtaLink href="/pricing" variant="primary" size="lg" withArrow>
                    Get PrintQ
                  </CtaLink>
                  <CtaLink href="/how-it-works" variant="secondary" size="lg">
                    See how it works
                  </CtaLink>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* ──────── Core capabilities ──────── */}
        <section className="relative overflow-x-clip bg-paper-grey">
          <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <SectionHeading
                eyebrow="Core capabilities"
                title="The parts that do the actual work"
              />
            </AnimatedSection>

            <StaggerChildren className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3" stagger={0.06}>
              {CAPABILITIES.map(({ title, body, tag, Icon }) => (
                <StaggerItem key={title} className="h-full">
                  <div className="group flex h-full flex-col border border-line bg-paper p-6 transition-shadow duration-200 hover:shadow-lg hover:shadow-ink/8">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan transition-colors duration-200 group-hover:bg-cyan group-hover:text-paper">
                        <Icon size={21} />
                      </span>
                      <Pill>{tag}</Pill>
                    </div>
                    <h2 className="mt-5 text-[15px] font-semibold tracking-[-0.012em] text-ink">
                      {title}
                    </h2>
                    <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">
                      {body}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        <FeatureGrid />
        <TrustSection />
        <InsideTheSoftware />

        <FinalCta
          title="Ready to modernise your counter?"
          body="Setup takes about ten minutes, and there's no new hardware to buy."
          primaryHref="/pricing"
          primaryLabel="Get PrintQ for your shop"
          secondaryHref="/for-shops"
          secondaryLabel="PrintQ for shops"
        />
      </main>
      <SiteFooter />
    </>
  );
}
