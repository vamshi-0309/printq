/**
 * Is a shop's print agent actually online?
 *
 * The `print_agents.status` column is written to "online" by the heartbeat
 * route and is never written back to "offline" by anything — an agent that is
 * killed, crashes, or loses its network connection leaves the row reading
 * "online" forever. Trusting that flag is what made a shop keep accepting
 * orders it could not print.
 *
 * Liveness is therefore derived from freshness instead: an agent counts as
 * online only if its last heartbeat is within the shop's configured timeout.
 * That needs no background job and cannot get stuck, because the passage of
 * time alone flips it. The agent heartbeats every 20s and the default window
 * is 90s, so roughly four missed beats mark a shop offline.
 */

export const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 90;

export function isAgentOnline(
  lastHeartbeatAt: string | null | undefined,
  timeoutSeconds: number = DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  now: number = Date.now()
): boolean {
  // Never heartbeated: paired but never actually ran.
  if (!lastHeartbeatAt) return false;

  const beat = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(beat)) return false;

  const window = timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;
  const age = now - beat;

  // A heartbeat from the future means clock skew between the shop PC and the
  // server. Treat it as live rather than offline: the agent is plainly running.
  if (age < 0) return true;

  return age <= window * 1000;
}

/** True when at least one of a shop's agents is live. */
export function anyAgentOnline(
  agents: { last_heartbeat_at: string | null }[] | null | undefined,
  timeoutSeconds?: number,
  now?: number
): boolean {
  if (!agents?.length) return false;
  return agents.some((a) => isAgentOnline(a.last_heartbeat_at, timeoutSeconds, now));
}
