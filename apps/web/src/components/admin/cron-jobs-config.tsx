"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ────────────────────────────────────────────────────────────

interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schedule: string;
  readonly endpoint: string;
  readonly is_active: boolean;
  readonly last_run_at: string | null;
  readonly last_status: string | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface NewJobForm {
  readonly name: string;
  readonly description: string;
  readonly schedule: string;
  readonly endpoint: string;
}

// ── Cron Expression Helpers ──────────────────────────────────────────

const COMMON_SCHEDULES: ReadonlyArray<{
  readonly label: string;
  readonly cron: string;
}> = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 3 hours", cron: "0 */3 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Every 12 hours", cron: "0 */12 * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
  { label: "Daily at 6 AM", cron: "0 6 * * *" },
  { label: "Every 15 min", cron: "*/15 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
];

const AVAILABLE_ENDPOINTS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> = [
  { value: "/retriage", label: "Daily Re-Triage Scan" },
  { value: "/sla-scan", label: "SLA Breach Scan" },
];

function describeCron(expression: string): string {
  const match = COMMON_SCHEDULES.find((s) => s.cron === expression);
  if (match) return match.label;

  const parts = expression.split(" ");
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${minute.slice(2)} minutes`;
  }
  if (minute === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${hour.slice(2)} hours`;
  }
  if (minute === "0" && /^\d+$/.test(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:00 ${ampm}`;
  }

  return expression;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "Never";
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getNextRun(schedule: string, isActive: boolean): string {
  if (!isActive) return "Paused";

  // Parse simple cron patterns for next-run estimation
  const parts = schedule.split(" ");
  if (parts.length !== 5) return "Unknown";

  const [minute, hour] = parts;
  const now = new Date();

  if (minute.startsWith("*/")) {
    const interval = parseInt(minute.slice(2), 10);
    const nextMinute = Math.ceil((now.getMinutes() + 1) / interval) * interval;
    const next = new Date(now);
    next.setMinutes(nextMinute, 0, 0);
    if (next <= now) next.setMinutes(next.getMinutes() + interval);
    const diffMs = next.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    return `in ${diffMins}m`;
  }

  if (minute === "0" && hour.startsWith("*/")) {
    const interval = parseInt(hour.slice(2), 10);
    const nextHour = Math.ceil((now.getHours() + 1) / interval) * interval;
    const next = new Date(now);
    next.setHours(nextHour, 0, 0, 0);
    if (next <= now) next.setHours(next.getHours() + interval);
    const diffMs = next.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60) return `in ${diffMins}m`;
    const diffHours = Math.round(diffMins / 60);
    return `in ${diffHours}h`;
  }

  if (minute === "0" && /^\d+$/.test(hour)) {
    const targetHour = parseInt(hour, 10);
    const next = new Date(now);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const diffMs = next.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / 3600000);
    if (diffHours < 1) return "in <1h";
    if (diffHours < 24) return `in ${diffHours}h`;
    return "Tomorrow";
  }

  return "Scheduled";
}

// ── Icons ────────────────────────────────────────────────────────────

const PLAY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const PLUS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

const TRASH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

// ── Status Badge ─────────────────────────────────────────────────────

function StatusBadge({ status, isActive }: { readonly status: string | null; readonly isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-white/30">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/20" />
        Paused
      </span>
    );
  }

  if (!status) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-white/40">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/30" />
        Idle
      </span>
    );
  }

  if (status === "success") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Success
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
      Error
    </span>
  );
}

// ── Create Job Form ──────────────────────────────────────────────────

function CreateJobForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  readonly onSubmit: (form: NewJobForm) => void;
  readonly onCancel: () => void;
  readonly submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("0 */3 * * *");
  const [endpoint, setEndpoint] = useState("/retriage");
  const [customSchedule, setCustomSchedule] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ name, description, schedule, endpoint });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-[#6366f1]/30 bg-[#6366f1]/5 p-5 space-y-4"
    >
      <h4 className="text-sm font-semibold text-white">New Cron Job</h4>

      {/* Name */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Nightly Cleanup"
          required
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this job does..."
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
        />
      </div>

      {/* Endpoint */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">Worker Endpoint</label>
        <div className="flex gap-2">
          {AVAILABLE_ENDPOINTS.map((ep) => (
            <button
              key={ep.value}
              type="button"
              onClick={() => setEndpoint(ep.value)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                endpoint === ep.value
                  ? "border-[#6366f1] bg-[#6366f1]/10 text-white"
                  : "border-white/10 text-white/50 hover:border-white/20",
              )}
            >
              {ep.label}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-white/60">Schedule</label>
          <button
            type="button"
            onClick={() => setCustomSchedule(!customSchedule)}
            className="text-[10px] text-[#6366f1] hover:text-[#818cf8] transition-colors"
          >
            {customSchedule ? "Use presets" : "Custom expression"}
          </button>
        </div>

        {customSchedule ? (
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="* * * * *"
            required
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
          />
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {COMMON_SCHEDULES.map((s) => (
              <button
                key={s.cron}
                type="button"
                onClick={() => setSchedule(s.cron)}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-xs transition-all",
                  schedule === s.cron
                    ? "border-[#6366f1] bg-[#6366f1]/10 text-white"
                    : "border-white/10 text-white/50 hover:border-white/20",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-white/30 font-mono">
          {describeCron(schedule)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/50 transition-colors hover:border-white/20 hover:text-white/70"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            "bg-[#6366f1] text-white hover:bg-[#5558e6]",
            (submitting || !name.trim()) && "opacity-50 cursor-not-allowed",
          )}
        >
          {submitting ? "Creating..." : "Create Job"}
        </button>
      </div>
    </form>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function CronJobsSection() {
  const [jobs, setJobs] = useState<ReadonlyArray<CronJob>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/cron-jobs");
      const data = await response.json();
      if (data.jobs) {
        setJobs(data.jobs);
      } else if (data.error) {
        setErrorMessage(data.error);
      }
    } catch (err) {
      setErrorMessage(`Failed to load cron jobs: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  async function handleToggle(job: CronJob) {
    setTogglingId(job.id);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cron-jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, is_active: !job.is_active }),
      });

      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
      } else {
        await loadJobs();
      }
    } catch (err) {
      setErrorMessage(`Failed to toggle job: ${(err as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleTrigger(jobId: string) {
    setTriggeringId(jobId);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cron-jobs/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
      } else {
        // Reload to get updated last_run_at
        setTimeout(() => loadJobs(), 2000);
      }
    } catch (err) {
      setErrorMessage(`Failed to trigger job: ${(err as Error).message}`);
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleCreate(form: NewJobForm) {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
      } else {
        setShowCreateForm(false);
        await loadJobs();
      }
    } catch (err) {
      setErrorMessage(`Failed to create job: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(jobId: string) {
    setDeletingId(jobId);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/cron-jobs?id=${jobId}`, {
        method: "DELETE",
      });

      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
      } else {
        await loadJobs();
      }
    } catch (err) {
      setErrorMessage(`Failed to delete job: ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Cron Jobs</h3>
          <p className="mt-1 text-sm text-white/50">
            Manage scheduled tasks for triage scans, SLA monitoring, and other recurring operations.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            showCreateForm
              ? "border border-white/10 text-white/50 hover:text-white/70"
              : "bg-[#6366f1] text-white hover:bg-[#5558e6]",
          )}
        >
          {showCreateForm ? (
            "Cancel"
          ) : (
            <>
              {PLUS_ICON}
              <span>New Job</span>
            </>
          )}
        </button>
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <CreateJobForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
          submitting={submitting}
        />
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span className="text-xs font-medium text-white/40">
          {jobs.length} job{jobs.length !== 1 ? "s" : ""}
        </span>
        <span className="text-white/10">|</span>
        <span className="text-xs text-emerald-400/70">
          {jobs.filter((j) => j.is_active).length} active
        </span>
        <span className="text-white/10">|</span>
        <span className="text-xs text-white/30">
          {jobs.filter((j) => !j.is_active).length} paused
        </span>
        {jobs.some((j) => j.last_status === "error") && (
          <>
            <span className="text-white/10">|</span>
            <span className="text-xs text-red-400/70">
              {jobs.filter((j) => j.last_status === "error").length} with errors
            </span>
          </>
        )}
      </div>

      {/* Job list */}
      {jobs.length === 0 ? (
        <div
          className="rounded-xl border border-white/10 p-8 text-center"
          style={{ backgroundColor: "#1a0f35" }}
        >
          <p className="text-sm text-white/50">
            No cron jobs configured. Click &quot;New Job&quot; to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const isExpanded = expandedId === job.id;
            const isTriggering = triggeringId === job.id;
            const isToggling = togglingId === job.id;
            const isDeleting = deletingId === job.id;

            return (
              <div
                key={job.id}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
              >
                {/* Collapsed row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
                >
                  {/* Status indicator */}
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      job.is_active
                        ? job.last_status === "error"
                          ? "bg-red-500/10"
                          : "bg-emerald-500/10"
                        : "bg-white/5",
                    )}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={cn(
                        job.is_active
                          ? job.last_status === "error"
                            ? "text-red-400"
                            : "text-emerald-400"
                          : "text-white/20",
                      )}
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{job.name}</p>
                      <StatusBadge status={job.last_status} isActive={job.is_active} />
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-[10px] font-mono text-white/30">{job.schedule}</span>
                      <span className="text-[10px] text-white/20">-</span>
                      <span className="text-[10px] text-white/40">{describeCron(job.schedule)}</span>
                      {job.last_run_at && (
                        <>
                          <span className="text-[10px] text-white/20">-</span>
                          <span className="text-[10px] text-white/30">
                            Last: {formatTimestamp(job.last_run_at)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn(
                      "shrink-0 text-white/30 transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-white/10 px-5 py-5 space-y-5">
                    {/* Description */}
                    {job.description && (
                      <p className="text-sm text-white/50">{job.description}</p>
                    )}

                    {/* Info grid */}
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">
                          Schedule
                        </p>
                        <p className="text-sm font-mono text-white">{job.schedule}</p>
                        <p className="text-[10px] text-white/40">{describeCron(job.schedule)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">
                          Endpoint
                        </p>
                        <p className="text-sm font-mono text-white">{job.endpoint}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">
                          Last Run
                        </p>
                        <p className="text-sm text-white">
                          {formatTimestamp(job.last_run_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">
                          Next Run
                        </p>
                        <p className="text-sm text-white">
                          {getNextRun(job.schedule, job.is_active)}
                        </p>
                      </div>
                    </div>

                    {/* Error details */}
                    {job.last_status === "error" && job.last_error && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1">
                          Last Error
                        </p>
                        <p className="text-xs text-red-400 font-mono break-all">
                          {job.last_error}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-1">
                      {/* Toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(job); }}
                        disabled={isToggling}
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors",
                          job.is_active ? "bg-[#6366f1]" : "bg-white/10",
                          isToggling && "opacity-50",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                            job.is_active ? "left-[22px]" : "left-0.5",
                          )}
                        />
                      </button>
                      <span className="text-xs text-white/40">
                        {job.is_active ? "Active" : "Paused"}
                      </span>

                      <span className="flex-1" />

                      {/* Run now */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTrigger(job.id); }}
                        disabled={isTriggering}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 transition-all hover:border-[#6366f1]/50 hover:text-white hover:bg-[#6366f1]/10",
                          isTriggering && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {isTriggering ? (
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border border-white/20 border-t-white/60" />
                        ) : (
                          PLAY_ICON
                        )}
                        <span>{isTriggering ? "Running..." : "Run Now"}</span>
                      </button>

                      {/* Delete */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                        disabled={isDeleting}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-red-400/60 transition-all hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10",
                          isDeleting && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {TRASH_ICON}
                        <span>{isDeleting ? "Deleting..." : "Delete"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
