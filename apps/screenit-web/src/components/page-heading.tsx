export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:p-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700">{eyebrow}</p>
        <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.03em] text-slate-950 lg:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
