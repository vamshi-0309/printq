/**
 * Shown while a dashboard route's server component resolves.
 *
 * Shaped like the page that follows — a heading, a row of figures, a list —
 * so the layout does not jump when the real content arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-7">
      <div className="border-b border-line pb-5">
        <div className="h-7 w-40 animate-pulse bg-line/60" />
        <div className="mt-2 h-4 w-64 animate-pulse bg-line/40" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border border-line border-l-2 border-l-line bg-paper px-4 py-3.5">
            <div className="h-3 w-16 animate-pulse bg-line/40" />
            <div className="mt-2 h-6 w-12 animate-pulse bg-line/60" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-line border border-line bg-paper">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
