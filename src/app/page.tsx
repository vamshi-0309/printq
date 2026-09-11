import type { ComponentType } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import {
  FeatureGrid,
  FinalCta,
  Hero,
  HowToSetup,
  InsideTheSoftware,
  PricingSection,
  ReferralBanner,
  SectionHeading,
  StatsBar,
  TestimonialCarousel,
  TextLink,
  TrustSection,
} from "@/components/marketing";
import {
  PrinterIcon,
  QrIcon,
  RupeeIcon,
  UploadIcon,
} from "@/components/marketing/icons";

const STEPS: {
  n: string;
  title: string;
  body: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    n: "01",
    title: "Customer scans your shop's QR",
    body: "No app to install. It opens straight to your shop's print page in their phone browser.",
    Icon: QrIcon,
  },
  {
    n: "02",
    title: "They upload and set options",
    body: "PDF, Word, PowerPoint or a photo. Copies, colour, paper size, sides — the price updates as they choose.",
    Icon: UploadIcon,
  },
  {
    n: "03",
    title: "They pay you directly",
    body: "Payment goes to your own UPI or payment account. PrintQ never touches that money.",
    Icon: RupeeIcon,
  },
  {
    n: "04",
    title: "The job prints itself",
    body: "Once payment is confirmed, the PrintQ agent on your counter PC sends it straight to your printer.",
    Icon: PrinterIcon,
  },
];

const SHOP_BENEFITS = [
  {
    title: "Less WhatsApp, fewer mistakes",
    desc: "Customers set their own copies, colour and page range — the price is calculated for them before they pay, not guessed over chat.",
  },
  {
    title: "No more pendrives",
    desc: "No handling customer USBs, worrying about viruses, or waiting on slow file transfers. Everything arrives through the phone.",
  },
  {
    title: "Predictable pricing",
    desc: "You set your own rates per page. Customers see exactly what they'll pay before they send the job.",
  },
];

const FAQS = [
  {
    q: "Do customers need to download an app?",
    a: "No. They scan your QR code and everything works in their phone browser.",
  },
  {
    q: "Does PrintQ take a commission on prints?",
    a: "No. Payments go directly to your own UPI or payment account. PrintQ charges only the subscription fee.",
  },
  {
    q: "What printers are supported?",
    a: "Any printer connected to your Windows PC. No special hardware needed.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader announcement />
      <main className="flex-1">
        <Hero />
        <StatsBar />

        {/* ──────── How it works ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <SectionHeading
                  eyebrow="How it works"
                  title="From scan to printed page"
                  lead="Four steps, none of which need you to touch a file, a pendrive or a chat window."
                />
                <div className="shrink-0 md:pb-1">
                  <TextLink href="/how-it-works">Read the full walkthrough</TextLink>
                </div>
              </div>
            </AnimatedSection>

            <StaggerChildren
              className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
              stagger={0.09}
            >
              {STEPS.map(({ n, title, body, Icon }) => (
                <StaggerItem key={n} className="bg-paper">
                  <div className="group relative h-full p-6 transition-colors duration-200 hover:bg-paper-grey/50">
                    <div className="flex items-start justify-between">
                      <span className="flex h-11 w-11 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                        <Icon size={21} />
                      </span>
                      <span className="font-data text-xs font-semibold tracking-[0.14em] text-ink-soft/40">
                        {n}
                      </span>
                    </div>
                    <h3 className="mt-5 text-[14.5px] font-semibold leading-snug tracking-[-0.012em] text-ink">
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
        <FeatureGrid />
        <TestimonialCarousel />
        <TrustSection />
        <InsideTheSoftware />

        {/* ──────── For shop owners ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
          <div
            className="pointer-events-none absolute inset-0 bg-blueprint opacity-60"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <AnimatedSection direction="left" className="min-w-0">
                <SectionHeading
                  eyebrow="For shop owners"
                  title="Replace the WhatsApp chaos with an actual system"
                  lead="PrintQ doesn't ask you to change the hardware or habits that already work. It puts a proper front counter in front of them."
                />
                <div className="mt-7">
                  <TextLink href="/for-shops">Learn more about PrintQ for shops</TextLink>
                </div>
              </AnimatedSection>

              <StaggerChildren className="flex min-w-0 flex-col gap-px bg-line" stagger={0.08}>
                {SHOP_BENEFITS.map((b, i) => (
                  <StaggerItem key={b.title} className="bg-paper">
                    <div className="flex gap-5 p-6">
                      <span className="font-data text-[11px] font-semibold tracking-[0.14em] text-cyan">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3 className="text-[15px] font-semibold tracking-[-0.012em] text-ink">
                          {b.title}
                        </h3>
                        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                          {b.desc}
                        </p>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerChildren>
            </div>
          </div>
        </section>

        <PricingSection
          eyebrow="Pricing"
          heading="Simple pricing, no commissions"
          lead="One setup cost, then a small renewal after your first year. No per-print charges and no revenue sharing — customer payments always go directly to your account."
        />

        <ReferralBanner />

        {/* ──────── Quick FAQ ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper-grey">
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <AnimatedSection>
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <SectionHeading
                  eyebrow="FAQ"
                  title="Common questions"
                  size="md"
                  lead="The three we get asked before anything else."
                />
                <div className="shrink-0 md:pb-1">
                  <TextLink href="/faq">See all questions</TextLink>
                </div>
              </div>
            </AnimatedSection>

            <StaggerChildren className="mt-10 grid gap-5 md:grid-cols-3" stagger={0.08}>
              {FAQS.map(({ q, a }, i) => (
                <StaggerItem key={q} className="h-full">
                  <div className="flex h-full flex-col border border-line bg-paper p-6">
                    <span className="flex h-8 w-8 items-center justify-center border border-line font-data text-[11px] font-semibold text-cyan">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-4 text-[14.5px] font-semibold leading-snug tracking-[-0.012em] text-ink">
                      {q}
                    </h3>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-ink-soft">{a}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerChildren>
          </div>
        </section>

        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
