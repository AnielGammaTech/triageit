"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ────────────────────────────────────────────────────────────

interface LoginEvent {
  readonly id: string;
  readonly ip_address: string | null;
  readonly device_type: string | null;
  readonly browser: string | null;
  readonly os: string | null;
  readonly created_at: string;
}

interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly role: "admin" | "manager" | "viewer";
  readonly created_at: string;
  readonly updated_at: string;
  readonly mfa_enabled: boolean;
  readonly login_events: ReadonlyArray<LoginEvent>;
}

type Role = "admin" | "manager" | "viewer";

const ROLES: ReadonlyArray<{ readonly value: Role; readonly label: string; readonly desc: string }> = [
  { value: "admin", label: "Admin", desc: "Full access to all settings and data" },
  { value: "manager", label: "Manager", desc: "Can view and approve triage results" },
  { value: "viewer", label: "Viewer", desc: "Read-only access to dashboards" },
];

const ROLE_COLORS: Record<Role, string> = {
  admin: "bg-violet-500/20 text-violet-400",
  manager: "bg-amber-500/20 text-amber-400",
  viewer: "bg-white/10 text-white/50",
};

// ── Icons ────────────────────────────────────────────────────────────

const ICONS = {
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" /><path d="M5 12h14" />
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  ),
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  chevronUp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  ),
  shield: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  key: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  monitor: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
    </svg>
  ),
  smartphone: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  edit: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
} as const;

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getDeviceIcon(type: string | null) {
  if (type === "mobile" || type === "tablet") return ICONS.smartphone;
  return ICONS.monitor;
}

// ── Create User Form ─────────────────────────────────────────────────

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  readonly onCreated: (user: UserProfile) => void;
  readonly onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !fullName.trim()) {
      setError("Name and email are required.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), full_name: fullName.trim(), role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create user");
        setSaving(false);
        return;
      }

      if (data.temp_password) {
        setTempPassword(data.temp_password as string);
        setSaving(false);
        return;
      }

      onCreated(data.user as UserProfile);
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setPasswordCopied(true);
    setTimeout(() => setPasswordCopied(false), 2000);
  }

  if (tempPassword) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            {ICONS.check}
          </span>
          <h4 className="text-sm font-semibold text-emerald-400">User Created</h4>
        </div>

        <p className="text-xs text-white/60">
          Share these credentials with <strong className="text-white">{fullName || email}</strong>. The temporary password will not be shown again.
        </p>

        <div className="space-y-2">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">Email</p>
            <p className="text-sm font-mono text-white">{email}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">Temporary Password</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-mono text-white select-all">{tempPassword}</p>
              <button
                type="button"
                onClick={() => copyToClipboard(tempPassword)}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors",
                  passwordCopied
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white",
                )}
              >
                {passwordCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            fetch("/api/users")
              .then((r) => r.json())
              .then((d) => {
                const users = (d.users ?? []) as UserProfile[];
                const created = users.find((u) => u.email === email);
                if (created) onCreated(created);
                else onCancel();
              })
              .catch(() => onCancel());
          }}
          className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">New User</h4>
        <button type="button" onClick={onCancel} className="text-white/40 hover:text-white transition-colors">
          {ICONS.close}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="user-name" className="mb-1.5 block text-xs font-medium text-white/60">Full Name</label>
        <input
          id="user-name"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Jane Smith"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#b91c1c]"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="user-email" className="mb-1.5 block text-xs font-medium text-white/60">Email</label>
        <input
          id="user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@company.com"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#b91c1c]"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">Role</label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-all",
                role === r.value
                  ? "border-[#b91c1c] bg-[#b91c1c]/10"
                  : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <p className="text-xs font-medium text-white">{r.label}</p>
              <p className="mt-0.5 text-[10px] text-white/40">{r.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition-colors hover:bg-white/[0.04]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            "bg-[#b91c1c] text-white hover:bg-[#a31919]",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? "Creating..." : "Create User"}
        </button>
      </div>
    </form>
  );
}

// ── Edit User Panel ──────────────────────────────────────────────────

function EditUserPanel({
  user,
  onUpdated,
  onCancel,
}: {
  readonly user: UserProfile;
  readonly isCurrentUser: boolean;
  readonly onUpdated: (user: UserProfile) => void;
  readonly onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const hasChanges = fullName !== (user.full_name ?? "") || selectedRole !== user.role;
    if (!hasChanges) {
      onCancel();
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const body: Record<string, string> = {};
      if (fullName !== (user.full_name ?? "")) body.full_name = fullName;
      if (selectedRole !== user.role) body.role = selectedRole;

      const res = await fetch(`/api/users?id=${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to update user");
        setSaving(false);
        return;
      }

      onUpdated(data.user as UserProfile);
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h5 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Edit User</h5>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div>
        <label htmlFor={`edit-name-${user.id}`} className="mb-1 block text-[11px] text-white/50">Name</label>
        <input
          id={`edit-name-${user.id}`}
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#b91c1c]"
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-white/50">Role</label>
        <div className="grid grid-cols-3 gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => setSelectedRole(r.value)}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition-all",
                selectedRole === r.value
                  ? "border-[#b91c1c] bg-[#b91c1c]/10"
                  : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <p className="text-[11px] font-medium text-white">{r.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/[0.04]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            "bg-[#b91c1c] text-white hover:bg-[#a31919]",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Password Reset ───────────────────────────────────────────────────

function PasswordResetButton({ userId }: { readonly userId: string }) {
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setError(null);
    setResetting(true);

    try {
      const res = await fetch(`/api/users?id=${userId}&action=reset-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to reset password");
        setResetting(false);
        return;
      }

      setNewPassword(data.temp_password as string);
    } catch {
      setError("Network error");
    }
    setResetting(false);
  }

  async function copyPassword() {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = newPassword;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (newPassword) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">New Password</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-mono text-white select-all">{newPassword}</p>
          <button
            type="button"
            onClick={copyPassword}
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors",
              copied
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-white/10 text-white/60 hover:bg-white/15",
            )}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setNewPassword(null)}
          className="text-[10px] text-white/40 hover:text-white/60 transition-colors"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="text-[10px] text-red-400 mb-1">{error}</p>
      )}
      <button
        onClick={handleReset}
        disabled={resetting}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:border-amber-500/30 hover:text-amber-400"
      >
        {ICONS.key}
        {resetting ? "Resetting..." : "Reset Password"}
      </button>
    </div>
  );
}

// ── Login History ────────────────────────────────────────────────────

function LoginHistory({ events }: { readonly events: ReadonlyArray<LoginEvent> }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-white/30 italic">No login history recorded yet.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
        >
          <span className="text-white/30">{getDeviceIcon(event.device_type)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/70">
                {event.browser ?? "Unknown"} / {event.os ?? "Unknown"}
              </span>
              <span className="text-[10px] text-white/30 capitalize">
                {event.device_type ?? "unknown"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-white/30 font-mono">
                {event.ip_address ?? "—"}
              </span>
            </div>
          </div>
          <span className="shrink-0 text-[10px] text-white/30">
            {formatDateTime(event.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── User Row (Expandable) ────────────────────────────────────────────

function UserRow({
  user,
  isCurrentUser,
  onUpdated,
}: {
  readonly user: UserProfile;
  readonly isCurrentUser: boolean;
  readonly onUpdated: (updated: UserProfile) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const initials = (user.full_name ?? user.email)
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const lastLogin = user.login_events.length > 0
    ? formatDateTime(user.login_events[0].created_at)
    : "Never";

  return (
    <div>
      {/* Main row — clickable to expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#b91c1c]/20 text-sm font-bold text-[#b91c1c]">
            {initials || "?"}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white truncate">
                {user.full_name || user.email}
              </p>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", ROLE_COLORS[user.role])}>
                {user.role}
              </span>
              {user.mfa_enabled && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  {ICONS.shield}
                  MFA
                </span>
              )}
              {isCurrentUser && (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/30">
                  you
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3">
              <span className="text-xs text-white/40 truncate">{user.email}</span>
              <span className="text-[10px] text-white/30">Joined {formatDate(user.created_at)}</span>
              <span className="text-[10px] text-white/25">Last login: {lastLogin}</span>
            </div>
          </div>

          {/* Expand icon */}
          <span className="shrink-0 text-white/30 transition-transform">
            {expanded ? ICONS.chevronUp : ICONS.chevronDown}
          </span>
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-5 pb-4 ml-14 space-y-4">
          {/* Actions bar */}
          <div className="flex items-center gap-3">
            {!isCurrentUser && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:border-[#b91c1c]/30 hover:text-[#b91c1c]"
              >
                {ICONS.edit}
                Edit User
              </button>
            )}
            {!isCurrentUser && (
              <PasswordResetButton userId={user.id} />
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-white/30">
              {ICONS.shield}
              <span className="text-[10px]">
                MFA: {user.mfa_enabled ? (
                  <span className="text-emerald-400 font-semibold">Enabled</span>
                ) : (
                  <span className="text-white/40">Not enabled</span>
                )}
              </span>
            </div>
          </div>

          {/* Edit panel */}
          {editing && (
            <EditUserPanel
              user={user}
              isCurrentUser={isCurrentUser}
              onUpdated={(updated) => {
                onUpdated(updated);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          )}

          {/* Login history */}
          <div>
            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">
              Recent Logins
            </h5>
            <LoginHistory events={user.login_events} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function UsersSecuritySection() {
  const [users, setUsers] = useState<ReadonlyArray<UserProfile>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to load users");
        setLoading(false);
        return;
      }

      setUsers(data.users as ReadonlyArray<UserProfile>);
      setError(null);
    } catch {
      setError("Failed to load users. Please try again.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    async function getCurrentUser() {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    }
    getCurrentUser();
  }, []);

  function handleUserCreated(newUser: UserProfile) {
    setUsers([...users, newUser]);
    setShowCreateForm(false);
  }

  function handleUserUpdated(updated: UserProfile) {
    setUsers(users.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
  }

  const mfaCount = users.filter((u) => u.mfa_enabled).length;

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
          <h3 className="text-lg font-semibold text-white">Users & Security</h3>
          <p className="mt-1 text-sm text-white/50">
            Manage accounts, passwords, MFA, and login activity.
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#b91c1c] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#a31919]"
          >
            {ICONS.plus}
            <span>Add User</span>
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <CreateUserForm
          onCreated={handleUserCreated}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-1.5 text-white/40">
          {ICONS.user}
          <span className="text-xs font-medium">{users.length} user{users.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="h-3 w-px bg-white/10" />
        {ROLES.map((r) => {
          const count = users.filter((u) => u.role === r.value).length;
          return (
            <div key={r.value} className="flex items-center gap-1.5">
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", ROLE_COLORS[r.value])}>
                {count}
              </span>
              <span className="text-[10px] text-white/30">{r.label}{count !== 1 ? "s" : ""}</span>
            </div>
          );
        })}
        <div className="h-3 w-px bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            mfaCount > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/40",
          )}>
            {ICONS.shield}
            {mfaCount}
          </span>
          <span className="text-[10px] text-white/30">MFA enabled</span>
        </div>
      </div>

      {/* User list */}
      {users.length === 0 && !error ? (
        <div
          className="rounded-xl border border-white/10 p-8 text-center"
          style={{ backgroundColor: "#241010" }}
        >
          <p className="text-sm text-white/50">No users found.</p>
          <p className="mt-1 text-xs text-white/30">
            Click &quot;Add User&quot; to create the first user account.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="border-b border-white/10 px-5 py-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40">
              All Users — click to expand
            </h4>
          </div>
          <div className="divide-y divide-white/5">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isCurrentUser={user.id === currentUserId}
                onUpdated={handleUserUpdated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
