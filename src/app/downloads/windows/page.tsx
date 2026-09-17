import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { fetchLatestRelease, formatSize, GITHUB_OWNER, GITHUB_REPO } from "@/lib/agentRelease";

/**
 * The page a shop owner lands on to get PrintQ onto their counter PC.
 *
 * Written for somebody who runs a photocopy shop, not for a developer: no
 * mention of Python, PyInstaller, tunnels or terminals, because none of those
 * are things they will ever touch. Three numbered steps and one button.
 *
 * When no installer has been published, the button is not rendered as a
 * button. Handing out a link that 404s is how this page got rewritten in the
 * first place.
 */

export const metadata: Metadata = {
  title: "PrintQ Agent for Windows",
  description:
    "Connect your Xerox shop computer to PrintQ. Automatic print queue, works with your existing Windows printers, runs in the background.",
};

// The release lookup is cached upstream; this keeps the page itself fresh
// enough that a new release appears within minutes without a redeploy.
export const revalidate = 600;

const FEATURES = [
  "Prints paid orders automatically",
  "Works with your existing Windows printers",
  "Runs quietly in the background",
  "No PowerShell or Command Prompt",
  "No Python or developer tools to install",
  "Free updates",
];

export default async function WindowsDownloadPage() {
  const release = await fetchLatestRelease();

  return (
    <>
      <SiteHeader />
      <main className="bg-paper">
        <section className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
          <p className="t-eyebrow">For Windows 10 and 11</p>
          <h1 className="t-display-lg mt-3">PrintQ Agent for Windows</h1>
          <p className="t-lead mt-4 max-w-xl">
            The small program that connects your shop computer to PrintQ. Install it once, pair it
            with your shop, and paid orders print by themselves.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            {release ? (
              <a
                href={release.downloadUrl}
                className="inline-flex items-center justify-center gap-2.5 border border-ink bg-ink px-7 py-3.5 text-[15px] font-medium text-paper transition-colors hover:bg-ink-soft"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                Download for Windows
              </a>
            ) : (
              <div className="border border-line bg-paper-grey px-6 py-4">
                <p className="text-[14px] font-medium text-ink">
                  The installer is being prepared
                </p>
                <p className="mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-soft">
                  No build has been published yet. This page will offer the download as soon as
                  the first release is out — nothing needs to change here when it is.
                </p>
              </div>
            )}

            <div className="font-data text-[11px] uppercase tracking-[0.1em] text-ink-soft">
              {release ? (
                <>
                  <p>Version {release.version}</p>
                  <p className="mt-1">
                    Windows 10 / 11
                    {formatSize(release.sizeBytes) ? ` · ${formatSize(release.sizeBytes)}` : ""}
                  </p>
                </>
              ) : (
                <p>Windows 10 / 11</p>
              )}
            </div>
          </div>

          <ul className="mt-12 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-[14px] text-ink">
                <span className="mt-[3px] text-cyan" aria-hidden="true">
                  ✓
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line bg-paper-grey">
          <div className="mx-auto max-w-4xl px-6 py-14">
            <h2 className="t-display-sm">Setting it up</h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {[
                {
                  n: "1",
                  title: "Install it",
                  body: "Download the file, double-click it, and follow the prompts. PrintQ Agent opens by itself when the install finishes.",
                },
                {
                  n: "2",
                  title: "Pair your shop",
                  body: "In your PrintQ dashboard open Agent, generate a pairing code, and type it into the PrintQ Agent window.",
                },
                {
                  n: "3",
                  title: "Pick your printer",
                  body: "PrintQ Agent lists the printers on that computer. Choose the one your customers' work should come out of.",
                },
              ].map((step) => (
                <li key={step.n}>
                  <span className="font-data text-[26px] font-semibold leading-none text-cyan">
                    {step.n}
                  </span>
                  <h3 className="mt-3 text-[15px] font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-12 border-t border-line pt-8">
              <h3 className="text-[14px] font-semibold text-ink">What it needs</h3>
              <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
                {[
                  ["Windows", "Windows 10 or Windows 11, 64-bit"],
                  ["Internet", "An ordinary connection — no router setup"],
                  ["Printer", "Any printer already working in Windows"],
                  ["Account", "A PrintQ shop account to pair with"],
                ].map(([term, detail]) => (
                  <div key={term}>
                    <dt className="font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft">
                      {term}
                    </dt>
                    <dd className="mt-0.5 text-ink">{detail}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-8 text-[12.5px] leading-relaxed text-ink-soft">
                Your computer is never exposed to the internet. PrintQ Agent makes outgoing
                requests only, the same way a browser does.{" "}
                {release ? (
                  <>
                    <a
                      href={release.releaseNotesUrl}
                      className="text-cyan underline underline-offset-2"
                      rel="noreferrer"
                    >
                      Release notes
                    </a>{" "}
                    ·{" "}
                  </>
                ) : null}
                <a
                  href={`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`}
                  className="text-cyan underline underline-offset-2"
                  rel="noreferrer"
                >
                  Source code
                </a>
              </p>

              <p className="mt-6 text-[12.5px] text-ink-soft">
                Already installed?{" "}
                <Link href="/dashboard/agent" className="text-cyan underline underline-offset-2">
                  Get your pairing code
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
