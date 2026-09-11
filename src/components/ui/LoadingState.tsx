export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-6 py-12">
      <div className="h-4 w-4 animate-spin border-2 border-line border-t-cyan" />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-4 py-3 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-36 bg-line/60 rounded" />
        <div className="h-3 w-24 bg-line/40 rounded" />
      </div>
      <div className="h-4 w-16 bg-line/40 rounded" />
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line border border-line bg-paper">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
