import type { ComponentType } from "react";
import { StaggerChildren, StaggerItem } from "@/components/ui/AnimatedSection";
import { AnimatedSection } from "@/components/ui/AnimatedSection";
import { SectionHeading, TextLink } from "./primitives";
import {
  AutoDeleteIcon,
  DirectPayIcon,
  MultiFileIcon,
  OfflineQueueIcon,
  PaperSizeIcon,
  PassportPhotoIcon,
  PhoneEditIcon,
  ResumeIcon,
} from "./icons";

type Feature = {
  title: string;
  body: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const FEATURES: Feature[] = [
  {
    title: "Multi-file printing",
    body: "Send several documents in one order and pay for them together.",
    Icon: MultiFileIcon,
  },
  {
    title: "Phone-side editing",
    body: "Rotate, reorder and pick page ranges before paying — no reprints.",
    Icon: PhoneEditIcon,
  },
  {
    title: "Passport photos",
    body: "Standard photo sheet layouts, sized correctly for the paper you stock.",
    Icon: PassportPhotoIcon,
  },
  {
    title: "Resume templates",
    body: "Clean, print-ready layouts for customers who arrive with only a photo of a CV.",
    Icon: ResumeIcon,
  },
  {
    title: "A3, A2 and duplex",
    body: "Enable only the sizes you stock, with separate rates for single and double sided.",
    Icon: PaperSizeIcon,
  },
  {
    title: "Direct-to-shop payments",
    body: "Money lands in your own UPI or payment account. PrintQ is never in that path.",
    Icon: DirectPayIcon,
  },
  {
    title: "Automatic file deletion",
    body: "Documents are wiped from the shop PC and the server once the job completes.",
    Icon: AutoDeleteIcon,
  },
  {
    title: "Offline-safe queueing",
    body: "If the counter PC drops offline, orders pause and resume cleanly — never printed twice.",
    Icon: OfflineQueueIcon,
  },
];

export function FeatureGrid() {
  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <AnimatedSection>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              eyebrow="Everything in one place"
              title="One QR code, the whole print counter"
              lead="The things customers actually walk in asking for — handled on their own phone, priced by your rates."
            />
            <div className="shrink-0 md:pb-1">
              <TextLink href="/features">See all features</TextLink>
            </div>
          </div>
        </AnimatedSection>

        {/*
          Hairline grid: the gap is the border. Cells sit on a shared line
          colour so the grid reads as one drawn object rather than eight
          floating cards.
        */}
        <StaggerChildren
          className="mt-12 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
          stagger={0.05}
        >
          {FEATURES.map(({ title, body, Icon }) => (
            <StaggerItem key={title} className="bg-paper">
              <div className="group relative h-full p-6 transition-colors duration-200 hover:bg-paper-grey/60">
                <span
                  className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-cyan transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span className="flex h-11 w-11 items-center justify-center border border-line bg-paper text-cyan transition-colors duration-200 group-hover:border-cyan/40 group-hover:bg-cyan/[0.07]">
                  <Icon size={21} />
                </span>
                <h3 className="mt-5 text-[14.5px] font-semibold tracking-[-0.012em] text-ink">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{body}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerChildren>
      </div>
    </section>
  );
}
