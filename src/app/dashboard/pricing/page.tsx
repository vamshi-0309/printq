"use client";

import { useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import { calculatePrice, type ShopPricingConfig } from "@/lib/pricing";
import type { PricingRow } from "@/lib/dashboardTypes";
import {
  PageHeader,
  SectionHeading,
  ErrorNote,
  InfoNote,
  formatRupees,
} from "@/components/dashboard/primitives";

/**
 * The shop's rate card.
 *
 * The preview beside the form calls calculatePrice from src/lib/pricing.ts —
 * the same function the server prices real orders with, not a second copy of
 * the arithmetic. That module is written to be usable from either side for
 * exactly this: the shop sees the number its customers will see, computed the
 * same way. The order is still priced server-side from the stored rates; this
 * is a preview, and it never sets a price.
 *
 * Changing a rate affects future orders only. Existing orders keep the amount
 * and breakdown recorded when they were placed, and nothing here rewrites them
 * — which is why the note below says so plainly rather than leaving the owner
 * to wonder whether they just re-priced yesterday's work.
 */

interface FormState {
  a4BwPerPage: string;
  a4ColorPerPage: string;
  a3BwPerPage: string;
  a3ColorPerPage: string;
  duplexDiscountPercent: string;
  minimumOrderAmount: string;
  enableA3: boolean;
}

const FALLBACK: FormState = {
  a4BwPerPage: "1",
  a4ColorPerPage: "5",
  a3BwPerPage: "2",
  a3ColorPerPage: "8",
  duplexDiscountPercent: "0",
  minimumOrderAmount: "0",
  enableA3: false,
};

function toForm(pricing: PricingRow): FormState {
  return {
    a4BwPerPage: String(pricing.a4_bw_per_page),
    a4ColorPerPage: String(pricing.a4_color_per_page),
    a3BwPerPage: String(pricing.a3_bw_per_page),
    a3ColorPerPage: String(pricing.a3_color_per_page),
    duplexDiscountPercent: String(pricing.duplex_discount_percent),
    minimumOrderAmount: String(pricing.minimum_order_amount),
    enableA3: pricing.enabled_paper_sizes?.includes("A3") ?? false,
  };
}

export default function PricingPage() {
  const { data, error, loading, refreshing, updatedAt, refresh } = useDashboardResource<{
    pricing: PricingRow | null;
  }>("/api/shop/pricing", { refreshIntervalMs: 0 });

  // Edits live alongside the version they were made against, so a background
  // refresh cannot silently discard something half-typed.
  const [draft, setDraft] = useState<{ basis: string; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const stored = data?.pricing ?? null;
  const basis = stored?.updated_at ?? "unset";
  const form = draft?.basis === basis ? draft.form : stored ? toForm(stored) : FALLBACK;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false);
    setSaveError(null);
    setDraft({ basis, form: { ...form, [key]: value } });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/shop/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body.error ?? "Could not save your pricing.");
        return;
      }
      setSaved(true);
      setDraft(null);
      refresh();
    } catch {
      setSaveError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-32 animate-pulse bg-line/60" />
        <div className="h-96 animate-pulse border border-line bg-paper" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        description="What customers are charged. They see the total before they pay."
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form onSubmit={save} className="space-y-6">
          <fieldset className="border border-line bg-paper">
            <legend className="ml-4 px-1.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              A4
            </legend>
            <div className="space-y-4 px-4 pb-4 pt-1">
              <RateField
                id="a4bw"
                label="Black & white, per page"
                value={form.a4BwPerPage}
                onChange={(v) => set("a4BwPerPage", v)}
              />
              <RateField
                id="a4color"
                label="Colour, per page"
                value={form.a4ColorPerPage}
                onChange={(v) => set("a4ColorPerPage", v)}
              />
            </div>
          </fieldset>

          <fieldset className="border border-line bg-paper">
            <legend className="ml-4 px-1.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              A3
            </legend>
            <div className="space-y-4 px-4 pb-4 pt-1">
              <label className="flex items-center gap-2 text-[13.5px] text-ink">
                <input
                  type="checkbox"
                  checked={form.enableA3}
                  onChange={(e) => set("enableA3", e.target.checked)}
                  className="accent-cyan"
                />
                Offer A3 printing
              </label>
              {form.enableA3 ? (
                <>
                  <RateField
                    id="a3bw"
                    label="Black & white, per page"
                    value={form.a3BwPerPage}
                    onChange={(v) => set("a3BwPerPage", v)}
                  />
                  <RateField
                    id="a3color"
                    label="Colour, per page"
                    value={form.a3ColorPerPage}
                    onChange={(v) => set("a3ColorPerPage", v)}
                  />
                </>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  Customers will only be offered A4. Your A3 rates are kept and come back if you
                  turn this on again.
                </p>
              )}
            </div>
          </fieldset>

          <fieldset className="border border-line bg-paper">
            <legend className="ml-4 px-1.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              Adjustments
            </legend>
            <div className="space-y-4 px-4 pb-4 pt-1">
              <RateField
                id="duplex"
                label="Discount for double-sided"
                value={form.duplexDiscountPercent}
                onChange={(v) => set("duplexDiscountPercent", v)}
                suffix="%"
                hint="Takes this much off when a customer chooses double-sided."
              />
              <RateField
                id="minimum"
                label="Minimum order amount"
                value={form.minimumOrderAmount}
                onChange={(v) => set("minimumOrderAmount", v)}
                hint="Small jobs are charged at least this much. Leave at 0 for no minimum."
              />
            </div>
          </fieldset>

          {saveError && <ErrorNote>{saveError}</ErrorNote>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="border border-ink bg-ink px-6 py-2.5 text-[13.5px] font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save pricing"}
            </button>
            {saved && (
              <span className="font-data text-[11px] uppercase tracking-[0.1em] text-emerald-700">
                Saved
              </span>
            )}
            {draft?.basis === basis && !saved && (
              <span className="font-data text-[11px] uppercase tracking-[0.1em] text-ink-soft">
                Unsaved changes
              </span>
            )}
          </div>

          <InfoNote>
            New rates apply to orders placed from now on. Orders already taken keep the price the
            customer agreed to.
          </InfoNote>
        </form>

        <PricePreview form={form} />
      </div>
    </div>
  );
}

function RateField({
  id,
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className="relative mt-1.5">
        {!suffix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-data text-[13px] text-ink-soft">
            ₹
          </span>
        )}
        <input
          id={id}
          type="number"
          min="0"
          step="0.5"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`font-data w-full border border-line bg-paper py-2 text-[13.5px] text-ink focus:border-cyan focus:outline-none ${
            suffix ? "px-3" : "pl-7 pr-3"
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-data text-[13px] text-ink-soft">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  );
}

/**
 * What a customer would pay, for a few typical jobs.
 *
 * Uses the shared calculatePrice so this cannot drift from what is charged.
 * If the entered rates are not usable, the error the engine raises is shown
 * rather than a fabricated total.
 */
function PricePreview({ form }: { form: FormState }) {
  const config: ShopPricingConfig = {
    a4BwPerPage: Number.parseFloat(form.a4BwPerPage) || 0,
    a4ColorPerPage: Number.parseFloat(form.a4ColorPerPage) || 0,
    a3BwPerPage: Number.parseFloat(form.a3BwPerPage) || 0,
    a3ColorPerPage: Number.parseFloat(form.a3ColorPerPage) || 0,
    duplexDiscountPercent: Number.parseFloat(form.duplexDiscountPercent) || 0,
    minimumOrderAmount: Number.parseFloat(form.minimumOrderAmount) || 0,
    enabledPaperSizes: form.enableA3 ? ["A4", "A3"] : ["A4"],
  };

  const samples = [
    { label: "1 page, B&W", pageCount: 1, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
    { label: "10 pages, B&W", pageCount: 10, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
    { label: "10 pages, B&W, 2-sided", pageCount: 10, copies: 1, colorMode: "bw", paperSize: "A4", sides: "double" },
    { label: "5 pages, colour", pageCount: 5, copies: 1, colorMode: "color", paperSize: "A4", sides: "single" },
    { label: "20 pages × 3 copies", pageCount: 20, copies: 3, colorMode: "bw", paperSize: "A4", sides: "single" },
  ] as const;

  return (
    <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      <SectionHeading eyebrow="Preview" title="What customers pay" />
      <ul className="divide-y divide-line border border-line bg-paper">
        {samples.map((sample) => {
          let display: string;
          try {
            const breakdown = calculatePrice(
              {
                pageCount: sample.pageCount,
                copies: sample.copies,
                colorMode: sample.colorMode,
                paperSize: sample.paperSize,
                sides: sample.sides,
              },
              config
            );
            display = formatRupees(breakdown.total);
          } catch {
            // A rate that is blank or nonsensical has no total. Showing a dash
            // is honest; showing zero would look like a deliberate free print.
            display = "—";
          }

          return (
            <li key={sample.label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
              <span className="text-[12.5px] text-ink-soft">{sample.label}</span>
              <span className="font-data text-[14px] font-semibold text-ink">{display}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11.5px] leading-relaxed text-ink-soft">
        Worked out with the same calculation used when a customer places an order.
      </p>
    </aside>
  );
}
