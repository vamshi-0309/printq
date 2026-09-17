import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchLatestRelease,
  installerDownloadUrl,
  versionFromTag,
  formatSize,
  INSTALLER_ASSET_NAME,
  AGENT_TAG_PREFIX,
} from "../agentRelease";

/**
 * The download link a shop is handed.
 *
 * The bug this replaces: /downloads/PrintQAgent-setup.exe was hard-coded into
 * the dashboard and served the app's own 404 page, because no installer was
 * ever published there. So the rule enforced here is that the site only ever
 * offers a download it has confirmed exists, and every way of failing to
 * confirm that resolves to "not available" rather than to a dead link or a
 * thrown error on a marketing page.
 */

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "agent-v1.0.0",
    published_at: "2026-09-17T10:00:00Z",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/vamshi-0309/printq/releases/tag/agent-v1.0.0",
    assets: [
      {
        name: INSTALLER_ASSET_NAME,
        size: 41_000_000,
        browser_download_url: "https://github.com/…/PrintQAgent-Setup.exe",
      },
    ],
    ...overrides,
  };
}

function mockGitHub(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response)
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_INSTALLER_URL;
});

describe("the stable download address", () => {
  it("points at the latest release, not a versioned asset", () => {
    const url = installerDownloadUrl();
    expect(url).toContain("/releases/latest/download/");
    expect(url).toContain(INSTALLER_ASSET_NAME);
    // No version in the path: this link is printed, bookmarked and pasted
    // into dashboards, and must survive v1.0.1.
    expect(url).not.toMatch(/\/1\.0\.0\//);
  });

  it("is https", () => {
    expect(installerDownloadUrl().startsWith("https://")).toBe(true);
  });

  it("can be redirected to a mirror without code changes", () => {
    process.env.AGENT_INSTALLER_URL = "https://cdn.example.com/PrintQAgent-Setup.exe";
    expect(installerDownloadUrl()).toBe("https://cdn.example.com/PrintQAgent-Setup.exe");
  });
});

describe("finding the published release", () => {
  it("returns the newest agent release", async () => {
    mockGitHub([release()]);
    const found = await fetchLatestRelease();
    expect(found?.version).toBe("1.0.0");
    expect(found?.tag).toBe("agent-v1.0.0");
    expect(found?.downloadUrl).toBe(installerDownloadUrl());
  });

  it("reports the installer size for the page", async () => {
    mockGitHub([release()]);
    expect((await fetchLatestRelease())?.sizeBytes).toBe(41_000_000);
  });

  it("ignores releases that are not agent releases", async () => {
    // A website tag must never be offered as a Windows installer.
    mockGitHub([release({ tag_name: "v2.0.0" })]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("ignores drafts", async () => {
    mockGitHub([release({ draft: true })]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("ignores pre-releases", async () => {
    mockGitHub([release({ prerelease: true })]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("ignores a release with no installer attached", async () => {
    // A tag pushed before the build finished, or a failed upload.
    mockGitHub([release({ assets: [] })]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("ignores a release carrying some other asset", async () => {
    mockGitHub([release({ assets: [{ name: "notes.txt", size: 10, browser_download_url: "x" }] })]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("picks the first usable release when several are listed", async () => {
    mockGitHub([
      release({ tag_name: "agent-v1.1.0", draft: true }),
      release({ tag_name: "agent-v1.0.9" }),
      release({ tag_name: "agent-v1.0.0" }),
    ]);
    expect((await fetchLatestRelease())?.version).toBe("1.0.9");
  });
});

describe("failures never produce a dead link", () => {
  it("returns null when nothing is published", async () => {
    mockGitHub([]);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null when GitHub rate-limits us", async () => {
    mockGitHub({ message: "API rate limit exceeded" }, false);
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("returns null when the response is not a list", async () => {
    mockGitHub({ message: "Not Found" });
    expect(await fetchLatestRelease()).toBeNull();
  });

  it("does not throw on malformed entries", async () => {
    mockGitHub([{}, { tag_name: null }, release()]);
    await expect(fetchLatestRelease()).resolves.toBeTruthy();
  });
});

describe("version formatting", () => {
  it("strips the agent tag prefix", () => {
    expect(versionFromTag(`${AGENT_TAG_PREFIX}1.2.3`)).toBe("1.2.3");
  });

  it("strips a plain v prefix", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
  });

  it("leaves a bare version alone", () => {
    expect(versionFromTag("1.2.3")).toBe("1.2.3");
  });

  it("formats a size in MB", () => {
    expect(formatSize(41_000_000)).toBe("39 MB");
  });

  it("says nothing when the size is unknown", () => {
    expect(formatSize(null)).toBe("");
    expect(formatSize(0)).toBe("");
  });
});
