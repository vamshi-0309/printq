import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="text-center">
          <p className="font-data text-6xl font-bold text-line">404</p>
          <h1 className="mt-4 font-display text-2xl font-bold text-ink">Page not found</h1>
          <p className="mt-2 text-ink-soft">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              href="/"
              className="bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/90"
            >
              Go home
            </Link>
            <Link
              href="/contact"
              className="border border-ink px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper-grey"
            >
              Contact us
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
