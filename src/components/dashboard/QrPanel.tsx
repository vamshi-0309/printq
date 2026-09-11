"use client";

import { useSyncExternalStore } from "react";
import { ShopQr } from "@/components/ShopQr";
import { InfoNote, ErrorNote } from "@/components/dashboard/primitives";

/**
 * The shop's QR code, pointed at a URL that actually works.
 *
 * A QR code goes on a laminated card and stays on the counter for months, so
 * the address encoded in it has to be right the first time. The page used to
 * fall back to `https://printq.in` whenever NEXT_PUBLIC_APP_URL was unset —
 * printing a poster aimed at a domain that isn't serving this shop, with
 * nothing on screen to suggest anything was wrong.
 *
 * The origin the owner is currently browsing is the honest fallback: it is,
 * by construction, an address that reaches this dashboard. When it is used in
 * place of a configured public URL, the page says so, because a tunnel or
 * localhost address is fine for testing and useless on a printed card.
 *
 * The origin is read through useSyncExternalStore rather than an effect: the
 * server has no window, and this is precisely the "value from outside React"
 * case that hook exists for.
 */

const subscribeToNothing = () => () => {};

export function QrPanel({
  slug,
  configuredAppUrl,
}: {
  slug: string;
  /** NEXT_PUBLIC_APP_URL, trimmed of a trailing slash. Empty when unset. */
  configuredAppUrl: string;
}) {
  const browserOrigin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => ""
  );

  const baseUrl = configuredAppUrl || browserOrigin;
  const usingFallback = !configuredAppUrl && Boolean(browserOrigin);
  const looksLocal = /localhost|127\.0\.0\.1|\.local(:|$)/i.test(baseUrl);

  if (!baseUrl) {
    // Server render, before the browser origin is known.
    return <div className="h-72 animate-pulse border border-line bg-paper" />;
  }

  return (
    <div className="space-y-4">
      {usingFallback && (
        <InfoNote>
          This code points at <span className="font-data">{baseUrl}</span>, the address you are
          using right now, because no public address is configured for PrintQ yet. Set
          NEXT_PUBLIC_APP_URL before printing it for the counter.
        </InfoNote>
      )}

      {looksLocal && (
        <ErrorNote>
          This is a local address. A customer&apos;s phone will not be able to open it — don&apos;t
          print this version.
        </ErrorNote>
      )}

      <ShopQr shopSlug={slug} appUrl={baseUrl} />
    </div>
  );
}
