import { isAgentOnline, DEFAULT_HEARTBEAT_TIMEOUT_SECONDS } from "./agentStatus";
import { evaluateLicence, type LicenceEvaluation } from "./licence";

/**
 * Three different questions the dashboard must never conflate.
 *
 *   1. Is the shop OPEN?      Can a customer place a new order at all —
 *                             shops.status plus the licence.
 *   2. Is the agent ONLINE?   Is a PrintQ agent process alive on the counter
 *                             PC, judged by heartbeat freshness.
 *   3. Is a printer AVAILABLE? Has that agent reported at least one enabled
 *                             printer.
 *
 * They fail independently and mean different things to the owner. A shop can
 * be open and taking money with a dead agent (orders pile up unprinted); an
 * agent can be online with every printer disabled (nothing prints, and the
 * agent light is green). Collapsing these into one "online" dot is what let a
 * paid order sit in the queue with the dashboard showing nothing wrong.
 */

export interface AgentSnapshot {
  id: string;
  hostname: string | null;
  version: string | null;
  last_heartbeat_at: string | null;
  created_at?: string | null;
}

export interface PrinterSnapshot {
  id: string;
  is_enabled: boolean;
  is_default: boolean;
  last_status: string | null;
}

export interface LicenceRow {
  status: string;
  expires_at: string;
  grace_period_days: number;
}

export interface ReadinessInput {
  shopStatus: string;
  heartbeatTimeoutSeconds?: number | null;
  agents: AgentSnapshot[];
  printers: PrinterSnapshot[];
  licence?: LicenceRow | null;
  now?: Date;
}

export interface ShopReadiness {
  /** Can a customer place an order right now. */
  acceptingOrders: boolean;
  shopStatus: string;
  licence: LicenceEvaluation | null;

  /** Is a PrintQ agent process alive. */
  agentOnline: boolean;
  /** The live agent, or the most recently seen one when none is live. */
  activeAgent: (AgentSnapshot & { online: boolean }) | null;
  /** Every agent row, newest heartbeat first, each with derived liveness. */
  agents: (AgentSnapshot & { online: boolean })[];
  /** Rows that were paired but never reported in — safe to remove. */
  staleAgentCount: number;

  /** Is there something to print with. */
  printerAvailable: boolean;
  printerCount: number;
  enabledPrinterCount: number;
  defaultPrinter: PrinterSnapshot | null;

  /** Ordered, plain-language reasons printing cannot happen. Empty when fine. */
  blockers: ReadinessBlocker[];
}

export interface ReadinessBlocker {
  code: "shop_inactive" | "licence" | "no_agent" | "agent_offline" | "no_printer" | "no_printer_enabled";
  title: string;
  detail: string;
  /** Where the owner goes to fix it. */
  href?: string;
  action?: string;
}

export function evaluateShopReadiness(input: ReadinessInput): ShopReadiness {
  const now = input.now ?? new Date();
  const timeout = input.heartbeatTimeoutSeconds || DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;

  const agents = [...input.agents]
    .map((a) => ({ ...a, online: isAgentOnline(a.last_heartbeat_at, timeout, now.getTime()) }))
    .sort((a, b) => {
      // Live agents first, then by most recent heartbeat, then newest row.
      if (a.online !== b.online) return a.online ? -1 : 1;
      const ab = a.last_heartbeat_at ? Date.parse(a.last_heartbeat_at) : 0;
      const bb = b.last_heartbeat_at ? Date.parse(b.last_heartbeat_at) : 0;
      if (ab !== bb) return bb - ab;
      return Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0;
    });

  const agentOnline = agents.some((a) => a.online);
  const activeAgent = agents[0] ?? null;
  const staleAgentCount = agents.filter((a) => !a.online && !a.last_heartbeat_at).length;

  const enabled = input.printers.filter((p) => p.is_enabled);
  const printerCount = input.printers.length;
  const enabledPrinterCount = enabled.length;
  const defaultPrinter = input.printers.find((p) => p.is_default && p.is_enabled) ?? null;
  const printerAvailable = enabledPrinterCount > 0;

  const licence = input.licence
    ? evaluateLicence(
        {
          status: input.licence.status as LicenceEvaluation["effectiveStatus"],
          expiresAt: new Date(input.licence.expires_at),
          gracePeriodDays: input.licence.grace_period_days,
        },
        now
      )
    : null;

  const shopActive = input.shopStatus === "active";
  const acceptingOrders = shopActive && (licence ? licence.canAcceptNewOrders : true);

  const blockers: ReadinessBlocker[] = [];

  if (!shopActive) {
    blockers.push({
      code: "shop_inactive",
      title: `Shop is ${input.shopStatus}`,
      detail:
        "Customers who scan your QR code see a not-found page. Contact PrintQ support to reactivate.",
    });
  } else if (licence && !licence.canAcceptNewOrders) {
    blockers.push({
      code: "licence",
      title: "Licence expired",
      detail:
        "New orders are turned away. Jobs already paid for are unaffected and will still print.",
    });
  }

  if (agents.length === 0) {
    blockers.push({
      code: "no_agent",
      title: "No agent paired",
      detail:
        "Nothing is connected to your counter PC, so paid orders cannot print. Pair the PrintQ agent to fix this.",
      href: "/dashboard/agent",
      action: "Pair an agent",
    });
  } else if (!agentOnline) {
    blockers.push({
      code: "agent_offline",
      title: "Agent offline",
      detail:
        "The PrintQ agent has stopped reporting in. Paid orders will queue until it reconnects.",
      href: "/dashboard/agent",
      action: "Check the agent",
    });
  }

  if (agents.length > 0 && printerCount === 0) {
    blockers.push({
      code: "no_printer",
      title: "No printers detected",
      detail:
        "The agent has not reported any printers. Check that a printer is installed on the counter PC.",
      href: "/dashboard/printers",
      action: "View printers",
    });
  } else if (printerCount > 0 && enabledPrinterCount === 0) {
    blockers.push({
      code: "no_printer_enabled",
      title: "Every printer is disabled",
      detail: "Nothing can print until you enable at least one printer.",
      href: "/dashboard/printers",
      action: "Enable a printer",
    });
  }

  return {
    acceptingOrders,
    shopStatus: input.shopStatus,
    licence,
    agentOnline,
    activeAgent,
    agents,
    staleAgentCount,
    printerAvailable,
    printerCount,
    enabledPrinterCount,
    defaultPrinter,
    blockers,
  };
}
