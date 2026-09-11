import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = { title: "Privacy policy — PrintQ" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-ink-soft">
          <h1 className="font-display text-3xl font-bold text-ink">Privacy policy</h1>
          <p className="mt-2 text-xs text-ink-soft">Last updated: September 2026</p>

          <p className="mt-6">
            PrintQ (&quot;we&quot;, &quot;us&quot;) operates the printq.in website and
            the PrintQ Windows desktop agent. This policy explains what data we collect,
            why, and how we protect it.
          </p>

          <h2 className="mt-8 font-medium text-ink">1. Data we collect</h2>
          <h3 className="mt-4 text-ink">Shop owners</h3>
          <p className="mt-1">
            When you register a shop, we collect your name, phone number, email address,
            shop name, city, and optionally your address, GSTIN, and UPI ID. This data
            is used solely to operate your PrintQ dashboard and licence.
          </p>
          <h3 className="mt-4 text-ink">Customers</h3>
          <p className="mt-1">
            When a customer uploads a file for printing, we store the file temporarily
            and create an order record with print settings. We do not collect customer
            names, emails, phone numbers, or any identity information. A random session
            token is generated so the customer can check order status — no login is
            required.
          </p>

          <h2 className="mt-8 font-medium text-ink">2. Document handling</h2>
          <p className="mt-2">
            Uploaded documents are stored in isolated, encrypted storage. Each document
            is accessible only to the shop it was uploaded to — never to other shops or
            other customers. Documents are automatically deleted after the shop&apos;s
            configured retention period (default: 24 hours). Shop owners can set this
            between 1 and 168 hours.
          </p>

          <h2 className="mt-8 font-medium text-ink">3. Payment data</h2>
          <p className="mt-2">
            PrintQ does not process, store, or have access to customer payment
            information. Print payments go directly from the customer to the shop&apos;s
            own UPI account or payment gateway. We never see card numbers, bank details,
            or UPI PINs.
          </p>

          <h2 className="mt-8 font-medium text-ink">4. Cookies and tracking</h2>
          <p className="mt-2">
            We use essential cookies only — session authentication for shop owners. We
            do not use analytics trackers, advertising pixels, or third-party tracking
            scripts. The customer print flow uses no cookies at all.
          </p>

          <h2 className="mt-8 font-medium text-ink">5. Data sharing</h2>
          <p className="mt-2">
            We do not sell, rent, or share your data with third parties. Data may be
            disclosed only when required by Indian law or a valid court order.
          </p>

          <h2 className="mt-8 font-medium text-ink">6. Data storage and security</h2>
          <p className="mt-2">
            All data is stored on servers managed by Supabase with encryption at rest
            and in transit. Access to production systems is restricted to authorised
            personnel only. Row-level security policies ensure shops can only access
            their own data.
          </p>

          <h2 className="mt-8 font-medium text-ink">7. Your rights</h2>
          <p className="mt-2">
            Shop owners can export or delete their account data at any time by
            contacting us. Under the Information Technology Act, 2000 and its rules,
            you have the right to access, correct, and request deletion of your personal
            data.
          </p>

          <h2 className="mt-8 font-medium text-ink">8. Contact</h2>
          <p className="mt-2">
            For privacy-related questions, email us at privacy@printq.in or use
            the <a href="/contact" className="text-cyan hover:underline">contact form</a>.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
