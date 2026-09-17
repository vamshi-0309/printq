import { NextResponse } from "next/server";
import { fetchLatestRelease } from "@/lib/agentRelease";

/**
 * The original download link, kept alive.
 *
 * `/downloads/PrintQAgent-setup.exe` was hard-coded into the dashboard and
 * served the application's 404 page, because nothing was ever published at
 * that path. The link has been handed out, so rather than break it this route
 * forwards to whatever the current installer is.
 *
 * Two outcomes, both honest:
 *
 *   - a published release: 302 to the GitHub asset. A redirect rather than a
 *     proxy, so a 40 MB binary is served by GitHub's CDN and never streams
 *     through a serverless function with an execution timeout.
 *   - nothing published: 303 to the download page, which explains the state.
 *     Never a 404, and never a zero-byte file pretending to be an installer.
 *
 * Route handlers are uncached by default, which is what we want: the moment a
 * release is published this starts resolving without a redeploy.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await fetchLatestRelease();

  if (!release) {
    // 303: send the browser to a page with GET, whatever it asked for here.
    return NextResponse.redirect(
      new URL("/downloads/windows", process.env.NEXT_PUBLIC_APP_URL || "https://printq-rho.vercel.app"),
      303
    );
  }

  // 302 rather than 301/308: the target moves with every release, so nothing
  // about this mapping should be cached permanently by a browser.
  return NextResponse.redirect(release.downloadUrl, 302);
}
