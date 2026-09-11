"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { SectionHeading } from "./primitives";
import { ArrowLeftIcon, ArrowRightIcon, StarIcon } from "./icons";

/**
 * Auto-rotating, swipeable testimonial rail.
 *
 * Implementation note: this is a native `scroll-snap` rail rather than a
 * transform carousel. That gets real touch swiping, momentum and
 * accessibility for free on mobile, and "auto-rotate" is just a programmatic
 * `scrollTo` on the same rail — so manual and automatic movement can never
 * disagree about where the carousel is.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  PLACEHOLDER COPY — replace before launch.                       │
 * │  Every quote below is written by us as a stand-in. Swap the       │
 * │  TESTIMONIALS array for real, permissioned customer quotes.      │
 * └──────────────────────────────────────────────────────────────────┘
 */

const ROTATE_MS = 5200;

type Testimonial = {
  id: string;
  quote: string;
  name: string;
  shop: string;
  city: string;
  rating: number;
};

const TESTIMONIALS: Testimonial[] = [
  {
    id: "t1",
    quote:
      "Students used to crowd the counter with pendrives every evening. Now they scan, pay, and the file is already printing by the time they reach me. My evening rush is half as loud.",
    name: "Placeholder Name",
    shop: "Placeholder Xerox & Stationery",
    city: "Pune, Maharashtra",
    rating: 5,
  },
  {
    id: "t2",
    quote:
      "The part I actually care about is that the money comes to my own UPI. No waiting for a settlement, no percentage cut. I checked that first before signing up.",
    name: "Placeholder Name",
    shop: "Placeholder Digital Prints",
    city: "Hyderabad, Telangana",
    rating: 5,
  },
  {
    id: "t3",
    quote:
      "I was worried it would need a new computer. It runs on the same old machine I have had for six years, with the same printer. Setup took one afternoon.",
    name: "Placeholder Name",
    shop: "Placeholder Copy Point",
    city: "Jaipur, Rajasthan",
    rating: 4,
  },
  {
    id: "t4",
    quote:
      "Customers stopped asking me how much it will cost. They see the price on their own phone before paying, so there is no argument at the counter any more.",
    name: "Placeholder Name",
    shop: "Placeholder Stationers",
    city: "Kochi, Kerala",
    rating: 5,
  },
  {
    id: "t5",
    quote:
      "The token queue is what won me over. People sit down instead of standing over my shoulder asking if their print is ready.",
    name: "Placeholder Name",
    shop: "Placeholder Xerox Centre",
    city: "Lucknow, Uttar Pradesh",
    rating: 5,
  },
];

export function TestimonialCarousel() {
  const reducedMotion = useReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { amount: 0.3 });

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Set while we scroll programmatically, so the scroll listener doesn't
  // fight the animation and re-derive a stale index mid-flight.
  const scrollingRef = useRef(false);

  const count = TESTIMONIALS.length;

  const scrollTo = useCallback(
    (next: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const target = ((next % count) + count) % count;
      const child = rail.children[target] as HTMLElement | undefined;
      if (!child) return;

      scrollingRef.current = true;
      rail.scrollTo({
        left: child.offsetLeft - (rail.clientWidth - child.clientWidth) / 2,
        behavior: reducedMotion ? "auto" : "smooth",
      });
      setIndex(target);
      window.setTimeout(() => {
        scrollingRef.current = false;
      }, 600);
    },
    [count, reducedMotion]
  );

  // Keep the dots in sync when the user swipes the rail by hand.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    let frame = 0;
    const onScroll = () => {
      if (scrollingRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = rail.scrollLeft + rail.clientWidth / 2;
        let nearest = 0;
        let best = Infinity;
        Array.from(rail.children).forEach((node, i) => {
          const el = node as HTMLElement;
          const centre = el.offsetLeft + el.clientWidth / 2;
          const dist = Math.abs(centre - mid);
          if (dist < best) {
            best = dist;
            nearest = i;
          }
        });
        setIndex(nearest);
      });
    };

    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      rail.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Auto-rotate, but only while visible and not being interacted with.
  useEffect(() => {
    if (reducedMotion || !inView || paused) return;
    const id = window.setTimeout(() => scrollTo(index + 1), ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [reducedMotion, inView, paused, index, scrollTo]);

  return (
    <section className="relative overflow-x-clip border-t border-line bg-paper">
      <div ref={sectionRef} className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            eyebrow="Shop owners"
            title="What print shops say about running on PrintQ"
            lead="Placeholder quotes from shop owners across India."
          />

          <div className="flex shrink-0 items-center gap-2">
            <ControlButton label="Previous testimonial" onClick={() => scrollTo(index - 1)}>
              <ArrowLeftIcon size={16} />
            </ControlButton>
            <ControlButton label="Next testimonial" onClick={() => scrollTo(index + 1)}>
              <ArrowRightIcon size={16} />
            </ControlButton>
          </div>
        </div>

        {/* Rail */}
        <div
          ref={railRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          onTouchStart={() => setPaused(true)}
          className="swipe-rail -mx-5 mt-10 gap-4 px-5 pb-2 sm:-mx-6 sm:px-6"
          role="group"
          aria-roledescription="carousel"
          aria-label="Shop owner testimonials"
        >
          {TESTIMONIALS.map((t, i) => (
            <article
              key={t.id}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              className={`flex w-[85vw] max-w-[420px] flex-col border bg-paper p-6 transition-colors duration-300 sm:w-[380px] ${
                i === index ? "border-line-strong shadow-lg shadow-ink/8" : "border-line"
              }`}
            >
              <div className="flex items-center gap-1" aria-label={`${t.rating} out of 5 stars`}>
                {Array.from({ length: 5 }).map((_, s) => (
                  <StarIcon
                    key={s}
                    size={14}
                    className={s < t.rating ? "text-toner-yellow" : "text-line"}
                  />
                ))}
              </div>

              <blockquote className="mt-4 flex-1">
                <p className="text-[14.5px] leading-relaxed text-ink">
                  &ldquo;{t.quote}&rdquo;
                </p>
              </blockquote>

              <footer className="mt-6 flex items-center gap-3 border-t border-line pt-4">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center bg-paper-grey font-display text-[13px] font-bold text-ink-soft"
                  aria-hidden="true"
                >
                  {t.shop.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    {t.name}
                  </span>
                  <span className="block truncate font-data text-[11px] text-ink-soft">
                    {t.shop} &middot; {t.city}
                  </span>
                </span>
              </footer>
            </article>
          ))}
        </div>

        {/* Dots */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => scrollTo(i)}
              aria-label={`Go to testimonial ${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              className={`h-1.5 transition-all duration-300 ${
                i === index ? "w-7 bg-cyan" : "w-3 bg-line hover:bg-line-strong"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center border border-line text-ink-soft transition-colors hover:border-ink hover:text-ink"
    >
      {children}
    </button>
  );
}
