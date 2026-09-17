/**
 * Where the Windows installer lives, and whether it exists yet.
 *
 * The installer is a ~40 MB signed-ish binary rebuilt on every agent release.
 * Committing it into this repository would bloat every clone and every Vercel
 * deployment with a file the web app never reads, and would put a new binary
 * in git history for each version. So it is published as a GitHub Release
 * asset and the site points at it.
 *
 * GitHub serves `/releases/latest/download/<asset>` from whichever release is
 * newest, which is what keeps the customer-facing URL stable across v1.0.0,
 * v1.0.1, v1.1.0 without anything here changing.
 *
 * The honesty requirement: before the first release exists, that URL 404s.
 * Rather than hand a shop owner a dead button, `fetchLatestRelease` asks
 * GitHub what is actually published and the page renders accordingly. The
 * lookup is cached and every failure is treated as "unknown" rather than
 * throwing, because the marketing page must render even when GitHub is down.
 */

export const GITHUB_OWNER = "vamshi-0309";
export const GITHUB_REPO = "printq";

/** The asset name the release workflow attaches. Must match the workflow. */
export const INSTALLER_ASSET_NAME = "PrintQAgent-Setup.exe";

/** Release tags for the agent are prefixed so they can't collide with web tags. */
export const AGENT_TAG_PREFIX = "agent-v";

/**
 * The stable public download address. Never changes between versions.
 *
 * An explicit override exists for a self-hosted mirror, but no shop and no
 * developer has to set it for the normal path to work.
 */
export function installerDownloadUrl(): string {
  const override = process.env.AGENT_INSTALLER_URL?.trim();
  if (override) return override;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${INSTALLER_ASSET_NAME}`;
}

export interface AgentRelease {
  /** "1.0.0" — the tag with its prefix stripped. */
  version: string;
  tag: string;
  publishedAt: string | null;
  downloadUrl: string;
  sizeBytes: number | null;
  releaseNotesUrl: string;
}

/** Turn `agent-v1.2.3` into `1.2.3`; leave anything else alone. */
export function versionFromTag(tag: string): string {
  return tag.startsWith(AGENT_TAG_PREFIX) ? tag.slice(AGENT_TAG_PREFIX.length) : tag.replace(/^v/, "");
}

interface GitHubRelease {
  tag_name: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

/**
 * The newest published agent release, or null when there isn't one.
 *
 * Returns null — rather than throwing — for every failure mode: no release
 * yet, rate limiting, GitHub unreachable, a release with no installer
 * attached. Callers render a "not yet available" state, which is correct for
 * all of them and never a lie.
 */
export async function fetchLatestRelease(): Promise<AgentRelease | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PrintQ-Website",
        },
        // Cached so a burst of visitors cannot exhaust GitHub's unauthenticated
        // rate limit, and so the page stays fast.
        next: { revalidate: 600 },
      }
    );

    if (!res.ok) return null;

    const releases = (await res.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return null;

    // Only agent releases count; a website tag must not be offered as an
    // installer. Drafts and pre-releases are not handed to shops.
    const candidate = releases.find(
      (r) =>
        !r.draft &&
        !r.prerelease &&
        r.tag_name?.startsWith(AGENT_TAG_PREFIX) &&
        r.assets?.some((a) => a.name === INSTALLER_ASSET_NAME)
    );

    if (!candidate) return null;

    const asset = candidate.assets.find((a) => a.name === INSTALLER_ASSET_NAME)!;

    return {
      version: versionFromTag(candidate.tag_name),
      tag: candidate.tag_name,
      publishedAt: candidate.published_at,
      // The stable URL, not the asset's versioned one, so a link copied from
      // this page keeps working after the next release.
      downloadUrl: installerDownloadUrl(),
      sizeBytes: typeof asset.size === "number" ? asset.size : null,
      releaseNotesUrl: candidate.html_url,
    };
  } catch {
    return null;
  }
}

export function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
