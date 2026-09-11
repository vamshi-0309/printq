import { describe, it, expect } from "vitest";
import { evaluateShopReadiness } from "../shopReadiness";

/**
 * Shop open, agent online, and printer available are three separate facts.
 *
 * The bug this prevents: one green light standing for all three. A shop can be
 * open and taking payments with a dead agent, and the money keeps arriving
 * while nothing prints. Each condition has to be able to fail on its own and
 * say so.
 */

const NOW = new Date("2026-09-09T16:00:00Z");
const fresh = new Date(NOW.getTime() - 20_000).toISOString();
const stale = new Date(NOW.getTime() - 10 * 60_000).toISOString();

const livePrinter = { id: "p1", is_enabled: true, is_default: true, last_status: "ready" };

describe("the three signals are independent", () => {
  it("an open shop with a dead agent is open and offline, not simply broken", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1.0.0", last_heartbeat_at: stale }],
      printers: [livePrinter],
      now: NOW,
    });

    expect(r.acceptingOrders).toBe(true);
    expect(r.agentOnline).toBe(false);
    // A printer is enabled; whether it can be reached is the agent's problem.
    expect(r.printerAvailable).toBe(true);
    expect(r.blockers.map((b) => b.code)).toContain("agent_offline");
  });

  it("a live agent with every printer disabled cannot print", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [{ ...livePrinter, is_enabled: false }],
      now: NOW,
    });

    expect(r.agentOnline).toBe(true);
    expect(r.printerAvailable).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("no_printer_enabled");
  });

  it("reports nothing wrong when all three hold", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [livePrinter],
      now: NOW,
    });

    expect(r.acceptingOrders).toBe(true);
    expect(r.agentOnline).toBe(true);
    expect(r.printerAvailable).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });
});

describe("agent liveness comes from heartbeat freshness", () => {
  it("ignores the stored status column entirely", () => {
    // print_agents.status is only ever set to "online" and never back, so an
    // agent killed hours ago still reads "online" in the database.
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: stale }],
      printers: [livePrinter],
      now: NOW,
    });
    expect(r.agentOnline).toBe(false);
  });

  it("honours a shop's own heartbeat timeout", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      heartbeatTimeoutSeconds: 1200,
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: stale }],
      printers: [livePrinter],
      now: NOW,
    });
    expect(r.agentOnline).toBe(true);
  });

  it("puts the live agent first when several are paired", () => {
    // This shop really does have four rows, three of which never ran.
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [
        { id: "dead1", hostname: null, version: null, last_heartbeat_at: null },
        { id: "dead2", hostname: null, version: null, last_heartbeat_at: null },
        { id: "live", hostname: "ACER", version: "1.0.0", last_heartbeat_at: fresh },
        { id: "dead3", hostname: null, version: null, last_heartbeat_at: null },
      ],
      printers: [livePrinter],
      now: NOW,
    });

    expect(r.activeAgent?.id).toBe("live");
    expect(r.agentOnline).toBe(true);
    expect(r.staleAgentCount).toBe(3);
  });

  it("counts no agents as a blocker distinct from an offline one", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [],
      printers: [],
      now: NOW,
    });
    const codes = r.blockers.map((b) => b.code);
    expect(codes).toContain("no_agent");
    expect(codes).not.toContain("agent_offline");
    // With no agent at all, "no printers detected" would be noise on top.
    expect(codes).not.toContain("no_printer");
  });
});

describe("licence and shop status govern taking orders, not printing", () => {
  it("stops new orders when the licence has run out", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [livePrinter],
      licence: {
        status: "active",
        expires_at: new Date(NOW.getTime() - 60 * 24 * 3600_000).toISOString(),
        grace_period_days: 7,
      },
      now: NOW,
    });

    expect(r.acceptingOrders).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("licence");
    // Printing carries on: work already paid for is not held hostage.
    expect(r.agentOnline).toBe(true);
    expect(r.printerAvailable).toBe(true);
  });

  it("keeps accepting orders during the grace period", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [livePrinter],
      licence: {
        status: "active",
        expires_at: new Date(NOW.getTime() - 2 * 24 * 3600_000).toISOString(),
        grace_period_days: 7,
      },
      now: NOW,
    });
    expect(r.acceptingOrders).toBe(true);
    expect(r.licence?.effectiveStatus).toBe("grace");
  });

  it("reports a suspended shop as closed", () => {
    const r = evaluateShopReadiness({
      shopStatus: "suspended",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [livePrinter],
      now: NOW,
    });
    expect(r.acceptingOrders).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("shop_inactive");
  });
});

describe("printer accounting", () => {
  it("counts enabled printers separately from all printers", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [
        livePrinter,
        { id: "p2", is_enabled: false, is_default: false, last_status: "ready" },
        { id: "p3", is_enabled: true, is_default: false, last_status: null },
      ],
      now: NOW,
    });
    expect(r.printerCount).toBe(3);
    expect(r.enabledPrinterCount).toBe(2);
    expect(r.defaultPrinter?.id).toBe("p1");
  });

  it("does not report a disabled printer as the usable default", () => {
    const r = evaluateShopReadiness({
      shopStatus: "active",
      agents: [{ id: "a1", hostname: "ACER", version: "1", last_heartbeat_at: fresh }],
      printers: [{ id: "p1", is_enabled: false, is_default: true, last_status: "ready" }],
      now: NOW,
    });
    expect(r.defaultPrinter).toBeNull();
    expect(r.printerAvailable).toBe(false);
  });
});
