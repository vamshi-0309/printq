/**
 * Which printer should a claimed job go to?
 *
 * The shop owner picks a default in Dashboard → Printers. Until now that
 * choice went nowhere: the claim response carried no printer, and the Windows
 * agent fell back to `win32print.GetDefaultPrinter()` — the machine's own
 * default, which is a completely different setting owned by Windows. A shop
 * that chose "Export to WPS PDF" in PrintQ had its jobs sent to whatever
 * Windows happened to consider default, with nothing on either side saying so.
 *
 * Two rules govern this module, and both are about refusing to guess:
 *
 *   - A printer is only ever selected from the calling shop's own rows. A row
 *     belonging to another shop is not merely skipped, it is an error worth
 *     shouting about, because it would mean the query that produced this list
 *     was not scoped.
 *   - When there is no usable selection, nothing is chosen. Falling back to
 *     "any enabled printer" would silently print a customer's document on a
 *     device the owner did not pick — which is the failure this module exists
 *     to end. The caller gets a reason code instead and the job stays queued.
 */

export interface ShopPrinterRow {
  id: string;
  shop_id: string;
  system_name: string;
  display_name: string;
  is_default: boolean;
  is_enabled: boolean;
  supports_color?: boolean;
  supports_duplex?: boolean;
  agent_id?: string | null;
  last_status?: string | null;
}

/** What the agent needs in order to print, and nothing more. */
export interface SelectedPrinter {
  /** The persisted row id, recorded against the print attempt. */
  id: string;
  /** The exact Windows printer name the agent prints to. */
  systemName: string;
  /** The owner's label for it, for logs and the tray. */
  displayName: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
}

export type PrinterUnavailableCode =
  | "no_printer_detected"
  | "no_printer_configured"
  | "default_printer_disabled";

export type PrinterSelection =
  | { ok: true; printer: SelectedPrinter }
  | { ok: false; code: PrinterUnavailableCode; message: string };

/**
 * Messages are written for the shop owner, not for a log file: they say what
 * is wrong and where to fix it, because they surface on the order in the
 * dashboard.
 */
const MESSAGES: Record<PrinterUnavailableCode, string> = {
  no_printer_detected:
    "No printers have been detected for this shop yet, so there is nothing to print on. Check that the PrintQ agent is running on the counter PC.",
  no_printer_configured:
    "No PrintQ printer has been chosen yet. Pick one as the default in Dashboard → Printers and this will print.",
  default_printer_disabled:
    "The printer chosen for PrintQ is switched off. Enable it, or choose a different default, in Dashboard → Printers.",
};

export function selectPrinterForShop(
  printers: ShopPrinterRow[],
  shopId: string
): PrinterSelection {
  // Defence in depth. The caller scopes its query by shop; if a foreign row
  // ever reaches here the right response is to drop it, not to print on it.
  const owned = printers.filter((p) => p.shop_id === shopId);

  if (owned.length === 0) {
    return { ok: false, code: "no_printer_detected", message: MESSAGES.no_printer_detected };
  }

  const defaults = owned.filter((p) => p.is_default);

  if (defaults.length === 0) {
    return { ok: false, code: "no_printer_configured", message: MESSAGES.no_printer_configured };
  }

  // Only one printer per shop may be the default, and the dashboard enforces
  // that when setting one. If the data ever disagrees, prefer an enabled one
  // over an arbitrary first — but still never reach outside the defaults.
  const chosen = defaults.find((p) => p.is_enabled);

  if (!chosen) {
    return {
      ok: false,
      code: "default_printer_disabled",
      message: MESSAGES.default_printer_disabled,
    };
  }

  return {
    ok: true,
    printer: {
      id: chosen.id,
      systemName: chosen.system_name,
      displayName: chosen.display_name,
      supportsColor: Boolean(chosen.supports_color),
      supportsDuplex: Boolean(chosen.supports_duplex),
    },
  };
}

/**
 * Does this printer id belong to this shop?
 *
 * Used when a value arrives from outside — the agent naming a printer on a
 * print attempt — so one shop's id can never be recorded against another's
 * job, however the request was constructed.
 */
export function printerBelongsToShop(
  // Only identity is needed, so callers can pass a narrow select rather than
  // fetching every column just to satisfy a type.
  printers: { id: string; shop_id: string }[],
  printerId: string,
  shopId: string
): boolean {
  return printers.some((p) => p.id === printerId && p.shop_id === shopId);
}
