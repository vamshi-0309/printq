"use client";

import { useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { AnimatedSection } from "@/components/ui/AnimatedSection";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget;
    const data = {
      shopName: (form.elements.namedItem("shop-name") as HTMLInputElement).value,
      city: (form.elements.namedItem("city") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setSubmitted(true);
      }
    } catch {
      // Silently handle — form will remain for retry
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Section>
          <div className="mx-auto max-w-lg">
            <AnimatedSection>
              <p className="font-data text-sm font-medium tracking-widest text-cyan uppercase">Contact</p>
              <h1 className="mt-3 font-display text-3xl font-bold text-ink md:text-4xl">
                Get PrintQ for your shop
              </h1>
              <p className="mt-4 text-ink-soft leading-relaxed">
                Tell us about your shop and we&apos;ll get in touch to set up
                your QR code, pricing, and print agent.
              </p>
            </AnimatedSection>

            {submitted ? (
              <AnimatedSection className="mt-10">
                <div className="border-2 border-cyan p-8 text-center">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto" aria-hidden="true">
                    <circle cx="24" cy="24" r="20" stroke="#0098C7" strokeWidth="2" />
                    <path d="M16 24l6 6 10-10" stroke="#0098C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <h2 className="mt-4 font-display text-xl font-bold text-ink">We&apos;ll be in touch</h2>
                  <p className="mt-2 text-sm text-ink-soft">
                    Thanks for reaching out. We&apos;ll contact you within 24 hours to get your shop set up.
                  </p>
                </div>
              </AnimatedSection>
            ) : (
              <AnimatedSection delay={0.1}>
                <form onSubmit={handleSubmit} className="mt-10 space-y-5">
                  <div>
                    <label className="text-sm font-medium text-ink" htmlFor="shop-name">
                      Shop name <span className="text-magenta">*</span>
                    </label>
                    <input
                      id="shop-name"
                      name="shop-name"
                      required
                      className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none"
                      placeholder="e.g. Sharma Xerox & Prints"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-ink" htmlFor="city">
                      City <span className="text-magenta">*</span>
                    </label>
                    <input
                      id="city"
                      name="city"
                      required
                      className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none"
                      placeholder="e.g. Jaipur"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-ink" htmlFor="phone">
                      Phone <span className="text-magenta">*</span>
                    </label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      required
                      className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none"
                      placeholder="e.g. 98765 43210"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-ink" htmlFor="message">
                      Anything else? <span className="text-ink-soft font-normal">(optional)</span>
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      rows={3}
                      className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none resize-none"
                      placeholder="How many printers, which paper sizes, etc."
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" loading={loading}>
                    Request setup
                  </Button>
                </form>
              </AnimatedSection>
            )}
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
