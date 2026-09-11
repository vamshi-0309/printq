"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import type { SettingsResponse } from "@/lib/dashboardTypes";
import {
  PageHeader,
  SectionHeading,
  StatusPill,
  ErrorNote,
  InfoNote,
  absoluteTime,
} from "@/components/dashboard/primitives";

/**
 * Shop details, how customers pay, and how long files are kept.
 *
 * Nothing secret appears on this screen, and nothing secret is sent to it. The
 * Cashfree app id and secret belong to PrintQ's own server environment; the
 * dashboard only ever learns whether the server is able to transact at all,
 * as a boolean. The Supabase service-role key is used exclusively in route
 * handlers and never reaches a browser. There is no field on this page for
 * either, because a shop owner has nothing to paste into one.
 *
 * Pairing moved out of here to its own screen. It was previously wedged into
 * the bottom of this form, where generating a code looked like it needed the
 * form to be saved.
 */

interface ShopForm {
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
}

interface PaymentForm {
  upiId: string;
  paymentGateway: string;
  paymentGatewayAccountId: string;
  retentionHours: string;
}

export default function SettingsPage() {
  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<SettingsResponse>("/api/shop/settings", { refreshIntervalMs: 0 });

  const [draft, setDraft] = useState<{ basis: string; shop: ShopForm; payment: PaymentForm } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const basis = data ? `${data.shop.id}:${data.settings?.updated_at ?? "none"}` : "";
  const current =
    draft?.basis === basis && draft
      ? draft
      : data
        ? {
            basis,
            shop: {
              shopName: data.shop.shop_name ?? "",
              ownerName: data.shop.owner_name ?? "",
              phone: data.shop.phone ?? "",
              email: data.shop.email ?? "",
              address: data.shop.address ?? "",
              city: data.shop.city ?? "",
              state: data.shop.state ?? "",
              pincode: data.shop.pincode ?? "",
              gstin: data.shop.gstin ?? "",
            },
            payment: {
              upiId: data.settings?.upi_id ?? "",
              paymentGateway: data.settings?.payment_gateway ?? "none",
              paymentGatewayAccountId: data.settings?.payment_gateway_account_id ?? "",
              retentionHours: String(data.settings?.file_retention_hours ?? 24),
            },
          }
        : null;

  const setShop = (key: keyof ShopForm, value: string) => {
    if (!current) return;
    setSaved(false);
    setDraft({ ...current, basis, shop: { ...current.shop, [key]: value } });
  };

  const setPayment = (key: keyof PaymentForm, value: string) => {
    if (!current) return;
    setSaved(false);
    setDraft({ ...current, basis, payment: { ...current.payment, [key]: value } });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;

    setSaving(true);
    setSaveError(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/shop/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: {
            shop_name: current.shop.shopName,
            owner_name: current.shop.ownerName,
            phone: current.shop.phone,
            email: current.shop.email,
            address: current.shop.address,
            city: current.shop.city,
            state: current.shop.state,
            pincode: current.shop.pincode,
            gstin: current.shop.gstin,
          },
          settings: {
            upi_id: current.payment.upiId,
            payment_gateway: current.payment.paymentGateway,
            payment_gateway_account_id: current.payment.paymentGatewayAccountId,
            file_retention_hours: current.payment.retentionHours,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body.error ?? "Could not save your settings.");
        return;
      }
      setSaved(true);
      setWarnings(Array.isArray(body.warnings) ? body.warnings : []);
      setDraft(null);
      refresh();
    } catch {
      setSaveError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !current || !data) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-32 animate-pulse bg-line/60" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {!error && <div className="h-96 animate-pulse border border-line bg-paper" />}
      </div>
    );
  }

  const cashfreeAvailable = data.gatewayAvailability.cashfree;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your shop's details, how customers pay you, and how long their files are kept."
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <form onSubmit={save} className="max-w-2xl space-y-7">
        <section className="space-y-4">
          <SectionHeading eyebrow="Shop" title="Details" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="shopName"
              label="Shop name"
              value={current.shop.shopName}
              onChange={(v) => setShop("shopName", v)}
              required
            />
            <Field
              id="ownerName"
              label="Owner name"
              value={current.shop.ownerName}
              onChange={(v) => setShop("ownerName", v)}
              required
            />
            <Field
              id="phone"
              label="Phone"
              type="tel"
              value={current.shop.phone}
              onChange={(v) => setShop("phone", v)}
              required
            />
            <Field
              id="email"
              label="Email"
              type="email"
              value={current.shop.email}
              onChange={(v) => setShop("email", v)}
              required
            />
          </div>
          <Field
            id="address"
            label="Address"
            value={current.shop.address}
            onChange={(v) => setShop("address", v)}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="city" label="City" value={current.shop.city} onChange={(v) => setShop("city", v)} />
            <Field id="state" label="State" value={current.shop.state} onChange={(v) => setShop("state", v)} />
            <Field
              id="pincode"
              label="Pincode"
              value={current.shop.pincode}
              onChange={(v) => setShop("pincode", v)}
            />
          </div>
          <Field
            id="gstin"
            label="GSTIN"
            value={current.shop.gstin}
            onChange={(v) => setShop("gstin", v)}
            hint="Optional. Only needed if you invoice with GST."
          />
        </section>

        <section className="space-y-4 border-t border-line pt-7">
          <SectionHeading eyebrow="Money" title="How customers pay you" />
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Payments go to your account, not PrintQ&apos;s.
          </p>

          <div>
            <label htmlFor="gateway" className="text-[13px] font-medium text-ink">
              Payment method
            </label>
            <select
              id="gateway"
              value={current.payment.paymentGateway}
              onChange={(e) => setPayment("paymentGateway", e.target.value)}
              className="mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13.5px] text-ink focus:border-cyan focus:outline-none"
            >
              <option value="none">UPI, confirmed by you at the counter</option>
              {/* Razorpay exists in the schema but is not wired up. Offering it
                  would let a shop pick a gateway that silently behaves as
                  manual UPI, with no auto-verification. */}
              <option value="razorpay" disabled>
                Razorpay — not available yet
              </option>
              <option value="cashfree" disabled={!cashfreeAvailable}>
                Cashfree — verified automatically
                {cashfreeAvailable ? "" : " (not enabled on this server)"}
              </option>
            </select>
          </div>

          {current.payment.paymentGateway === "cashfree" && (
            <InfoNote>
              Cashfree runs on PrintQ&apos;s platform credentials — there is nothing for you to
              paste here. Payments are verified automatically and the customer&apos;s token is
              issued the moment the payment confirms.
            </InfoNote>
          )}

          {current.payment.paymentGateway === "none" && (
            <InfoNote>
              The customer pays by UPI and you press &ldquo;Mark as paid&rdquo; on the order. Their
              token is issued then, not before.
            </InfoNote>
          )}

          <Field
            id="upiId"
            label="Your UPI ID"
            value={current.payment.upiId}
            onChange={(v) => setPayment("upiId", v)}
            placeholder="yourshop@okhdfcbank"
            hint="Used to build the payment link a customer taps. Leave blank if you only use a gateway."
          />

          {current.payment.paymentGateway !== "none" && (
            <Field
              id="gatewayAccount"
              label="Gateway account ID"
              value={current.payment.paymentGatewayAccountId}
              onChange={(v) => setPayment("paymentGatewayAccountId", v)}
              placeholder="Leave blank"
              hint="Leave this blank. It is reserved for a future phase where each shop has its own sub-merchant account and payments settle directly to you."
            />
          )}
        </section>

        <section className="space-y-4 border-t border-line pt-7">
          <SectionHeading eyebrow="Privacy" title="Customer files" />
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Uploaded documents are stored privately and deleted automatically. Neither PrintQ nor
            anyone else can reach them without going through your dashboard.
          </p>
          <div>
            <label htmlFor="retention" className="text-[13px] font-medium text-ink">
              Delete files after
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="retention"
                type="number"
                min="1"
                max="168"
                value={current.payment.retentionHours}
                onChange={(e) => setPayment("retentionHours", e.target.value)}
                className="font-data w-24 border border-line bg-paper px-3 py-2 text-[13.5px] text-ink focus:border-cyan focus:outline-none"
              />
              <span className="text-[13px] text-ink-soft">hours (1 to 168)</span>
            </div>
          </div>
        </section>

        {saveError && <ErrorNote>{saveError}</ErrorNote>}
        {warnings.map((w) => (
          <InfoNote key={w}>{w}</InfoNote>
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <button
            type="submit"
            disabled={saving}
            className="border border-ink bg-ink px-6 py-2.5 text-[13.5px] font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
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
      </form>

      <section className="max-w-2xl space-y-3 border-t border-line pt-7">
        <SectionHeading eyebrow="Account" title="Your PrintQ licence" />
        <div className="border border-line bg-paper px-4 py-3.5">
          {data.licence ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <StatusPill tone={data.licence.status === "active" ? "success" : "warning"}>
                {data.licence.status}
              </StatusPill>
              <span className="text-[13px] text-ink-soft">
                {data.licence.plan === "setup_12mo" ? "Setup + 12 months" : data.licence.plan}
              </span>
              <span className="font-data text-[11px] uppercase tracking-[0.08em] text-ink-soft">
                valid until {absoluteTime(data.licence.expires_at)}
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-ink-soft">No licence record found for this shop.</p>
          )}
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-soft">
          Setting up the printer connection has moved to{" "}
          <Link href="/dashboard/agent" className="text-cyan underline underline-offset-2">
            Agent
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {!required && <span className="ml-1.5 text-[11px] font-normal text-ink-soft">optional</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1.5 w-full border border-line bg-paper px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-soft/50 focus:border-cyan focus:outline-none"
      />
      {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  );
}
