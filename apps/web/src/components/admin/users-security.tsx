"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";

// ── Types ────────────────────────────────────────────────────────────

interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly role: "admin" | "manager" | "viewer";
  readonly created_at: string;
  readonly updated_at: string;
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

const PLUS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

const CLOSE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const USER_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

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

      onCreated(data.user as UserProfile);
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">New User</h4>
        <button
          type="button"
          onClick={onCancel}
          className="text-white/40 hover:text-white transition-colors"
        >
          {CLOSE_ICON}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="user-name" className="mb-1.5 block text-xs font-medium text-white/60">
          Full Name
        </label>
        <input
          id="user-name"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Jane Smith"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="user-email" className="mb-1.5 block text-xs font-medium text-white/60">
          Email
        </label>
        <input
          id="user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@company.com"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-[#6366f1]"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-white/60">
          Role
        </label>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-all",
                role === r.value
                  ? "border-[#6366f1] bg-[#6366f1]/10"
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
            "bg-[#6366f1] text-white hover:bg-[#5558e6]",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? "Creating..." : "Create User"}
        </button>
      </div>
    </form>
  );
}

// ── Role Editor ──────────────────────────────────────────────────────

function RoleEditor({
  user,
  onUpdated,
  onCancel,
}: {
  readonly user: UserProfile;
  readonly onUpdated: (user: UserProfile) => void;
  readonly onCancel: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (selectedRole === user.role) {
      onCancel();
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/users?id=${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to update role");
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
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {ROLES.map((r) => (
          <button
            key={r.value}
            onClick={() => setSelectedRole(r.value)}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-left transition-all",
              selectedRole === r.value
                ? "border-[#6366f1] bg-[#6366f1]/10"
                : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]",
            )}
          >
            <p className="text-[11px] font-medium text-white">{r.label}</p>
          </button>
        ))}
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
            "bg-[#6366f1] text-white hover:bg-[#5558e6]",
            saving && "opacity-50 cursor-not-allowed",
          )}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── User Row ─────────────────────────────────────────────────────────

function UserRow({
  user,
  isCurrentUser,
  onUpdated,
}: {
  readonly user: UserProfile;
  readonly isCurrentUser: boolean;
  readonly onUpdated: (updated: UserProfile) => void;
}) {
  const [editing, setEditing] = useState(false);

  const initials = (user.full_name ?? user.email)
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const createdDate = new Date(user.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#6366f1]/20 text-sm font-bold text-[#6366f1]">
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
            {isCurrentUser && (
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/30">
                you
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3">
            <span className="text-xs text-white/40 truncate">{user.email}</span>
            <span className="text-[10px] text-white/30">Joined {createdDate}</span>
          </div>
        </div>

        {/* Edit button */}
        {!isCurrentUser && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:border-white/20 hover:text-white"
          >
            Edit role
          </button>
        )}
      </div>

      {/* Inline role editor */}
      {editing && (
        <div className="mt-3 ml-14">
          <RoleEditor
            user={user}
            onUpdated={(updated) => {
              onUpdated(updated);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
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

  // Get current user id from Supabase client
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
    setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
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
          <h3 className="text-lg font-semibold text-white">Users & Security</h3>
          <p className="mt-1 text-sm text-white/50">
            Manage user accounts and their roles.
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5558e6]"
          >
            {PLUS_ICON}
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
          {USER_ICON}
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
      </div>

      {/* User list */}
      {users.length === 0 && !error ? (
        <div
          className="rounded-xl border border-white/10 p-8 text-center"
          style={{ backgroundColor: "#1a0f35" }}
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
              All Users
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
