import { ScanSearch } from "lucide-react";

export function ScreenItLogo({ compact = false, dark = false }: { readonly compact?: boolean; readonly dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 text-white shadow-sm shadow-teal-950/30">
        <ScanSearch className="h-5 w-5" strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className={`block text-[16px] font-bold tracking-[-0.02em] ${dark ? "text-slate-950" : "text-white"}`}>ScreenIT</span>
          <span className={`mt-1 block text-[9px] font-semibold uppercase tracking-[0.2em] ${dark ? "text-teal-700" : "text-teal-200/70"}`}>Interview screening</span>
        </span>
      )}
    </div>
  );
}
