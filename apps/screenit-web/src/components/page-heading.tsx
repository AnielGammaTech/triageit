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
    <header className="screenit-dot-grid relative isolate flex min-h-36 flex-col justify-center gap-4 overflow-hidden rounded-[22px] border border-emerald-950/20 bg-[linear-gradient(120deg,#122b25_0%,#17473e_62%,#0e756b_130%)] p-5 text-white shadow-[0_22px_55px_-38px_rgba(7,55,47,.8)] sm:flex-row sm:items-center sm:justify-between lg:p-7">
      <span className="screenit-hero-orb pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full border border-teal-200/15 bg-teal-300/10 blur-[1px]" />
      <span className="pointer-events-none absolute -bottom-24 right-36 h-44 w-44 rounded-full border-[28px] border-white/[0.035]" />
      <div className="relative z-10 max-w-3xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-teal-200">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.035em] text-white lg:text-[30px]">{title}</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-300">{description}</p>
      </div>
      {actions ? <div className="relative z-10 flex flex-wrap gap-2">{actions}</div> : <div className="relative z-10 hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-teal-100 sm:flex"><span className="h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,.8)]" />Evidence-led workflow</div>}
    </header>
  );
}
