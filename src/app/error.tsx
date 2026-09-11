"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="text-center">
        <p className="font-data text-5xl font-bold text-line">Error</p>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-soft">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="mt-6 bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
