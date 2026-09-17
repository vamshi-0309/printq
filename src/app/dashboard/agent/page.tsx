"use client";

import Link from "next/link";
import { useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import type { AgentsResponse, AgentRow } from "@/lib/dashboardTypes";
import {
  PageHeader,
  StatusPill,
  SectionHeading,
  ErrorNote,
  InfoNote,
  relativeTime,
  absoluteTime,
} from "@/components/dashboard/primitives";

/**
 * The bridge between this dashboard and the shop's counter PC.
 *
 * Pairing had no home before: the code generator was buried at the bottom of
 * the settings form, and there was nowhere at all to see which agents existed.
 * A shop that retried setup a few times ends up with several print_agents rows
 * — this one has four, of which one is alive — with no way to tell them apart
 * or clear the dead ones out.
 *
 * Two rules the screen keeps:
 *
 *   - "Online" is derived from heartbeat freshness, never from the stored
 *     status column, which nothing ever sets back to offline.
 *   - A pairing code is shown with the time it has left, and the server owns
 *     that number. Nothing here hardcodes fifteen minutes.
 */

export default function AgentPage() {
  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<AgentsResponse>("/api/shop/agents", {
      // Heartbeats land every 20s and liveness is time-derived, so this screen
      // checks a little more often than the rest of the dashboard.
      refreshIntervalMs: 30_000,
    });

  const [code, setCode] = useState<{ code: string; expiresInMinutes: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setActionError(null);
    try {
      const res = await fetch("/api/shop/pairing-code", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error ?? "Could not generate a pairing code.");
        return;
      }
      setCode({
        code: body.code,
        // The server owns the TTL (AGENT_PAIRING_TOKEN_TTL_MINUTES); don't
        // hardcode a number here that could disagree with when it expires.
        expiresInMinutes: typeof body.expiresInMinutes === "number" ? body.expiresInMinutes : 0,
      });
    } catch {
      setActionError("Couldn't reach the server.");
    } finally {
      setGenerating(false);
    }
  };

  const unpair = async (agentId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/shop/agents/${agentId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error ?? "Could not remove that agent.");
        return;
      }
      refresh();
    } catch {
      setActionError("Couldn't reach the server.");
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
        <PageHeader title="Print agent" onRefresh={refresh} refreshing={refreshing} />
        <ErrorNote>{error ?? "Could not load your agents."}</ErrorNote>
      </div>
    );
  }

  const { agents, agentOnline, heartbeatTimeoutSeconds } = data;
  const now = Date.parse(data.serverTime);
  const live = code ?? (data.pairing ? { code: data.pairing.code, expiresInMinutes: Math.ceil(data.pairing.secondsRemaining / 60) } : null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Print agent"
        description="The small Windows program that collects paid jobs and sends them to your printer."
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        <StatusPill tone={agentOnline ? "success" : "danger"}>
          {agentOnline ? "Connected" : "Not connected"}
        </StatusPill>
      </PageHeader>

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {!agentOnline && agents.length > 0 && (
        <ErrorNote>
          No agent has reported in for more than {Math.round(heartbeatTimeoutSeconds / 60) || 1}{" "}
          minute{heartbeatTimeoutSeconds >= 120 ? "s" : ""}. Paid orders will queue until it
          reconnects — open the PrintQ agent on your counter PC and check it is running.
        </ErrorNote>
      )}

      <section className="space-y-3">
        <SectionHeading eyebrow="Setup" title="Connect a counter PC" />
        <div className="border border-line bg-paper px-4 py-4">
          <ol className="space-y-2.5 text-[13px] leading-relaxed text-ink-soft">
            <li>
              <span className="font-medium text-ink">1.</span> Download PrintQ Agent on the
              Windows PC connected to your printer, and double-click it to install. No other
              software is needed.
            </li>
            <li>
              <span className="font-medium text-ink">2.</span> PrintQ Agent opens by itself after
              installing. Generate a pairing code below and type it into its window.
            </li>
            <li>
              <span className="font-medium text-ink">3.</span> Choose your printer in PrintQ
              Agent, or on the{" "}
              <Link href="/dashboard/printers" className="text-cyan underline underline-offset-2">
                Printers
              </Link>{" "}
              page here. Your computer appears below once it connects.
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="/downloads/windows"
              className="border border-ink px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-grey"
            >
              Download for Windows
            </a>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="border border-cyan bg-cyan px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-cyan-deep disabled:opacity-50"
            >
              {generating ? "Generating…" : live ? "Generate a new code" : "Generate pairing code"}
            </button>
          </div>

          {live && (
            <div className="mt-4 border border-cyan/30 bg-cyan/[0.05] px-4 py-3.5">
              <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-cyan-deep">
                Pairing code
              </p>
              <p className="mt-1.5 font-data text-[32px] font-bold leading-none tracking-[0.28em] text-ink">
                {live.code}
              </p>
              <p className="mt-2 text-[12.5px] text-ink-soft">
                {live.expiresInMinutes > 0
                  ? `Expires in about ${live.expiresInMinutes} minute${live.expiresInMinutes === 1 ? "" : "s"}. Generate another if it runs out.`
                  : "This code has expired. Generate another one."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading
          eyebrow={`${agents.length} paired`}
          title={agents.length === 1 ? "Paired machine" : "Paired machines"}
        />

        {agents.length === 0 ? (
          <div className="border border-line bg-paper px-6 py-12 text-center">
            <p className="text-[14px] font-medium text-ink">No agent paired yet</p>
            <p className="mt-1 text-[12.5px] text-ink-soft">
              Until one is, paid orders will sit in the queue unprinted.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} now={now} onUnpair={unpair} />
            ))}
          </ul>
        )}

        {agents.filter((a) => a.neverSeen).length > 0 && (
          <InfoNote>
            Entries marked &ldquo;never connected&rdquo; are from pairing attempts that were not
            completed. They do nothing, and removing them keeps this list readable.
          </InfoNote>
        )}
      </section>
    </div>
  );
}

function AgentCard({
  agent,
  now,
  onUnpair,
}: {
  agent: AgentRow;
  now: number;
  onUnpair: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-ink">
              {agent.hostname ?? "Unnamed machine"}
            </p>
            <StatusPill tone={agent.online ? "success" : agent.neverSeen ? "neutral" : "danger"}>
              {agent.online ? "Online" : agent.neverSeen ? "Never connected" : "Offline"}
            </StatusPill>
          </div>
          <p className="mt-1 font-data text-[11px] uppercase tracking-[0.08em] text-ink-soft">
            {agent.version ? `v${agent.version} · ` : ""}
            {agent.neverSeen
              ? `paired ${relativeTime(agent.createdAt, now)}, never reported in`
              : `last heartbeat ${relativeTime(agent.lastHeartbeatAt, now)} · ${absoluteTime(agent.lastHeartbeatAt)}`}
          </p>
          <p className="font-data text-[11px] text-ink-soft">
            {agent.printerCount} printer{agent.printerCount === 1 ? "" : "s"} reported
          </p>
        </div>

        {confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onUnpair(agent.id);
              }}
              className="border border-magenta bg-magenta px-3 py-1.5 text-[12.5px] font-medium text-paper"
            >
              Remove it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink hover:text-ink"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-magenta hover:text-magenta"
          >
            Unpair
          </button>
        )}
      </div>

      {confirming && (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-soft">
          {agent.online
            ? "This machine is connected right now. Removing it stops it printing immediately, and it will need a new pairing code."
            : "Removing this entry revokes its credentials. It will need a new pairing code to connect again."}
        </p>
      )}
    </li>
  );
}
