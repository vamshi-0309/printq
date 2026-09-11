import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canTransition } from "../jobState";

/**
 * Structural guard on the agent's claim endpoint.
 *
 * THE BUG
 *   The route selected the oldest QUEUED job in the whole table with no shop
 *   filter, then checked afterwards whether it belonged to the calling shop
 *   and returned 204 if not. Another shop's stuck job therefore blocked every
 *   agent permanently — the same row was picked and rejected on every poll,
 *   and nothing behind it was ever reached.
 *
 * WHAT THIS FILE CAN AND CANNOT SHOW
 *   These are source-level assertions, not behavioural ones. The property that
 *   matters here is the *shape of the query*: whether the shop filter is
 *   applied by the database or after the fact. A mock Supabase client would
 *   answer whatever its author made it answer and would not have caught the
 *   original bug, because the original code's filters were all individually
 *   plausible. The behavioural proof lives in the two-shop integration run
 *   against the real database, where PostgREST decides what the join returns.
 *
 *   So this file exists to stop the specific mistake coming back, and to keep
 *   the transition rule honest.
 */

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "src/app/api/agent/jobs/claim/route.ts"
);
const RAW = fs.readFileSync(SOURCE_PATH, "utf8");

/**
 * Comments are stripped before structural assertions — the file explains the
 * old unscoped query in prose, and a naive search would match the explanation
 * rather than the code.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the candidate query is scoped to the calling shop", () => {
  it("filters by the authenticated shop id in the query itself", () => {
    expect(SOURCE).toMatch(/\.eq\(\s*["']orders\.shop_id["']\s*,\s*auth\.shopId\s*\)/);
  });

  it("uses an inner join so the filter applies to the job rows", () => {
    // Without `!inner` the embedded filter does not restrict the outer rows,
    // which would reintroduce the bug in a subtler form.
    expect(SOURCE).toMatch(/orders!inner\(/);
  });

  it("only considers jobs whose order is actually paid", () => {
    expect(SOURCE).toMatch(/\.eq\(\s*["']orders\.payment_status["']\s*,\s*["']paid["']\s*\)/);
  });

  it("only considers QUEUED jobs", () => {
    expect(SOURCE).toMatch(/\.eq\(\s*["']state["']\s*,\s*["']QUEUED["']\s*\)/);
  });

  it("re-checks the shop on the joined row before writing anything", () => {
    expect(SOURCE).toMatch(/order\.shop_id\s*!==\s*auth\.shopId/);
  });

  it("scopes the order update by shop as well as by id", () => {
    const update = SOURCE.slice(SOURCE.indexOf('print_status: "claimed"'));
    expect(update).toMatch(/\.eq\(\s*["']shop_id["']\s*,\s*auth\.shopId\s*\)/);
  });

  it("never orders the whole table by created_at without a shop filter", () => {
    // The original: .eq("state","QUEUED").order("created_at").limit(1)
    // with no shop predicate anywhere in the chain.
    const queryBlock = SOURCE.slice(
      SOURCE.indexOf('.from("print_jobs")'),
      SOURCE.indexOf(".limit(CANDIDATE_LIMIT)")
    );
    expect(queryBlock).toContain("auth.shopId");
  });
});

describe("there is exactly one claim mechanism", () => {
  it("does not call the RPC that was never implemented", () => {
    expect(SOURCE).not.toMatch(/claim_next_job/);
    expect(SOURCE).not.toMatch(/\.rpc\(/);
  });

  it("has no path that returns 204 after finding a job", () => {
    // The old route returned 204 unconditionally after the RPC branch, so a
    // job the RPC did return was discarded and the agent was told there was
    // no work.
    //
    // Two 204s remain and both mean "nothing to do": one when the candidate
    // list is empty, one when every candidate was skipped. Neither may sit
    // between claiming a job and returning it.
    const noContent = [...SOURCE.matchAll(/status:\s*204/g)];
    expect(noContent).toHaveLength(2);

    const claim = SOURCE.indexOf('state: "CLAIMED"');
    const successReturn = SOURCE.lastIndexOf("return NextResponse.json({");
    expect(claim).toBeGreaterThan(-1);
    expect(successReturn).toBeGreaterThan(claim);

    // The empty-candidates 204 is before the claim; the exhausted-candidates
    // 204 is after the success return. Nothing lands in between.
    expect(noContent[0].index).toBeLessThan(claim);
    expect(noContent[1].index).toBeGreaterThan(successReturn);
  });
});

describe("claiming is a compare-and-swap", () => {
  it("updates only rows still QUEUED", () => {
    const swap = SOURCE.slice(SOURCE.indexOf('state: "CLAIMED"'));
    expect(swap).toMatch(/\.eq\(\s*["']state["']\s*,\s*["']QUEUED["']\s*\)/);
  });

  it("asks the database which rows it actually changed", () => {
    // Without .select() the update reports nothing, and two agents could both
    // believe they won the job.
    const swap = SOURCE.slice(SOURCE.indexOf('state: "CLAIMED"'));
    expect(swap).toMatch(/\.select\(\s*["']id["']\s*\)/);
  });

  it("treats a swap that matched nothing as a loss, not a win", () => {
    expect(SOURCE).toMatch(/swapped[\s\S]*?length\s*===\s*0/);
  });

  it("records which agent claimed it", () => {
    expect(SOURCE).toMatch(/claimed_by_agent_id:\s*auth\.agentId/);
    expect(SOURCE).toMatch(/claimed_at:/);
  });
});

describe("a claim cannot strand a job", () => {
  it("signs the download URL before the claim, not after", () => {
    const signIndex = SOURCE.indexOf("getSignedDownloadUrl");
    const claimIndex = SOURCE.indexOf('state: "CLAIMED"');
    expect(signIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(-1);
    // Signing after claiming would leave the job CLAIMED with no way for the
    // agent to fetch the document.
    expect(signIndex).toBeLessThan(claimIndex);
  });

  it("skips a job it cannot sign rather than claiming it", () => {
    // Everything between signing and the claim is the failure path; it must
    // exit the iteration rather than fall through into the compare-and-swap.
    const betweenSignAndClaim = SOURCE.slice(
      SOURCE.indexOf("getSignedDownloadUrl"),
      SOURCE.indexOf('state: "CLAIMED"')
    );
    expect(betweenSignAndClaim).toContain("continue;");
  });

  it("parks a permanently missing document instead of skipping it forever", () => {
    // Skipping quietly on every poll is how a paid order becomes invisible:
    // queued in the database, never printed, nobody told.
    expect(SOURCE).toMatch(/parkUndeliverable\(/);
    expect(SOURCE).toMatch(/state:\s*"HELD"/);
    expect(SOURCE).toMatch(/not\.\?found/);
  });
});

describe("the state machine still governs the transition", () => {
  it("QUEUED may become CLAIMED", () => {
    expect(canTransition("QUEUED", "CLAIMED")).toBe(true);
  });

  it("a finished job may never be claimed", () => {
    expect(canTransition("COMPLETED", "CLAIMED")).toBe(false);
    expect(canTransition("CANCELLED", "CLAIMED")).toBe(false);
    expect(canTransition("FAILED", "CLAIMED")).toBe(false);
  });

  it("an already-claimed or in-flight job may not be re-claimed", () => {
    expect(canTransition("CLAIMED", "CLAIMED")).toBe(false);
    expect(canTransition("PRINT_ATTEMPTED", "CLAIMED")).toBe(false);
    expect(canTransition("PRINTING", "CLAIMED")).toBe(false);
  });

  it("the route consults canTransition rather than assuming", () => {
    expect(SOURCE).toMatch(/canTransition\(\s*job\.state/);
  });
});

describe("the shop's chosen printer travels with the job", () => {
  it("resolves the printer from the shop's own rows", () => {
    expect(SOURCE).toMatch(/selectPrinterForShop\(/);
    const query = SOURCE.slice(SOURCE.indexOf('.from("printers")'));
    expect(query.slice(0, 400)).toMatch(/\.eq\(\s*["']shop_id["']\s*,\s*auth\.shopId\s*\)/);
  });

  it("refuses to claim when there is work but no usable printer", () => {
    // Claiming would move the job out of QUEUED into a state only a human can
    // leave, for a shop that cannot print it.
    expect(SOURCE).toMatch(/!selection\.ok/);
    expect(SOURCE).toMatch(/status:\s*409/);
    const refusal = SOURCE.slice(SOURCE.indexOf("!selection.ok"), SOURCE.indexOf('state: "CLAIMED"'));
    expect(refusal).toMatch(/selection\.code/);
  });

  it("sends the printer in the claim response", () => {
    const response = SOURCE.slice(SOURCE.lastIndexOf("return NextResponse.json({"));
    // The selected printer is its own field on the response, not buried in
    // printSettings, because the agent treats it as an instruction rather than
    // a formatting hint.
    expect(response.split("\n").some((line) => line.trim() === "printer,")).toBe(true);
  });

  it("records the assigned printer on the order", () => {
    // orders.printer_id is what the attempt endpoint reads, so the attempt is
    // filed against the printer the server chose rather than one the agent
    // names for itself.
    expect(SOURCE).toMatch(/printer_id:\s*printer\.id/);
  });

  it("selects the printer before claiming anything", () => {
    expect(SOURCE.indexOf("selectPrinterForShop(")).toBeLessThan(SOURCE.indexOf('state: "CLAIMED"'));
  });
});
