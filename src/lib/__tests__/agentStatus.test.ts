import { describe, it, expect } from "vitest";
import {
  isAgentOnline,
  anyAgentOnline,
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
} from "../agentStatus";

/**
 * A shop is shown as OPEN, and accepts orders, based on this function. The
 * `print_agents.status` column it replaces is only ever written to "online"
 * — nothing sets it back — so an agent that was killed left the shop taking
 * orders it could never print. These tests pin the property that fixes that:
 * liveness decays with time on its own.
 */

const NOW = new Date("2026-09-08T12:00:00Z").getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("isAgentOnline", () => {
  it("is online for a heartbeat just received", () => {
    expect(isAgentOnline(ago(0), 90, NOW)).toBe(true);
  });

  it("is online within the timeout window", () => {
    // The agent beats every 20s, so three missed beats are still fine.
    expect(isAgentOnline(ago(20), 90, NOW)).toBe(true);
    expect(isAgentOnline(ago(89), 90, NOW)).toBe(true);
  });

  it("is online exactly at the boundary", () => {
    expect(isAgentOnline(ago(90), 90, NOW)).toBe(true);
  });

  // The whole point: stopping the agent must flip the shop offline by itself.
  it("goes offline once the window passes", () => {
    expect(isAgentOnline(ago(91), 90, NOW)).toBe(false);
    expect(isAgentOnline(ago(600), 90, NOW)).toBe(false);
  });

  it("is offline when the agent never heartbeated", () => {
    // Paired but never actually run — this is what a fake "online" row looked
    // like, and it must not count as connected.
    expect(isAgentOnline(null, 90, NOW)).toBe(false);
    expect(isAgentOnline(undefined, 90, NOW)).toBe(false);
  });

  it("is offline for an unparseable timestamp", () => {
    expect(isAgentOnline("not-a-date", 90, NOW)).toBe(false);
    expect(isAgentOnline("", 90, NOW)).toBe(false);
  });

  it("honours a shop's custom timeout", () => {
    expect(isAgentOnline(ago(45), 30, NOW)).toBe(false);
    expect(isAgentOnline(ago(45), 300, NOW)).toBe(true);
  });

  it("falls back to the default for a nonsensical timeout", () => {
    expect(isAgentOnline(ago(60), 0, NOW)).toBe(true);
    expect(isAgentOnline(ago(60), -5, NOW)).toBe(true);
    expect(isAgentOnline(ago(DEFAULT_HEARTBEAT_TIMEOUT_SECONDS + 1), 0, NOW)).toBe(false);
  });

  // Shop PCs commonly have a slightly fast clock; that shouldn't read as dead.
  it("treats a future heartbeat as live rather than offline", () => {
    expect(isAgentOnline(new Date(NOW + 30_000).toISOString(), 90, NOW)).toBe(true);
  });
});

describe("anyAgentOnline", () => {
  it("is false when a shop has no agents at all", () => {
    expect(anyAgentOnline([], 90, NOW)).toBe(false);
    expect(anyAgentOnline(null, 90, NOW)).toBe(false);
    expect(anyAgentOnline(undefined, 90, NOW)).toBe(false);
  });

  it("is true when any one agent is live", () => {
    expect(
      anyAgentOnline(
        [{ last_heartbeat_at: ago(9999) }, { last_heartbeat_at: ago(10) }],
        90,
        NOW
      )
    ).toBe(true);
  });

  it("is false when every agent is stale", () => {
    expect(
      anyAgentOnline(
        [{ last_heartbeat_at: ago(500) }, { last_heartbeat_at: null }],
        90,
        NOW
      )
    ).toBe(false);
  });
});
