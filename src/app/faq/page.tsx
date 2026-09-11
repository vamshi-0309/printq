"use client";

import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { AnimatedSection, StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { CtaLink, FinalCta, SectionHeading } from "@/components/marketing";
import {
  AutoDeleteIcon,
  DesktopIcon,
  QrIcon,
  RupeeIcon,
} from "@/components/marketing/icons";

/**
 * Note: this page is a client component because the accordions hold open
 * state, so `metadata` can't be exported from here. Title and description are
 * inherited from the root layout template.
 */

const GROUPS = [
  {
    id: "customers",
    label: "For customers",
    Icon: QrIcon,
    items: [
      {
        q: "Does my customer need to install an app?",
        a: "No. They scan a QR code and everything happens in their phone browser — no download, no account, no login.",
      },
      {
        q: "What file types can customers upload?",
        a: "PDF, Word (DOC/DOCX), PowerPoint (PPT/PPTX), JPG and PNG. Office documents are converted to PDF on your counter PC using LibreOffice.",
      },
      {
        q: "What if someone's payment fails?",
        a: "No token is issued and no print job is created. The customer sees a clear message and can try again.",
      },
    ],
  },
  {
    id: "money",
    label: "Payments and pricing",
    Icon: RupeeIcon,
    items: [
      {
        q: "Where does the customer's money go?",
        a: "To your own UPI ID or payment gateway account. PrintQ never holds, routes or deducts from customer print payments.",
      },
      {
        q: "Can I set my own prices?",
        a: "Yes. You configure per-page rates for each paper size, colour mode and duplex setting. There are no fixed prices.",
      },
      {
        q: "What does PrintQ cost?",
        a: "₹7,500 one-time setup with 12 months of support included, then ₹500/month or ₹4,000/year to renew. No per-print fees and no commission.",
      },
    ],
  },
  {
    id: "hardware",
    label: "Hardware and printing",
    Icon: DesktopIcon,
    items: [
      {
        q: "What hardware do I need?",
        a: "A Windows PC — the one you already use at the counter — and a printer connected to it. No new hardware.",
      },
      {
        q: "Can I use this with multiple printers?",
        a: "Yes. The agent detects all installed printers. You pick a default and configure each one from the dashboard.",
      },
      {
        q: "What if the printer jams or goes offline?",
        a: "The agent reports the problem. The job stays in your queue and won't print again until you explicitly restart it from the dashboard.",
      },
    ],
  },
  {
    id: "privacy",
    label: "Files and privacy",
    Icon: AutoDeleteIcon,
    items: [
      {
        q: "What happens to customer files after printing?",
        a: "They're deleted from your counter PC as soon as the job finishes, and wiped from the server on a retention schedule you set (24 hours by default — you can make it shorter).",
      },
      {
        q: "Can another shop see my customers' files?",
        a: "No. Storage is access-controlled per shop. A file uploaded to your QR page is reachable only by your shop's agent and dashboard.",
      },
    ],
  },
];

export default function FaqPage() {
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
                  FAQ
                </p>
                <h1 className="mt-3.5 t-display-lg">Frequently asked questions</h1>
                <p className="mt-4 t-lead">
                  The things shop owners ask us before signing up — about money, hardware,
                  and what happens to customer files.
                </p>
              </div>
            </AnimatedSection>

            {/* Jump links */}
            <AnimatedSection delay={0.12}>
              <nav aria-label="FAQ sections" className="mt-8 flex flex-wrap gap-2">
                {GROUPS.map(({ id, label, Icon }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="inline-flex items-center gap-2 border border-line bg-paper px-3 py-2 text-[13px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    <Icon size={15} className="text-cyan" />
                    {label}
                  </a>
                ))}
              </nav>
            </AnimatedSection>
          </div>
        </section>

        {/* ──────── Grouped questions ──────── */}
        <section className="relative overflow-x-clip bg-paper-grey">
          <div className="pointer-events-none absolute inset-0 bg-blueprint opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
            <div className="flex flex-col gap-14">
              {GROUPS.map(({ id, label, Icon, items }) => (
                <div key={id} id={id} className="scroll-mt-32">
                  <AnimatedSection>
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
                        <Icon size={19} />
                      </span>
                      <h2 className="font-display text-xl font-bold tracking-[-0.022em] text-ink sm:text-2xl">
                        {label}
                      </h2>
                    </div>
                  </AnimatedSection>

                  <StaggerChildren
                    className="mt-6 border border-line bg-paper"
                    stagger={0.05}
                  >
                    {items.map(({ q, a }, i) => (
                      <StaggerItem key={q}>
                        <FaqItem
                          question={q}
                          answer={a}
                          last={i === items.length - 1}
                        />
                      </StaggerItem>
                    ))}
                  </StaggerChildren>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ──────── Still stuck ──────── */}
        <section className="relative overflow-x-clip border-t border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20">
            <div className="flex flex-col items-start gap-6 border border-line bg-paper-grey px-6 py-8 sm:px-8 md:flex-row md:items-center md:justify-between">
              <SectionHeading
                eyebrow="Still stuck?"
                title="Ask us directly"
                size="md"
                lead="If your question isn't here, send it over — a real person will answer."
                className="!max-w-xl"
              />
              <div className="shrink-0">
                <CtaLink href="/contact" variant="primary" size="lg" withArrow>
                  Contact us
                </CtaLink>
              </div>
            </div>
          </div>
        </section>

        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

function FaqItem({
  question,
  answer,
  last,
}: {
  question: string;
  answer: string;
  last: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={last ? "" : "border-b border-line"}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-paper-grey/50 sm:px-7"
      >
        <span className="text-[14.5px] font-medium leading-snug tracking-[-0.008em] text-ink">
          {question}
        </span>
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border transition-colors ${
            open ? "border-cyan bg-cyan text-paper" : "border-line text-ink-soft"
          }`}
          aria-hidden="true"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform duration-200 ${open ? "rotate-45" : ""}`}
          >
            <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {/* grid-rows trick: animates open/closed without a hard-coded max-height,
          so long answers are never clipped. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* The row collapses to height 0, but a clipped element is still in
            the a11y tree — `inert` + `aria-hidden` take the closed answer out
            of screen-reader and tab order too. */}
        <div className="overflow-hidden" inert={!open} aria-hidden={!open}>
          <p className="px-5 pb-5 pr-12 text-[13.5px] leading-relaxed text-ink-soft sm:px-7 sm:pr-16">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
