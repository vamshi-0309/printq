/**
 * When does "today" start for a shop?
 *
 * The dashboard's headline numbers are a day's takings, so the day boundary
 * has to be the one the owner uses. The previous code did
 * `new Date().toISOString().slice(0, 10)`, which is midnight UTC — 5:30am in
 * India. Between midnight and 5:30am the "Today" panel showed the previous
 * day's orders, and any order taken in that window vanished from the count.
 *
 * These shops are in India, so the boundary is Asia/Kolkata unless a caller
 * says otherwise. The offset is read from the runtime's own timezone database
 * via Intl rather than hardcoding +05:30, so this stays correct for any zone
 * and across DST, which India does not observe but other deployments might.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/** The zone's UTC offset, in ms, at a given instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }

  // Intl renders hour 24 for midnight in some engines; normalise to 0.
  const hour = parts.hour === 24 ? 0 : parts.hour;

  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return asIfUtc - instant.getTime();
}

/** Calendar date in the zone, as { year, month, day }. */
function localDateParts(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = dtf.format(instant).split("-").map(Number);
  return { year, month, day };
}

/**
 * The instant at which the current local day began.
 *
 * Computed by guessing with the current offset and correcting once — the
 * offset can differ either side of a DST boundary, and a single correction is
 * always enough for real-world transitions of an hour or less.
 */
export function startOfDay(now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): Date {
  const { year, month, day } = localDateParts(now, timeZone);
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  const guess = new Date(naiveUtc - offsetMsAt(now, timeZone));
  const corrected = new Date(naiveUtc - offsetMsAt(guess, timeZone));
  return corrected;
}

/** Start of the day N days back — for the trailing-week comparison. */
export function startOfDaysAgo(
  days: number,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE
): Date {
  const today = startOfDay(now, timeZone);
  return new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
}
