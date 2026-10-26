/** The headline numbers: four tiles, each with one line of context so none is bare. */
export type PulseTile = { icon: string; label: string; value: string; note: string; accent?: "teal" | "rose" };

export function Pulse({ tiles }: { tiles: PulseTile[] }) {
  return (
    <section aria-label="Market at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card relative overflow-hidden p-4">
          <span
            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl text-lg ${
              t.accent === "rose" ? "bg-rose-50" : "bg-teal-50"
            }`}
            aria-hidden
          >
            {t.icon}
          </span>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label}</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">{t.value}</p>
          <p className="mt-0.5 text-xs leading-snug text-slate-500">{t.note}</p>
        </div>
      ))}
    </section>
  );
}

export function PulseSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the market">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-200/70" />
        ))}
      </div>
      <div className="aspect-[4/3] animate-pulse rounded-3xl bg-slate-200/70 md:aspect-[16/6]" />
    </div>
  );
}
