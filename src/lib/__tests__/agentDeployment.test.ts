import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Source-level guards for the two things added for shop deployment: the
 * download path a shop owner clicks, and the endpoint their agent calls to
 * choose a printer.
 *
 * Structural assertions rather than running route handlers, matching the
 * approach already used for the claim route: what needs protecting here is
 * shape (this query is scoped by shop, that path never 404s), and a shape can
 * be checked without standing up Supabase.
 */

const root = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.resolve(root, relative), "utf8");
}

/** Comments explain the old broken behaviour; they must not satisfy a check. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the legacy download URL still resolves", () => {
  const routeFile = "src/app/downloads/PrintQAgent-setup.exe/route.ts";

  it("the route the dashboard used to link to exists", () => {
    // It previously served the application's 404 page.
    expect(fs.existsSync(path.resolve(root, routeFile))).toBe(true);
  });

  it("redirects rather than 404ing", () => {
    const source = code(read(routeFile));
    expect(source).toMatch(/NextResponse\.redirect/);
    expect(source).not.toMatch(/notFound\(\)/);
    expect(source).not.toMatch(/status:\s*404/);
  });

  it("falls back to the download page when nothing is published", () => {
    const source = code(read(routeFile));
    expect(source).toContain("/downloads/windows");
  });

  it("does not stream the binary through the serverless function", () => {
    // A 40 MB proxy through a function with an execution limit is a timeout
    // waiting to happen; GitHub's CDN serves it instead.
    const source = code(read(routeFile));
    expect(source).not.toMatch(/arrayBuffer|body:\s*res|pipe/);
  });
});

describe("the download page tells the truth", () => {
  const pageFile = "src/app/downloads/windows/page.tsx";

  it("exists", () => {
    expect(fs.existsSync(path.resolve(root, pageFile))).toBe(true);
  });

  it("only renders a download button when a release was found", () => {
    const source = code(read(pageFile));
    expect(source).toMatch(/release\s*\?/);
    expect(source).toMatch(/href=\{release\.downloadUrl\}/);
  });

  it("never hardcodes a version into the link", () => {
    const source = code(read(pageFile));
    expect(source).not.toMatch(/releases\/download\/agent-v\d/);
  });

  it("promises no terminal, which is the point of the whole exercise", () => {
    const source = read(pageFile);
    expect(source).toMatch(/PowerShell|Command Prompt/);
    expect(source).toMatch(/Python/);
  });
});

describe("the agent's printer endpoint is shop-scoped", () => {
  const routeFile = "src/app/api/agent/printers/default/route.ts";
  const source = code(read(routeFile));

  it("authenticates the agent before anything else", () => {
    expect(source).toMatch(/authenticateAgent\(req\)/);
    const auth = source.indexOf("authenticateAgent");
    const db = source.indexOf("createServiceRoleClient");
    expect(auth).toBeLessThan(db);
  });

  it("scopes the printer lookup to the calling agent's shop", () => {
    expect(source).toMatch(/\.eq\(["']shop_id["'],\s*auth\.shopId\)/);
  });

  it("scopes both writes to that shop too", () => {
    // Clearing the old default and setting the new one must not reach across
    // shops, whatever id or name was posted.
    const writes = source.split(".update(").slice(1);
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const write of writes) {
      expect(write.slice(0, 400)).toMatch(/shop_id["']?,\s*auth\.shopId|\.eq\(["']id["'],\s*printer\.id\)/);
    }
  });

  it("refuses a printer that is switched off", () => {
    expect(source).toMatch(/is_enabled/);
    expect(source).toMatch(/status:\s*409/);
  });

  it("keeps one default per shop", () => {
    expect(source).toMatch(/is_default:\s*false/);
    expect(source).toMatch(/is_default:\s*true/);
    expect(source).toMatch(/\.neq\(/);
  });

  it("records the change", () => {
    expect(source).toMatch(/audit_logs/);
  });
});

describe("no backend secret can reach the agent or the browser", () => {
  const agentFiles = [
    "agent/printq_agent.py",
    "agent/config.py",
    "agent/app_ui.py",
    "agent/agent_service.py",
    "agent/sumatra_setup.py",
  ];

  const forbidden = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "CASHFREE_SECRET_KEY",
    "CASHFREE_APP_ID",
    "service_role",
  ];

  it("the agent source contains no backend credentials", () => {
    for (const file of agentFiles) {
      const source = read(file);
      for (const secret of forbidden) {
        expect(source, `${secret} in ${file}`).not.toContain(secret);
      }
    }
  });

  it("the installer script contains no backend credentials", () => {
    const source = read("installer/PrintQAgent.iss");
    for (const secret of forbidden) {
      expect(source, secret).not.toContain(secret);
    }
  });

  it("the release workflow does not bake secrets into the build", () => {
    const source = read(".github/workflows/agent-release.yml");
    for (const secret of forbidden) {
      expect(source, secret).not.toContain(secret);
    }
  });

  it("the public download page pulls in no server-only module", () => {
    const source = read("src/app/downloads/windows/page.tsx");
    expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
