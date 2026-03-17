import { AGENTS } from "@triageit/shared";

export default function AgentsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Agent Roster</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent) => (
          <div
            key={agent.name}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{agent.character}</h3>
              <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--secondary-foreground)]">
                {agent.model}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-[var(--primary)]">
              {agent.specialty}
            </p>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {agent.description}
            </p>
            {agent.integration && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Integration:{" "}
                <span className="text-[var(--foreground)]">
                  {agent.integration}
                </span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
