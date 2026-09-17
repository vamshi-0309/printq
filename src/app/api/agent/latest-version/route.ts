import { NextResponse } from "next/server";
import { fetchLatestRelease } from "@/lib/agentRelease";

/**
 * What the newest published agent is.
 *
 * Deliberately unauthenticated and free of shop data: it answers the same
 * thing for everyone, and the answer is already public on the releases page.
 * Requiring agent credentials would mean an agent that had lost its pairing
 * could never learn there was a fixed build.
 *
 * This reports; it does not update. Nothing here pushes a binary at a shop
 * mid-shift, and the agent has no auto-installer — an agent that finds a newer
 * version says so in its window and links to the download. Reliability on a
 * counter PC is worth more than being current, and a silent self-replacing
 * printer service is exactly the kind of thing that breaks on a Saturday.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await fetchLatestRelease();

  if (!release) {
    // No published build. An agent asking should carry on unchanged rather
    // than treat this as an error worth showing anyone.
    return NextResponse.json({ available: false });
  }

  return NextResponse.json({
    available: true,
    version: release.version,
    downloadUrl: release.downloadUrl,
    releaseNotesUrl: release.releaseNotesUrl,
    publishedAt: release.publishedAt,
  });
}
