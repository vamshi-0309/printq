/**
 * What the agent says about a printer's condition, and what the owner sees.
 *
 * The agent reads each printer's status from the Windows spooler on every
 * heartbeat and reports one of these codes in printers.last_status. While the
 * shop's chosen printer reports a problem, the claim route hands out no work:
 * jobs stay QUEUED (nothing has been attempted, so nothing can print twice)
 * and the dashboard says "⚠ Printer issue — Order A047 is waiting".
 *
 * Another printer is never substituted. Switching printers is the owner's
 * decision, made in Dashboard → Printers.
 *
 * A caveat worth knowing: many USB printers never tell the Windows spooler
 * they are out of paper, so the spooler reports them as ready. For those, a
 * problem shows up only when a print fails, as a job error code.
 */

export const PRINTER_PROBLEMS: Record<string, string> = {
  out_of_paper: "Out of paper",
  paper_jam: "Paper jam",
  cover_open: "Cover or door open",
  offline: "Printer offline",
  error: "Printer reports an error",
  unavailable: "Printer not available",
  spooler_down: "Windows print service not running",
};

export function isPrinterProblem(status: string | null | undefined): boolean {
  return Boolean(status && status in PRINTER_PROBLEMS);
}

export function printerProblemLabel(status: string | null | undefined): string | null {
  return status && status in PRINTER_PROBLEMS ? PRINTER_PROBLEMS[status] : null;
}

/** Print-job failure codes the agent reports with a failed result. */
export const PRINT_ERROR_LABELS: Record<string, string> = {
  printer_unavailable: "The chosen printer isn't on the counter PC",
  interactive_port: "That printer asks where to save — it can't print unattended",
  printer_rejected: "The printer refused the document",
  timeout: "The printer didn't respond in time",
  conversion_failed: "The document couldn't be converted for printing",
  download_failed: "The document couldn't be downloaded",
  sumatra_missing: "SumatraPDF isn't installed on the counter PC",
  unsupported_type: "That file type can't be printed",
  ...PRINTER_PROBLEMS,
};

export const KNOWN_PRINT_ERROR_CODES = new Set(Object.keys(PRINT_ERROR_LABELS));
