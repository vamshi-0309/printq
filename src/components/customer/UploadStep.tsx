"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useId, useState } from "react";
import { formatBytes } from "@/lib/uploadWithProgress";
import { ACCEPT_ATTRIBUTE, MAX_FILE_SIZE_BYTES, validateFile } from "@/lib/fileValidation";

/**
 * File chooser with drag-and-drop and a genuine progress bar.
 *
 * The bar is driven by real XMLHttpRequest upload events, so on a slow phone
 * connection it moves at the speed of the actual transfer.
 */

// Extensions alone make Android's picker grey out every file; MIME types
// alone are ignored by iOS. Offering both keeps it usable on either.
const ACCEPT = ACCEPT_ATTRIBUTE;

export function UploadStep({
  onFile,
  uploading,
  progress,
  error,
  fileName,
  fileSize,
  onCancel,
}: {
  onFile: (file: File) => void;
  uploading: boolean;
  progress: number | null;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
  onCancel: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Stable across server and client render, so the label/input association
  // survives hydration.
  const inputId = useId();
  const reduced = useReducedMotion();

  const accept = useCallback(
    (file: File | null | undefined) => {
      setLocalError(null);
      if (!file) return;
      // Same rules the server enforces — this is only for instant feedback.
      const result = validateFile(file.name, file.type, file.size);
      if (!result.ok) {
        setLocalError(result.error ?? "That file can't be printed.");
        return;
      }
      onFile(file);
    },
    [onFile]
  );

  const shown = error ?? localError;

  if (uploading) {
    return (
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="border border-line bg-paper p-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border border-cyan/30 bg-cyan/[0.07] text-cyan">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5" />
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">{fileName}</p>
            <p className="mt-0.5 font-data text-[11px] text-ink-soft">
              {fileSize !== null ? formatBytes(fileSize) : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-magenta"
          >
            Cancel
          </button>
        </div>

        {/* Height is reserved, only the fill animates — no layout shift. */}
        <div className="mt-4 h-1.5 w-full overflow-hidden bg-paper-grey">
          <motion.div
            className="h-full bg-cyan"
            initial={{ width: 0 }}
            animate={{ width: `${progress ?? 0}%` }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
        </div>
        <p className="mt-2 font-data text-[11px] text-ink-soft">
          {progress === null
            ? "Uploading…"
            : progress >= 100
              ? "Processing…"
              : `Uploading… ${progress}%`}
        </p>
      </motion.div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={`relative border border-dashed transition-colors focus-within:border-cyan ${
          dragging ? "border-cyan bg-cyan/[0.04]" : "border-line-strong bg-paper"
        }`}
      >
        {/*
          A <label htmlFor> activates the input natively, with no JavaScript.

          This was previously a <button> whose onClick called .click() on
          a 1x1 clipped input. Emulators allow that, but real iOS Safari
          and several Android WebViews refuse to open the picker for a
          programmatic .click() on an input that is effectively invisible — so
          on an actual phone, tapping "Browse files" did nothing at all.

          Label activation is part of HTML, needs no user-activation heuristic,
          and works the same on Android Chrome and iOS Safari.
        */}
        <label
          htmlFor={inputId}
          className="flex w-full cursor-pointer flex-col items-center justify-center px-6 py-12 text-center"
        >
          <motion.span
            animate={dragging && !reduced ? { y: -3 } : { y: 0 }}
            className="flex h-14 w-14 items-center justify-center border border-line bg-paper-grey text-cyan"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M8 8l4-4 4 4" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </motion.span>

          <span className="mt-4 block text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Choose a document
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-soft">
            PDF, Word, PowerPoint or a photo
            <br />
            up to {Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB
          </span>

          <span className="mt-5 inline-block border border-ink bg-ink px-5 py-2.5 text-[13.5px] font-medium text-paper">
            Browse files
          </span>
        </label>

        {/*
          Kept out of the label (association is via htmlFor alone) — nesting it
          as well makes some browsers fire activation twice, reopening the
          picker straight after a file is chosen.

          `sr-only` rather than display:none or hidden: the input must stay
          focusable for keyboard users, and a label cannot take focus itself.
          The dashed border above lights up via focus-within.
        */}
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            // Allow re-picking the same file after an error.
            e.target.value = "";
          }}
        />
      </div>

      {shown && (
        <motion.p
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="mt-3 border-l-2 border-magenta bg-magenta/[0.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-magenta"
        >
          {shown}
        </motion.p>
      )}

      <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-soft">
        Your file is deleted from the shop&apos;s computer and our servers once it prints.
      </p>
    </div>
  );
}
