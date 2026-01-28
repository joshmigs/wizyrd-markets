"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthGate from "@/app/components/AuthGate";
import AuthGuard from "@/app/components/AuthGuard";
import LogoMark from "@/app/components/LogoMark";
import TeamLogo from "@/app/components/TeamLogo";
import SelfExclusionForm from "@/app/(league)/components/SelfExclusionForm";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AdminLeagueMember = {
  id: string;
  display_name: string | null;
  team_logo_url: string | null;
  is_creator?: boolean;
};

type AdminLeague = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  created_by: string;
  member_count: number;
  members: AdminLeagueMember[];
};

type PromptLog = {
  id: string;
  prompt: string;
  response: string | null;
  created_at: string;
  user_id: string | null;
  display_name: string | null;
  user_email?: string | null;
  read_at?: string | null;
  read_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  flagged?: boolean | null;
  flagged_at?: string | null;
};

type SuperAdminEntry = {
  user_id: string;
  display_name: string | null;
  user_email: string | null;
  role?: string | null;
  added_by?: string | null;
  created_at?: string | null;
  primary?: boolean;
};

const PRIMARY_ADMIN_EMAIL = "joshuamigliardi@gmail.com";

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMessage, setLogoMessage] = useState<string | null>(null);
  const [powerUser, setPowerUser] = useState(false);
  const [owner, setOwner] = useState(false);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [superAdminEmail, setSuperAdminEmail] = useState("");
  const [superAdminMessage, setSuperAdminMessage] = useState<string | null>(null);
  const [superAdminLoading, setSuperAdminLoading] = useState(false);
  const [superAdminList, setSuperAdminList] = useState<SuperAdminEntry[]>([]);
  const [superAdminListLoading, setSuperAdminListLoading] = useState(false);
  const [superAdminListError, setSuperAdminListError] = useState<string | null>(
    null
  );
  const [superAdminListWarning, setSuperAdminListWarning] = useState<string | null>(
    null
  );
  const [superAdminActionLoading, setSuperAdminActionLoading] = useState<
    Record<string, boolean>
  >({});
  const [superAdminActionMessage, setSuperAdminActionMessage] = useState<
    string | null
  >(null);
  const [banEmail, setBanEmail] = useState("");
  const [banDuration, setBanDuration] = useState("1w");
  const [banReason, setBanReason] = useState("");
  const [banMessage, setBanMessage] = useState<string | null>(null);
  const [banLoading, setBanLoading] = useState(false);
  const [unbanLoading, setUnbanLoading] = useState(false);
  const [adminLeagues, setAdminLeagues] = useState<AdminLeague[]>([]);
  const [adminLeaguesLoading, setAdminLeaguesLoading] = useState(false);
  const [adminLeaguesError, setAdminLeaguesError] = useState<string | null>(null);
  const [expandedLeagueId, setExpandedLeagueId] = useState<string | null>(null);
  const [adminActionLoading, setAdminActionLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [adminActionMessage, setAdminActionMessage] = useState<string | null>(null);
  const [promptLogs, setPromptLogs] = useState<PromptLog[]>([]);
  const [promptLogsLoading, setPromptLogsLoading] = useState(false);
  const [promptLogsError, setPromptLogsError] = useState<string | null>(null);
  const [promptLogBulkLoading, setPromptLogBulkLoading] = useState(false);
  const [promptLogActionLoading, setPromptLogActionLoading] = useState<
    Record<string, boolean>
  >({});
  const [selectedPromptLogs, setSelectedPromptLogs] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoadingSession(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const loadProfile = async () => {
      setProfileLoading(true);
      setProfileMessage(null);
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name, team_logo_url")
        .eq("id", session.user.id)
        .maybeSingle();

      const fallback = session.user.email?.split("@")[0] ?? "";
      setDisplayName(data?.display_name ?? fallback);
      setTeamLogoUrl(data?.team_logo_url ?? null);
      setProfileLoading(false);
    };

    loadProfile();
  }, [session]);

  useEffect(() => {
    if (!logoPreview) {
      return;
    }

    return () => {
      URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  useEffect(() => {
    if (!session?.access_token) {
      setPowerUser(false);
      return;
    }

    const loadStatus = async () => {
      const response = await fetch("/api/account/status", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json();
      setPowerUser(Boolean(result?.powerUser));
      setOwner(Boolean(result?.owner));
      setSuperAdmin(Boolean(result?.superAdmin));
    };

    loadStatus();
  }, [session]);

  const handleProfileUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user) {
      return;
    }

    setProfileLoading(true);
    setProfileMessage(null);

    const supabase = createSupabaseBrowserClient();
    const nextDisplayName = displayName.trim();
    const { error } = await supabase.from("profiles").upsert({
      id: session.user.id,
      display_name: nextDisplayName
    });

    setProfileLoading(false);

    if (error) {
      setProfileMessage(error.message);
      return;
    }

    if (nextDisplayName) {
      const { error: authError } = await supabase.auth.updateUser({
        data: { display_name: nextDisplayName }
      });
      if (authError) {
        setProfileMessage(authError.message);
        return;
      }
    }

    setProfileMessage("Display name updated.");
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!session?.user) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLogoMessage(null);
    setLogoUploading(true);
    setLogoPreview(URL.createObjectURL(file));

    const supabase = createSupabaseBrowserClient();
    const filePath = `${session.user.id}/team-logo`;
    const { error: uploadError } = await supabase.storage
      .from("team-logos")
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type || "image/png"
      });

    if (uploadError) {
      setLogoUploading(false);
      setLogoMessage(uploadError.message);
      return;
    }

    const { data: publicData } = supabase.storage
      .from("team-logos")
      .getPublicUrl(filePath);
    const publicUrl = `${publicData.publicUrl}?v=${Date.now()}`;
    const safeDisplayName =
      displayName.trim() ||
      session.user.user_metadata?.display_name ||
      session.user.email?.split("@")[0] ||
      "Player";

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: session.user.id,
        display_name: safeDisplayName,
        team_logo_url: publicUrl
      },
      { onConflict: "id" }
    );

    setLogoUploading(false);

    if (profileError) {
      setLogoMessage(profileError.message);
      return;
    }

    setTeamLogoUrl(publicUrl);
    setLogoPreview(null);
    setLogoMessage("Team logo updated.");
  };

  const handleLogoRemove = async () => {
    if (!session?.user) {
      return;
    }

    setLogoMessage(null);
    setLogoUploading(true);

    const supabase = createSupabaseBrowserClient();
    const filePath = `${session.user.id}/team-logo`;

    await supabase.storage.from("team-logos").remove([filePath]);
    const safeDisplayName =
      displayName.trim() ||
      session.user.user_metadata?.display_name ||
      session.user.email?.split("@")[0] ||
      "Player";

    const { error } = await supabase.from("profiles").upsert(
      {
        id: session.user.id,
        display_name: safeDisplayName,
        team_logo_url: null
      },
      { onConflict: "id" }
    );

    setLogoUploading(false);

    if (error) {
      setLogoMessage(error.message);
      return;
    }

    setTeamLogoUrl(null);
    setLogoPreview(null);
    setLogoMessage("Team logo removed.");
  };

  const handleClearExclusion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) {
      return;
    }
    const trimmedIdentifier = adminEmail.trim();
    if (!trimmedIdentifier) {
      setAdminMessage("Enter a user email or username to clear.");
      return;
    }

    setAdminLoading(true);
    setAdminMessage(null);

    const response = await fetch("/api/account/self-exclusion/clear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ identifier: trimmedIdentifier })
    });

    let result: { error?: string; cleared?: number } = {};
    try {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }
    setAdminLoading(false);

    if (!response.ok) {
      const fallback =
        result.error ??
        (response.statusText ||
          `Unable to clear self-exclusion (status ${response.status}).`);
      setAdminMessage(fallback);
      return;
    }

    setAdminMessage(`Cleared self-exclusion (${result.cleared ?? 0}).`);
  };

  const handleAddSuperAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) {
      return;
    }
    const trimmedIdentifier = superAdminEmail.trim();
    if (!trimmedIdentifier) {
      setSuperAdminMessage("Enter a user email or username to grant access.");
      return;
    }

    setSuperAdminLoading(true);
    setSuperAdminMessage(null);

    const response = await fetch("/api/admin/super-admins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ identifier: trimmedIdentifier })
    });

    let result: { error?: string } = {};
    try {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }

    setSuperAdminLoading(false);

    if (!response.ok) {
      const fallback =
        result.error ??
        (response.statusText ||
          `Unable to add super admin (status ${response.status}).`);
      setSuperAdminMessage(fallback);
      return;
    }

    setSuperAdminMessage("Super admin access granted.");
    setSuperAdminEmail("");
    loadSuperAdminList();
  };

  const handleBanUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.access_token) {
      return;
    }
    const trimmedIdentifier = banEmail.trim();
    if (!trimmedIdentifier) {
      setBanMessage("Enter a user email or username to ban.");
      return;
    }

    setBanLoading(true);
    setBanMessage(null);

    const response = await fetch("/api/admin/bans", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        identifier: trimmedIdentifier,
        duration: banDuration,
        reason: banReason.trim() || null
      })
    });

    let result: { error?: string; bannedUntil?: string | null } = {};
    try {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }

    setBanLoading(false);

    if (!response.ok) {
      const fallback =
        result.error ??
        (response.statusText || `Unable to ban user (status ${response.status}).`);
      setBanMessage(fallback);
      return;
    }

    const untilLabel = result.bannedUntil
      ? `until ${new Date(result.bannedUntil).toLocaleString()}`
      : "until lifted";
    setBanMessage(`User banned ${untilLabel}.`);
  };

  const handleUnbanUser = async () => {
    if (!session?.access_token) {
      return;
    }
    const trimmedIdentifier = banEmail.trim();
    if (!trimmedIdentifier) {
      setBanMessage("Enter a user email or username to clear.");
      return;
    }

    setUnbanLoading(true);
    setBanMessage(null);

    const response = await fetch("/api/admin/bans", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ identifier: trimmedIdentifier })
    });

    let result: { error?: string; cleared?: number } = {};
    try {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }

    setUnbanLoading(false);

    if (!response.ok) {
      const fallback =
        result.error ??
        (response.statusText || `Unable to clear ban (status ${response.status}).`);
      setBanMessage(fallback);
      return;
    }

    setBanMessage(`Ban cleared (${result.cleared ?? 0}).`);
  };

  const handleRemoveSuperAdminEntry = async (entry: SuperAdminEntry) => {
    if (!session?.access_token) {
      return;
    }

    const name = entry.display_name ?? entry.user_email ?? "this user";
    const confirmMessage = `Revoke super admin access for ${name}?`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }

    setSuperAdminActionLoading((current) => ({
      ...current,
      [entry.user_id]: true
    }));
    setSuperAdminActionMessage(null);

    const response = await fetch("/api/admin/super-admins", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ userId: entry.user_id })
    });

    let result: { error?: string; removed?: number } = {};
    try {
      const text = await response.text();
      result = text ? JSON.parse(text) : {};
    } catch {
      result = {};
    }

    setSuperAdminActionLoading((current) => ({
      ...current,
      [entry.user_id]: false
    }));

    if (!response.ok) {
      const fallback =
        result.error ??
        (response.statusText ||
          `Unable to remove super admin (status ${response.status}).`);
      setSuperAdminActionMessage(fallback);
      return;
    }

    setSuperAdminActionMessage(
      (result.removed ?? 0) > 0
        ? "Super admin access removed."
        : "No super admin access found for that account."
    );
    loadSuperAdminList();
  };

  const loadSuperAdminList = async () => {
    if (!session?.access_token) {
      return;
    }

    setSuperAdminListLoading(true);
    setSuperAdminListError(null);
    setSuperAdminListWarning(null);
    try {
      const response = await fetch("/api/admin/super-admins", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSuperAdminList([]);
        setSuperAdminListError(result.error ?? "Unable to load super admins.");
        return;
      }

      setSuperAdminList((result.superAdmins ?? []) as SuperAdminEntry[]);
      setSuperAdminListWarning(result.warning ?? null);
    } catch (_error) {
      setSuperAdminList([]);
      setSuperAdminListError("Unable to load super admins.");
    } finally {
      setSuperAdminListLoading(false);
    }
  };

  const loadAdminLeagues = async () => {
    if (!session?.access_token) {
      return;
    }

    setAdminLeaguesLoading(true);
    setAdminLeaguesError(null);
    try {
      const response = await fetch("/api/admin/leagues", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAdminLeagues([]);
        setAdminLeaguesError(result.error ?? "Unable to load leagues.");
        return;
      }

      setAdminLeagues((result.leagues ?? []) as AdminLeague[]);
    } catch (_error) {
      setAdminLeagues([]);
      setAdminLeaguesError("Unable to load leagues.");
    } finally {
      setAdminLeaguesLoading(false);
    }
  };

  const loadPromptLogs = async () => {
    if (!session?.access_token) {
      return;
    }

    setPromptLogsLoading(true);
    setPromptLogsError(null);
    try {
      const response = await fetch("/api/admin/wizyrd-logs?limit=200", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPromptLogs([]);
        setPromptLogsError(result.error ?? "Unable to load chat logs.");
        return;
      }

      setPromptLogs((result.logs ?? []) as PromptLog[]);
      setSelectedPromptLogs(new Set());
      if (result.warning) {
        setPromptLogsError(result.warning);
      }
    } catch (_error) {
      setPromptLogs([]);
      setPromptLogsError("Unable to load chat logs.");
    } finally {
      setPromptLogsLoading(false);
    }
  };

  const formatLogTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  };

  const getUndoRemainingMs = (deletedAt?: string | null) => {
    if (!deletedAt) {
      return 0;
    }
    const deletedTime = new Date(deletedAt).getTime();
    if (Number.isNaN(deletedTime)) {
      return 0;
    }
    const expiresAt = deletedTime + 30 * 1000;
    return Math.max(expiresAt - Date.now(), 0);
  };

  const formatUndoRemaining = (ms: number) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const togglePromptLogSelection = (logId: string) => {
    setSelectedPromptLogs((current) => {
      const next = new Set(current);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const clearPromptLogSelection = () => {
    setSelectedPromptLogs(new Set());
  };

  const markPromptLogRead = async (logId: string) => {
    if (!session?.access_token) {
      return;
    }
    setPromptLogActionLoading((current) => ({ ...current, [logId]: true }));
    setPromptLogsError(null);
    try {
      const response = await fetch("/api/admin/wizyrd-logs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ id: logId, read: true })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPromptLogsError(result.error ?? "Unable to update log status.");
        return;
      }
      setPromptLogs((current) =>
        current.map((log) =>
          log.id === logId
            ? {
                ...log,
                read_at: result.read_at ?? new Date().toISOString(),
                read_by: result.read_by ?? session.user.id
              }
            : log
        )
      );
    } catch (_error) {
      setPromptLogsError("Unable to update log status.");
    } finally {
      setPromptLogActionLoading((current) => ({ ...current, [logId]: false }));
    }
  };

  const deletePromptLog = async (
    logId: string,
    options?: { isFlagged?: boolean; force?: boolean; skipConfirm?: boolean }
  ) => {
    if (!session?.access_token) {
      return;
    }
    if (options?.isFlagged) {
      setPromptLogsError("Unflag this chat log before deleting it.");
      return;
    }
    const forceDelete = Boolean(options?.force);
    if (!options?.skipConfirm && typeof window !== "undefined") {
      const confirmed = window.confirm(
        forceDelete
          ? "Delete this chat log now? This cannot be undone."
          : "Delete this chat log? You can undo for 30 seconds."
      );
      if (!confirmed) {
        return;
      }
    }
    const actionKey = forceDelete ? `delete-now:${logId}` : `delete:${logId}`;
    setPromptLogActionLoading((current) => ({ ...current, [actionKey]: true }));
    setPromptLogsError(null);
    try {
      const response = await fetch("/api/admin/wizyrd-logs", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ id: logId, force: forceDelete })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPromptLogsError(result.error ?? "Unable to delete log.");
        return;
      }
      if (forceDelete || result.force) {
        setPromptLogs((current) => current.filter((log) => log.id !== logId));
        setSelectedPromptLogs((current) => {
          if (!current.has(logId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(logId);
          return next;
        });
      } else {
        setPromptLogs((current) =>
          current.map((log) =>
            log.id === logId
              ? {
                  ...log,
                  deleted_at: result.deleted_at ?? new Date().toISOString(),
                  deleted_by: result.deleted_by ?? session.user.id
                }
              : log
          )
        );
        setSelectedPromptLogs((current) => {
          if (!current.has(logId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(logId);
          return next;
        });
      }
    } catch (_error) {
      setPromptLogsError("Unable to delete log.");
    } finally {
      setPromptLogActionLoading((current) => ({ ...current, [actionKey]: false }));
    }
  };

  const restorePromptLog = async (logId: string) => {
    if (!session?.access_token) {
      return;
    }
    const actionKey = `restore:${logId}`;
    setPromptLogActionLoading((current) => ({ ...current, [actionKey]: true }));
    setPromptLogsError(null);
    try {
      const response = await fetch("/api/admin/wizyrd-logs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ id: logId, restore: true })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPromptLogsError(result.error ?? "Unable to restore log.");
        return;
      }
      setPromptLogs((current) =>
        current.map((log) =>
          log.id === logId
            ? {
                ...log,
                deleted_at: null,
                deleted_by: null
              }
            : log
        )
      );
    } catch (_error) {
      setPromptLogsError("Unable to restore log.");
    } finally {
      setPromptLogActionLoading((current) => ({ ...current, [actionKey]: false }));
    }
  };

  const togglePromptLogFlag = async (logId: string, flagged: boolean) => {
    if (!session?.access_token) {
      return;
    }
    const actionKey = `flag:${logId}`;
    setPromptLogActionLoading((current) => ({ ...current, [actionKey]: true }));
    setPromptLogsError(null);
    try {
      const response = await fetch("/api/admin/wizyrd-logs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ id: logId, flagged })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPromptLogsError(result.error ?? "Unable to update flag.");
        return;
      }
      setPromptLogs((current) =>
        current.map((log) =>
          log.id === logId
            ? {
                ...log,
                flagged: result.flagged ?? flagged,
                flagged_at: result.flagged_at ?? (flagged ? new Date().toISOString() : null)
              }
            : log
        )
      );
    } catch (_error) {
      setPromptLogsError("Unable to update flag.");
    } finally {
      setPromptLogActionLoading((current) => ({ ...current, [actionKey]: false }));
    }
  };

  const flagSelectedPromptLogs = async (flagged: boolean) => {
    if (!session?.access_token) {
      return;
    }
    const selected = promptLogs.filter((log) => selectedPromptLogs.has(log.id));
    if (!selected.length) {
      return;
    }
    setPromptLogBulkLoading(true);
    setPromptLogsError(null);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    };
    const updatedIds = new Set<string>();
    for (const log of selected) {
      try {
        const response = await fetch("/api/admin/wizyrd-logs", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ id: log.id, flagged })
        });
        if (response.ok) {
          updatedIds.add(log.id);
        }
      } catch (_error) {
        // ignore individual failures for bulk action
      }
    }
    if (updatedIds.size) {
      const now = new Date().toISOString();
      setPromptLogs((current) =>
        current.map((log) =>
          updatedIds.has(log.id)
            ? { ...log, flagged, flagged_at: flagged ? now : null }
            : log
        )
      );
    }
    clearPromptLogSelection();
    setPromptLogBulkLoading(false);
  };

  const deleteSelectedPromptLogs = async (forceDelete: boolean) => {
    if (!session?.access_token) {
      return;
    }
    const selected = promptLogs.filter((log) => selectedPromptLogs.has(log.id));
    if (!selected.length) {
      return;
    }
    if (selected.some((log) => log.flagged)) {
      setPromptLogsError("Unflag selected logs before deleting them.");
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        forceDelete
          ? "Delete the selected chat logs now? This cannot be undone."
          : "Delete the selected chat logs? You can undo for 30 seconds."
      );
      if (!confirmed) {
        return;
      }
    }
    setPromptLogBulkLoading(true);
    setPromptLogsError(null);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`
    };
    const succeeded = new Set<string>();
    for (const log of selected) {
      try {
        const response = await fetch("/api/admin/wizyrd-logs", {
          method: "DELETE",
          headers,
          body: JSON.stringify({ id: log.id, force: forceDelete })
        });
        if (response.ok) {
          succeeded.add(log.id);
        }
      } catch (_error) {
        // ignore individual failures for bulk action
      }
    }
    if (succeeded.size) {
      if (forceDelete) {
        setPromptLogs((current) => current.filter((log) => !succeeded.has(log.id)));
      } else {
        const deletedAt = new Date().toISOString();
        setPromptLogs((current) =>
          current.map((log) =>
            succeeded.has(log.id)
              ? { ...log, deleted_at: deletedAt, deleted_by: session.user.id }
              : log
          )
        );
      }
    }
    clearPromptLogSelection();
    setPromptLogBulkLoading(false);
  };

  const handleAdminMemberAction = async (
    leagueId: string,
    userId: string,
    action: "remove" | "ban"
  ) => {
    if (!session?.access_token) {
      return;
    }

    const actionKey = `${leagueId}:${userId}:${action}`;
    setAdminActionLoading((current) => ({ ...current, [actionKey]: true }));
    setAdminActionMessage(null);
    try {
      const response = await fetch("/api/league/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ leagueId, userId, action })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAdminActionMessage(result.error ?? "Unable to update member.");
        return;
      }

      setAdminLeagues((current) =>
        current.map((league) => {
          if (league.id !== leagueId) {
            return league;
          }
          const nextMembers = league.members.filter((member) => member.id !== userId);
          return {
            ...league,
            members: nextMembers,
            member_count: nextMembers.length
          };
        })
      );

      setAdminActionMessage(
        action === "ban" ? "Member banned from league." : "Member removed from league."
      );
    } catch (_error) {
      setAdminActionMessage("Unable to update member.");
    } finally {
      setAdminActionLoading((current) => ({ ...current, [actionKey]: false }));
    }
  };

  const handleAdminDeleteLeague = async (leagueId: string, leagueName: string) => {
    if (!session?.access_token) {
      return;
    }

    const confirmMessage = `Delete ${leagueName}? This removes all matchups, lineups, and league data.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }

    const actionKey = `${leagueId}:delete`;
    setAdminActionLoading((current) => ({ ...current, [actionKey]: true }));
    setAdminActionMessage(null);
    try {
      const response = await fetch("/api/league/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ leagueId })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setAdminActionMessage(result.error ?? "Unable to delete league.");
        return;
      }

      setAdminLeagues((current) => current.filter((league) => league.id !== leagueId));
      setExpandedLeagueId((current) => (current === leagueId ? null : current));
      setAdminActionMessage("League deleted.");
    } catch (_error) {
      setAdminActionMessage("Unable to delete league.");
    } finally {
      setAdminActionLoading((current) => ({ ...current, [actionKey]: false }));
    }
  };

  useEffect(() => {
    if (!session?.access_token || !superAdmin) {
      setSuperAdminList([]);
      setSuperAdminListError(null);
      setSuperAdminListWarning(null);
      return;
    }

    loadSuperAdminList();
  }, [session?.access_token, superAdmin]);

  useEffect(() => {
    if (!session?.access_token || !superAdmin) {
      setAdminLeagues([]);
      setAdminLeaguesError(null);
      return;
    }

    loadAdminLeagues();
  }, [session?.access_token, superAdmin]);

  useEffect(() => {
    if (!session?.access_token || !superAdmin) {
      setPromptLogs([]);
      setPromptLogsError(null);
      return;
    }

    loadPromptLogs();
  }, [session?.access_token, superAdmin]);

  useEffect(() => {
    if (!promptLogs.length) {
      return;
    }
    const interval = window.setInterval(() => {
      setPromptLogs((current) =>
        current.filter((log) => {
          if (!log.deleted_at) {
            return true;
          }
          const remaining = getUndoRemainingMs(log.deleted_at);
          return remaining > 0;
        })
      );
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [promptLogs.length]);

  const selectedPromptLogList = promptLogs.filter((log) =>
    selectedPromptLogs.has(log.id)
  );
  const selectedPromptCount = selectedPromptLogList.length;
  const selectedHasFlagged = selectedPromptLogList.some((log) => log.flagged);

  const canManageBans = owner || superAdmin;
  const canRevokeSuperAdmin =
    Boolean(session?.user?.email) &&
    session.user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;
  const renderSuperAdminRoster = (showActions: boolean) => (
    <div className="mt-4 rounded-2xl border border-amber-100 bg-white/90 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink">Current super admins</h4>
        <button
          type="button"
          onClick={loadSuperAdminList}
          className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-navy transition hover:border-navy hover:bg-navy-soft hover:text-white"
          disabled={superAdminListLoading}
        >
          Refresh
        </button>
      </div>
      {superAdminListLoading ? (
        <p className="mt-3 text-sm text-steel">Loading super admins...</p>
      ) : superAdminListError ? (
        <p className="mt-3 text-sm text-red-600">{superAdminListError}</p>
      ) : superAdminList.length === 0 ? (
        <p className="mt-3 text-sm text-steel">No super admins found yet.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm text-steel">
          {superAdminList.map((entry) => {
            const name = entry.display_name ?? entry.user_email ?? "User";
            const isPrimary = Boolean(entry.primary);
            const isSelf = entry.user_id === session?.user?.id;
            const canRemove =
              showActions && canRevokeSuperAdmin && !isPrimary && !isSelf;
            const isRemoving = superAdminActionLoading[entry.user_id];
            return (
              <div
                key={entry.user_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2"
              >
                <div>
                  <p className="font-semibold text-ink">{name}</p>
                  {entry.user_email ? (
                    <p className="text-xs text-steel">{entry.user_email}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isPrimary ? (
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-800">
                      Primary
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.2em] text-steel">
                      Super admin
                    </span>
                  )}
                  {showActions ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveSuperAdminEntry(entry)}
                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!canRemove || isRemoving}
                      title={
                        !canRemove
                          ? "Primary admin access cannot be revoked."
                          : undefined
                      }
                    >
                      {isRemoving ? "Removing..." : "Revoke super admin"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {superAdminListWarning ? (
        <p className="mt-2 text-xs text-amber-700">{superAdminListWarning}</p>
      ) : null}
      {superAdminActionMessage ? (
        <p className="mt-3 text-sm text-navy">{superAdminActionMessage}</p>
      ) : null}
    </div>
  );

  return (
    <main className="px-6 py-8">
      <AuthGuard
        fallback={
          <AuthGate
            title="Settings"
            subtitle="Sign in or create an account to manage your settings."
            nextPath="/settings"
          />
        }
      >
        {loadingSession ? (
          <div className="mx-auto max-w-4xl text-sm text-steel">
            Checking session...
          </div>
        ) : session ? (
          <div className="mx-auto max-w-4xl space-y-6">
            <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(20,20,20,0.12)]">
              <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:text-left">
                <LogoMark size={44} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy">
                    Account settings
                  </p>
                  <h1 className="mt-1 font-display text-3xl text-ink">Settings</h1>
                  <p className="mt-1 text-sm text-steel">
                    Manage account preferences and safety controls.
                  </p>
                </div>
              </div>
            </header>

            <section
              id="settings-profile"
              className="rounded-2xl border border-amber-100 bg-paper p-6"
            >
              <h2 className="font-display text-2xl text-ink">Profile</h2>
              <p className="mt-2 text-sm text-steel">
                Update your public display name.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleProfileUpdate}>
                <label className="block text-sm font-semibold text-ink">
                  Display name
                  <input
                    className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <div className="text-sm text-steel">
                  Email: {session.user.email}
                </div>
                {profileMessage ? (
                  <p className="text-sm text-navy">{profileMessage}</p>
                ) : null}
                <button
                  className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                  disabled={profileLoading}
                  type="submit"
                >
                  {profileLoading ? "Saving..." : "Save changes"}
                </button>
              </form>

              <div className="mt-8 border-t border-amber-100 pt-6">
                <h3 className="text-lg font-semibold text-ink">Team logo</h3>
                <p className="mt-2 text-sm text-steel">
                  Upload a team logo to show on matchups and your profile.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <TeamLogo
                    src={logoPreview ?? teamLogoUrl}
                    size={96}
                    className="bg-white"
                  />
                  <div className="flex flex-col gap-3 text-sm text-steel">
                    <label className="block">
                      <span className="sr-only">Upload team logo</span>
                      <input
                        className="block w-full text-sm file:mr-4 file:rounded-full file:border file:border-navy/30 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-navy file:shadow-sm file:shadow-navy/10 file:transition hover:file:border-navy hover:file:bg-navy-soft hover:file:text-white"
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        disabled={logoUploading}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        onClick={handleLogoRemove}
                        disabled={logoUploading || (!teamLogoUrl && !logoPreview)}
                      >
                        Remove logo
                      </button>
                      <span className="text-xs text-steel">
                        PNG, JPG, or SVG recommended.
                      </span>
                    </div>
                  </div>
                </div>
                {logoMessage ? (
                  <p className="mt-3 text-sm text-navy">{logoMessage}</p>
                ) : null}
              </div>
            </section>

            {!powerUser ? (
              <section
                id="settings-safety"
                className="rounded-2xl border border-amber-100 bg-paper p-6"
              >
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-display text-2xl text-ink">
                          Safety controls
                        </h2>
                        <p className="mt-1 text-sm text-steel">
                          Optional self-exclusion and break settings.
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-[0.2em] text-navy">
                        Manage
                      </span>
                    </div>
                  </summary>
                  <div className="mt-4 border-t border-amber-100 pt-4">
                    <h3 className="text-sm font-semibold text-ink">
                      Self-exclusion
                    </h3>
                    <p className="mt-2 text-sm text-steel">
                      Lock your account for a set period. This takes effect
                      immediately.
                    </p>
                    <SelfExclusionForm
                      accessToken={session.access_token}
                      onExcluded={() => {}}
                    />
                  </div>
                </details>
              </section>
            ) : (
              <section
                id="settings-admin"
                className="rounded-2xl border border-amber-100 bg-paper p-6"
              >
                <h2 className="font-display text-2xl text-ink">Admin tools</h2>
                <p className="mt-2 text-sm text-steel">
                  Power users can clear self-exclusions and manage account bans.
                </p>
                {owner ? (
                  <div className="mt-6 border-t border-amber-100 pt-6">
                    <h3 className="text-lg font-semibold text-ink">
                      Super admin access
                    </h3>
                    <p className="mt-2 text-sm text-steel">
                      Grant super admin status to another account. Only the
                      primary admin can add users.
                    </p>
                    {renderSuperAdminRoster(true)}
                    <form className="mt-4 space-y-4" onSubmit={handleAddSuperAdmin}>
                      <label className="block text-sm font-semibold text-ink">
                        User email or username
                        <input
                          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                          type="text"
                          value={superAdminEmail}
                          onChange={(event) => setSuperAdminEmail(event.target.value)}
                          placeholder="teammate@example.com or username"
                        />
                      </label>
                      {superAdminMessage ? (
                        <p className="text-sm text-navy">{superAdminMessage}</p>
                      ) : null}
                      <button
                        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        disabled={superAdminLoading}
                        type="submit"
                      >
                        {superAdminLoading ? "Adding..." : "Add super admin"}
                      </button>
                    </form>
                  </div>
                ) : null}
                {canManageBans ? (
                  <div className="mt-6 border-t border-amber-100 pt-6">
                    <h3 className="text-lg font-semibold text-ink">
                      Ban a user
                    </h3>
                    <p className="mt-2 text-sm text-steel">
                      Suspend access for a specific account. Super admins can clear bans.
                    </p>
                    <form className="mt-4 space-y-4" onSubmit={handleBanUser}>
                      <label className="block text-sm font-semibold text-ink">
                        User email or username
                        <input
                          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                          type="text"
                          value={banEmail}
                          onChange={(event) => setBanEmail(event.target.value)}
                          placeholder="member@example.com or username"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-ink">
                        Ban length
                        <select
                          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                          value={banDuration}
                          onChange={(event) => setBanDuration(event.target.value)}
                        >
                          <option value="1w">1 week</option>
                          <option value="2w">2 weeks</option>
                          <option value="4w">4 weeks</option>
                          <option value="3m">3 months</option>
                          <option value="6m">6 months</option>
                          <option value="9m">9 months</option>
                          <option value="1y">1 year</option>
                          <option value="permanent">Permanent</option>
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-ink">
                        Reason (optional)
                        <textarea
                          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                          rows={3}
                          value={banReason}
                          onChange={(event) => setBanReason(event.target.value)}
                          placeholder="Reason for suspension"
                        />
                      </label>
                      {banMessage ? (
                        <p className="text-sm text-navy">{banMessage}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        <button
                          className="rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                          disabled={banLoading}
                          type="submit"
                        >
                          {banLoading ? "Banning..." : "Ban user"}
                        </button>
                        <button
                          className="rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                          disabled={unbanLoading}
                          type="button"
                          onClick={handleUnbanUser}
                        >
                          {unbanLoading ? "Clearing..." : "Clear ban"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
                <div className="mt-6 border-t border-amber-100 pt-6">
                  <h3 className="text-lg font-semibold text-ink">
                    Self-exclusion
                  </h3>
                  <p className="mt-2 text-sm text-steel">
                    Clear a self-exclusion for a specific account.
                  </p>
                  <form className="mt-4 space-y-4" onSubmit={handleClearExclusion}>
                    <label className="block text-sm font-semibold text-ink">
                      User email or username
                      <input
                        className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                        type="text"
                        value={adminEmail}
                        onChange={(event) => setAdminEmail(event.target.value)}
                        placeholder="friend@example.com or username"
                      />
                    </label>
                    {adminMessage ? (
                      <p className="text-sm text-navy">{adminMessage}</p>
                    ) : null}
                    <button
                      className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                      disabled={adminLoading}
                      type="submit"
                    >
                      {adminLoading ? "Clearing..." : "Clear self-exclusion"}
                    </button>
                  </form>
                </div>
                {superAdmin ? (
                  <div className="mt-6 border-t border-amber-100 pt-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-ink">
                          League oversight
                        </h3>
                        <p className="mt-2 text-sm text-steel">
                          Review every league and manage members.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={loadAdminLeagues}
                        disabled={adminLeaguesLoading}
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {adminLeaguesLoading ? "Refreshing..." : "Refresh leagues"}
                      </button>
                    </div>

                    {adminLeaguesError ? (
                      <p className="mt-3 text-sm text-red-600">{adminLeaguesError}</p>
                    ) : null}
                    {adminActionMessage ? (
                      <p className="mt-3 text-sm text-navy">{adminActionMessage}</p>
                    ) : null}
                    {adminLeaguesLoading ? (
                      <p className="mt-3 text-sm text-steel">Loading leagues...</p>
                    ) : null}

                    {!adminLeaguesLoading && adminLeagues.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4 text-sm text-steel">
                        No leagues found yet.
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {adminLeagues.map((league) => {
                        const isExpanded = expandedLeagueId === league.id;
                        const createdLabel = league.created_at
                          ? new Date(league.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric"
                            })
                          : "Unknown date";
                        return (
                          <div
                            key={league.id}
                            className="rounded-2xl border border-amber-100 bg-white p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-steel">
                                  League
                                </p>
                                <h4 className="mt-1 font-display text-xl text-ink">
                                  {league.name}
                                </h4>
                                <p className="mt-1 text-xs text-steel">
                                  Invite code:{" "}
                                  <span className="font-semibold text-navy">
                                    {league.invite_code}
                                  </span>
                                </p>
                                <p className="mt-1 text-xs text-steel">
                                  {league.member_count} members - Created {createdLabel}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedLeagueId(isExpanded ? null : league.id)
                                  }
                                  className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                                >
                                  {isExpanded ? "Hide members" : "View members"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdminDeleteLeague(league.id, league.name)}
                                  disabled={adminActionLoading[`${league.id}:delete`]}
                                  className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 shadow-sm shadow-navy/10 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  {adminActionLoading[`${league.id}:delete`]
                                    ? "Deleting..."
                                    : "Delete league"}
                                </button>
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="mt-4 border-t border-amber-100 pt-4">
                                {league.members.length === 0 ? (
                                  <p className="text-sm text-steel">No members yet.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {league.members.map((member) => {
                                      const memberActionKey = `${league.id}:${member.id}`;
                                      return (
                                        <div
                                          key={member.id}
                                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-paper px-3 py-2 text-sm"
                                        >
                                          <div className="flex items-center gap-3">
                                            <TeamLogo src={member.team_logo_url} size={36} />
                                            <div>
                                              <p className="font-semibold text-ink">
                                                {member.display_name ?? "Member"}
                                              </p>
                                              <p className="text-xs text-steel">
                                                {member.is_creator
                                                  ? "League creator"
                                                  : "Member"}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            {member.is_creator ? (
                                              <span className="text-xs text-steel">
                                                Creator
                                              </span>
                                            ) : (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleAdminMemberAction(
                                                      league.id,
                                                      member.id,
                                                      "remove"
                                                    )
                                                  }
                                                  disabled={
                                                    adminActionLoading[
                                                      `${memberActionKey}:remove`
                                                    ]
                                                  }
                                                  className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-steel transition hover:border-amber-300 hover:text-ink disabled:cursor-not-allowed disabled:opacity-70"
                                                >
                                                  {adminActionLoading[
                                                    `${memberActionKey}:remove`
                                                  ]
                                                    ? "Removing..."
                                                    : "Remove"}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleAdminMemberAction(
                                                      league.id,
                                                      member.id,
                                                      "ban"
                                                    )
                                                  }
                                                  disabled={
                                                    adminActionLoading[
                                                      `${memberActionKey}:ban`
                                                    ]
                                                  }
                                                  className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 shadow-sm shadow-navy/10 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                                                >
                                                  {adminActionLoading[
                                                    `${memberActionKey}:ban`
                                                  ]
                                                    ? "Banning..."
                                                    : "Ban"}
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {superAdmin ? (
                  <div className="mt-6 border-t border-amber-100 pt-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-ink">
                          Wizyrd chat logs
                        </h3>
                        <p className="mt-2 text-sm text-steel">
                          Review recent Wizyrd prompts across all users.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedPromptCount ? (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                            {selectedPromptCount} selected
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => flagSelectedPromptLogs(true)}
                          disabled={promptLogBulkLoading || !selectedPromptCount}
                          className="rounded-full border border-amber-200 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-steel transition hover:border-navy hover:text-navy disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {promptLogBulkLoading ? "Working..." : "Flag selected"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSelectedPromptLogs(false)}
                          disabled={
                            promptLogBulkLoading ||
                            !selectedPromptCount ||
                            selectedHasFlagged
                          }
                          className={`rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-70 ${
                            selectedHasFlagged
                              ? "border-amber-200 bg-amber-50 text-amber-900"
                              : "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
                          }`}
                        >
                          {promptLogBulkLoading
                            ? "Working..."
                            : selectedHasFlagged
                              ? "Unflag to delete"
                              : "Delete selected"}
                        </button>
                        <button
                          type="button"
                          onClick={loadPromptLogs}
                          disabled={promptLogsLoading || promptLogBulkLoading}
                          className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {promptLogsLoading ? "Refreshing..." : "Refresh logs"}
                        </button>
                      </div>
                    </div>

                    {promptLogsError ? (
                      <p className="mt-3 text-sm text-red-600">{promptLogsError}</p>
                    ) : null}
                    {promptLogsLoading ? (
                      <p className="mt-3 text-sm text-steel">Loading chat logs...</p>
                    ) : null}

                    {!promptLogsLoading && promptLogs.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4 text-sm text-steel">
                        No chat prompts logged yet.
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {promptLogs.map((log) => {
                        const displayLabel =
                          log.display_name ??
                          (log.user_email
                            ? log.user_email.split("@")[0]
                            : "Signed out user");
                        const isUnread = !log.read_at;
                        const isUpdating =
                          Boolean(promptLogActionLoading[log.id]) || promptLogBulkLoading;
                        const isDeleting = Boolean(
                          promptLogActionLoading[`delete:${log.id}`]
                        );
                        const isDeletingNow = Boolean(
                          promptLogActionLoading[`delete-now:${log.id}`]
                        );
                        const isRestoring = Boolean(
                          promptLogActionLoading[`restore:${log.id}`]
                        );
                        const isFlagging = Boolean(
                          promptLogActionLoading[`flag:${log.id}`]
                        );
                        const isDeleted = Boolean(log.deleted_at);
                        const undoRemainingMs = getUndoRemainingMs(log.deleted_at);
                        const canUndo = isDeleted && undoRemainingMs > 0;
                        const isFlagged = Boolean(log.flagged);
                        const isSelected = selectedPromptLogs.has(log.id);
                        return (
                          <div
                            key={log.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (isUnread && !isUpdating && !isDeleted) {
                                markPromptLogRead(log.id);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                if (isUnread && !isUpdating && !isDeleted) {
                                  markPromptLogRead(log.id);
                                }
                              }
                            }}
                            className={`w-full rounded-2xl border p-3 text-left transition ${
                              isUnread
                                ? "border-amber-200 bg-amber-50/60 hover:bg-amber-50"
                                : "border-amber-100 bg-white"
                            } ${
                              isDeleted ? "opacity-70" : ""
                            } ${isUpdating ? "cursor-wait opacity-70" : "cursor-pointer"}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-steel">
                              <span className="flex items-center gap-2 uppercase tracking-[0.18em]">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={isDeleted || isUpdating}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => togglePromptLogSelection(log.id)}
                                  className="h-3.5 w-3.5 rounded border border-amber-200 text-navy focus:ring-navy/40"
                                  aria-label="Select chat log"
                                />
                                Prompt
                              </span>
                              <span className="flex items-center gap-2">
                                {isUnread ? (
                                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-900">
                                    Unread
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-steel">
                                    Read
                                  </span>
                                )}
                                {isFlagged ? (
                                  <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-navy">
                                    Flagged
                                  </span>
                                ) : null}
                                {isDeleted ? (
                                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-red-700">
                                    Deleted
                                  </span>
                                ) : null}
                                {formatLogTime(log.created_at)}
                                {!isDeleted ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (!isDeleting && !isFlagged && !promptLogBulkLoading) {
                                          deletePromptLog(log.id, { isFlagged });
                                        }
                                      }}
                                      disabled={isDeleting || isFlagged || promptLogBulkLoading}
                                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                        isFlagged
                                          ? "border-amber-200 bg-amber-50 text-amber-900"
                                          : "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
                                      }`}
                                    >
                                      {isDeleting
                                        ? "Deleting..."
                                        : isFlagged
                                          ? "Unflag to delete"
                                          : "Delete"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (
                                          !isDeletingNow &&
                                          !isFlagged &&
                                          !promptLogBulkLoading
                                        ) {
                                          deletePromptLog(log.id, {
                                            isFlagged,
                                            force: true
                                          });
                                        }
                                      }}
                                      disabled={
                                        isDeletingNow || isFlagged || promptLogBulkLoading
                                      }
                                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                        isFlagged
                                          ? "border-amber-200 bg-amber-50 text-amber-900"
                                          : "border-red-300 bg-red-100 text-red-800 hover:border-red-400 hover:bg-red-200"
                                      }`}
                                    >
                                      {isDeletingNow
                                        ? "Deleting..."
                                        : isFlagged
                                          ? "Unflag to delete"
                                          : "Delete now"}
                                    </button>
                                  </>
                                ) : canUndo ? (
                                  <button
                                    type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (!isRestoring && !promptLogBulkLoading) {
                                          restorePromptLog(log.id);
                                        }
                                      }}
                                      disabled={isRestoring || promptLogBulkLoading}
                                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-900 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                    {isRestoring
                                      ? "Restoring..."
                                      : `Undo (${formatUndoRemaining(undoRemainingMs)})`}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!isFlagging && !promptLogBulkLoading) {
                                      togglePromptLogFlag(log.id, !isFlagged);
                                    }
                                  }}
                                  disabled={isFlagging || promptLogBulkLoading}
                                  className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] transition disabled:cursor-not-allowed disabled:opacity-70 ${
                                    isFlagged
                                      ? "border-navy/30 bg-navy/10 text-navy"
                                      : "border-amber-200 bg-white text-steel hover:border-navy hover:text-navy"
                                  }`}
                                >
                                  {isFlagging ? "Saving..." : isFlagged ? "Unflag" : "Flag"}
                                </button>
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-ink">{log.prompt}</p>
                            {log.response ? (
                              <p className="mt-2 text-xs text-steel">
                                Response: {log.response}
                              </p>
                            ) : null}
                            <div className="mt-3 text-xs text-steel">
                              <p className="font-semibold text-ink">{displayLabel}</p>
                              <p className="mt-1 text-[11px] text-steel">
                                {log.user_email ?? "Email unavailable"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        ) : null}
      </AuthGuard>
    </main>
  );
}
