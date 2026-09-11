"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import type { PrintersResponse, PrinterRow } from "@/lib/dashboardTypes";
import {
  PageHeader,
  StatusPill,
  ErrorNote,
  InfoNote,
  relativeTime,
} from "@/components/dashboard/primitives";

/**
 * The printers on the shop's counter PC.
 *
 * Every entry here was reported by a real agent enumerating real Windows
 * printers. Nothing on this page is seeded, sampled or demonstrative — an
 * empty list means no agent has reported one, and that is what it says.
 *
 * The important honesty is in the status. A printer row is only "ready" when
 * the agent that reported it is currently alive; otherwise the row shows when
 * it was last seen. A printer whose agent died an hour ago is not ready, and
 * showing a green dot for it is how a paid job ends up waiting silently.
 */

export default function PrintersPage() {
  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<PrintersResponse>("/api/shop/printers");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const update = async (
    printerId: string,
    patch: { isDefault?: boolean; isEnabled?: boolean; displayName?: string }
  ) => {
    setBusyId(printerId);
    setActionError(null);
    try {
      const res = await fetch("/api/shop/printers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerId, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? "Could not update the printer.");
        return;
      }
      // Re-read rather than patching locally: setting a default clears the
      // others server-side, so the whole list can change.
      refresh();
    } catch {
      setActionError("Couldn't reach the server.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-40 animate-pulse bg-line/60" />
        <div className="h-48 animate-pulse border border-line bg-paper" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Printers" onRefresh={refresh} refreshing={refreshing} />
        <ErrorNote>{error ?? "Could not load your printers."}</ErrorNote>
      </div>
    );
  }

  const { printers, agent, agentOnline, agentCount } = data;
  const now = Date.parse(data.serverTime);
  const enabledCount = printers.filter((p) => p.is_enabled).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Printers"
        description="Detected by the PrintQ agent running on your counter PC."
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        <StatusPill tone={agentOnline ? "success" : "danger"}>
          {agentOnline ? "Agent online" : "Agent offline"}
        </StatusPill>
      </PageHeader>

      {agent ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-line bg-paper px-4 py-3 text-[12.5px] text-ink-soft">
          <span className="text-ink">{agent.hostname ?? "Counter PC"}</span>
          {agent.version && <span className="font-data text-[11px]">agent v{agent.version}</span>}
          <span className="font-data text-[11px]">
            last heartbeat {relativeTime(agent.last_heartbeat_at, now)}
          </span>
          {agentCount > 1 && (
            <Link href="/dashboard/agent" className="font-data text-[11px] text-cyan hover:underline">
              {agentCount} agents paired →
            </Link>
          )}
        </div>
      ) : (
        <InfoNote>
          No agent is paired with this shop yet, so no printers can be detected.{" "}
          <Link href="/dashboard/agent" className="text-cyan underline underline-offset-2">
            Pair the PrintQ agent
          </Link>{" "}
          on your Windows counter PC.
        </InfoNote>
      )}

      {!agentOnline && printers.length > 0 && (
        <ErrorNote>
          The agent is not connected, so none of these printers can be used right now. Anything
          paid for will wait in the queue until it reconnects.
        </ErrorNote>
      )}

      {printers.length > 0 && enabledCount === 0 && (
        <ErrorNote>
          Every printer is disabled, so nothing can print. Enable at least one below.
        </ErrorNote>
      )}

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {printers.length === 0 ? (
        <div className="border border-line bg-paper px-6 py-14 text-center">
          <p className="text-[14px] font-medium text-ink">No printers detected</p>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-soft">
            Printers appear here automatically once the PrintQ agent is running on your Windows
            counter PC. Nothing is added by hand.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {printers.map((printer) => (
            <PrinterCard
              key={printer.id}
              printer={printer}
              now={now}
              busy={busyId === printer.id}
              anyBusy={busyId !== null}
              onUpdate={update}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PrinterCard({
  printer,
  now,
  busy,
  anyBusy,
  onUpdate,
}: {
  printer: PrinterRow;
  now: number;
  busy: boolean;
  anyBusy: boolean;
  onUpdate: (
    id: string,
    patch: { isDefault?: boolean; isEnabled?: boolean; displayName?: string }
  ) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(printer.display_name);

  const tone = printer.available ? "success" : printer.is_enabled ? "warning" : "neutral";
  const statusLabel = printer.available
    ? (printer.last_status ?? "ready")
    : printer.is_enabled
      ? "agent offline"
      : "disabled";

  return (
    <li className="border border-line bg-paper">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setRenaming(false);
                if (name.trim() && name.trim() !== printer.display_name) {
                  onUpdate(printer.id, { displayName: name.trim() });
                }
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="border border-line bg-paper px-2 py-1 text-[13.5px] text-ink focus:border-cyan focus:outline-none"
              />
              <button
                type="submit"
                className="border border-ink bg-ink px-2.5 py-1 text-[12px] font-medium text-paper"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setName(printer.display_name);
                  setRenaming(false);
                }}
                className="text-[12px] text-ink-soft hover:text-ink"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-medium text-ink">{printer.display_name}</p>
              {printer.is_default && <StatusPill tone="info">Default</StatusPill>}
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="font-data text-[10px] uppercase tracking-[0.1em] text-ink-soft hover:text-cyan"
              >
                Rename
              </button>
            </div>
          )}
          {/* The Windows name is what the agent prints to, so it is shown even
              when the owner has given the printer a friendlier label. */}
          <p className="mt-0.5 break-all font-data text-[11px] text-ink-soft">
            {printer.system_name}
          </p>
        </div>

        <div className="text-right">
          <StatusPill tone={tone}>{statusLabel}</StatusPill>
          <p className="mt-1 font-data text-[10px] uppercase tracking-[0.08em] text-ink-soft">
            seen {relativeTime(printer.updated_at, now)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {printer.supports_color && <Capability>Colour</Capability>}
          {printer.supports_duplex && <Capability>Double-sided</Capability>}
          {!printer.supports_color && !printer.supports_duplex && (
            <span className="font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
              no capabilities reported
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {!printer.is_default && (
            <button
              type="button"
              onClick={() => onUpdate(printer.id, { isDefault: true })}
              disabled={anyBusy}
              className="border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-cyan hover:text-cyan disabled:opacity-40"
            >
              {busy ? "Saving…" : "Make default"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onUpdate(printer.id, { isEnabled: !printer.is_enabled })}
            disabled={anyBusy}
            className="border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
          >
            {printer.is_enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </div>
    </li>
  );
}

function Capability({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-line px-2 py-0.5 font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
      {children}
    </span>
  );
}
