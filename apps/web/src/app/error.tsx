"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function AppError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useEffect(() => {
    console.error("TriageIT route failed", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-[#09090b] p-6 text-white">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-[#111114] p-6 text-center">
        <TriangleAlert className="mx-auto h-6 w-6 text-amber-400" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">TriageIT could not finish loading</h1>
        <p className="mt-2 text-sm leading-5 text-zinc-400">
          A required service did not respond in time. Your session and work are unchanged.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mx-auto mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </section>
    </main>
  );
}
