import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Terms of service — PrintQ" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-ink-soft">
          <h1 className="font-display text-3xl font-bold text-ink">Terms of service</h1>
          <p className="mt-2 text-xs text-ink-soft">Last updated: September 2026</p>

          <p className="mt-6">
            These terms govern your use of the PrintQ platform operated by PrintQ
            (&quot;we&quot;, &quot;us&quot;). By registering a shop or using the
            customer print flow, you agree to these terms.
          </p>

          <h2 className="mt-8 font-medium text-ink">1. The service</h2>
          <p className="mt-2">
            PrintQ provides software that lets printing shops accept document uploads
            via QR code, manage a print queue, and process jobs through a Windows
            desktop agent. Customers scan a QR code, upload documents, pay the shop
            directly, and collect prints.
          </p>

          <h2 className="mt-8 font-medium text-ink">2. Shop registration and licence</h2>
          <p className="mt-2">
            Shops pay a one-time setup fee of &#x20B9;7,500 (including GST) covering
            software installation, QR code setup, and 12 months of support and updates.
            After 12 months, an annual renewal fee of &#x20B9;3,000 keeps the licence
            active. If not renewed, the software enters a 7-day grace period before
            being deactivated.
          </p>

          <h2 className="mt-8 font-medium text-ink">3. Payments between customers and shops</h2>
          <p className="mt-2">
            PrintQ is not a payment processor. All print payments flow directly from
            the customer to the shop&apos;s own UPI ID or payment gateway account.
            PrintQ does not hold, escrow, or take a commission on these payments. Shops
            are responsible for setting correct prices, confirming payments, and issuing
            receipts where required.
          </p>

          <h2 className="mt-8 font-medium text-ink">4. Document privacy</h2>
          <p className="mt-2">
            Shops must not access, copy, distribute, or retain customer documents beyond
            what is necessary to fulfil the print job. Uploaded files are automatically
            deleted after the shop&apos;s configured retention period. See
            our <a href="/privacy" className="text-cyan hover:underline">privacy policy</a> for
            details.
          </p>

          <h2 className="mt-8 font-medium text-ink">5. Acceptable use</h2>
          <p className="mt-2">
            You may not use PrintQ to print or distribute content that violates Indian
            law, infringes intellectual property rights, or contains illegal material.
            We reserve the right to suspend shops that violate this policy.
          </p>

          <h2 className="mt-8 font-medium text-ink">6. Uptime and liability</h2>
          <p className="mt-2">
            We aim for high availability but do not guarantee uninterrupted service.
            PrintQ is not liable for failed prints, payment disputes between customers
            and shops, loss of business due to downtime, or any indirect or
            consequential damages. Our total liability is limited to the fees paid by
            the shop in the 12 months preceding the claim.
          </p>

          <h2 className="mt-8 font-medium text-ink">7. Termination</h2>
          <p className="mt-2">
            Either party may terminate by giving 30 days&apos; written notice. We may
            suspend or terminate a shop&apos;s access immediately for violation of these
            terms. On termination, all customer data associated with the shop is deleted
            within 30 days.
          </p>

          <h2 className="mt-8 font-medium text-ink">8. Governing law</h2>
          <p className="mt-2">
            These terms are governed by the laws of India. Any disputes shall be subject
            to the exclusive jurisdiction of the courts in Hyderabad, Telangana.
          </p>

          <h2 className="mt-8 font-medium text-ink">9. Changes</h2>
          <p className="mt-2">
            We may update these terms with 30 days&apos; notice via email to registered
            shop owners. Continued use after notice constitutes acceptance.
          </p>

          <h2 className="mt-8 font-medium text-ink">10. Contact</h2>
          <p className="mt-2">
            Questions about these terms? Email legal@printq.in or use
            the <a href="/contact" className="text-cyan hover:underline">contact form</a>.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
