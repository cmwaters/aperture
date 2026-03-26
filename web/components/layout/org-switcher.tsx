"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { Organization, Repository } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface Props {
  currentOrgSlug: string;
}

export function OrgSwitcher({ currentOrgSlug }: Props) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  // Load token + orgs on mount
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      try {
        const { orgs: all } = await apiFetch<{ orgs: Organization[] }>("/api/v1/me/orgs", session.access_token);
        setOrgs(all ?? []);
        setCurrentOrg(all?.find((o) => o.slug === currentOrgSlug) ?? null);
      } catch {}
    }
    init();
  }, [currentOrgSlug]);

  // Load repos when panel opens
  useEffect(() => {
    if (!open || !token) return;
    setLoadingRepos(true);
    apiFetch<{ repos: Repository[] }>(`/api/v1/orgs/${currentOrgSlug}/repos`, token)
      .then(({ repos }) => setRepos(repos ?? []))
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [open, currentOrgSlug, token]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const toggleRepo = useCallback(async (repo: Repository) => {
    if (!token || toggling) return;
    setToggling(repo.id);
    const newActive = !repo.is_active;
    setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, is_active: newActive } : r)));
    try {
      const res = await fetch(`${API_URL}/api/v1/orgs/${currentOrgSlug}/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: newActive }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, is_active: repo.is_active } : r)));
    }
    setToggling(null);
  }, [token, toggling, currentOrgSlug]);

  const appName = process.env.NEXT_PUBLIC_GITHUB_APP_NAME;

  const avatarLetter = (currentOrg?.name ?? currentOrgSlug)[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 transition-colors"
      >
        {currentOrg?.avatar_url ? (
          <img
            src={currentOrg.avatar_url}
            alt={currentOrg.name}
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-neutral-200 flex items-center justify-center">
            <span className="text-xs font-semibold text-neutral-600">{avatarLetter}</span>
          </div>
        )}
        <span className="text-sm font-medium text-neutral-900">
          {currentOrg?.name ?? currentOrgSlug}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl border border-neutral-200 shadow-lg z-50 overflow-hidden">

          {/* Orgs */}
          <div className="p-2">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Organizations
            </p>
            {orgs.map((org) => {
              const letter = org.name[0]?.toUpperCase() ?? "?";
              const isCurrent = org.slug === currentOrgSlug;
              return (
                <button
                  key={org.id}
                  onClick={() => { router.push(`/orgs/${org.slug}`); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                    isCurrent ? "bg-neutral-100" : "hover:bg-neutral-50"
                  }`}
                >
                  {org.avatar_url ? (
                    <img src={org.avatar_url} alt={org.name} className="h-6 w-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-neutral-200 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-neutral-600">{letter}</span>
                    </div>
                  )}
                  <span className="text-sm font-medium text-neutral-900 truncate flex-1">{org.name}</span>
                  {isCurrent && (
                    <svg className="h-4 w-4 text-neutral-900 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 11.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                    </svg>
                  )}
                </button>
              );
            })}
            {appName && (
              <a
                href={`https://github.com/apps/${appName}/installations/new`}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-neutral-50 transition-colors"
              >
                <div className="h-6 w-6 rounded-full border-2 border-dashed border-neutral-300 flex items-center justify-center shrink-0">
                  <svg className="h-3 w-3 text-neutral-400" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
                  </svg>
                </div>
                <span className="text-sm text-neutral-500">Add organization</span>
              </a>
            )}
          </div>

          <div className="border-t border-neutral-100" />

          {/* Repositories / Settings */}
          <div className="p-2">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Repositories
            </p>
            {loadingRepos ? (
              <p className="px-2 py-3 text-sm text-neutral-400">Loading…</p>
            ) : repos.length === 0 ? (
              <p className="px-2 py-3 text-sm text-neutral-400">No repositories connected.</p>
            ) : (
              <ul className="space-y-0.5">
                {repos.map((repo) => (
                  <li key={repo.id} className="flex items-center justify-between px-2 py-2 rounded-lg">
                    <span className="text-sm text-neutral-700 truncate mr-3">{repo.full_name}</span>
                    <button
                      onClick={() => toggleRepo(repo)}
                      disabled={toggling === repo.id}
                      role="switch"
                      aria-checked={repo.is_active}
                      className={`relative shrink-0 h-5 w-9 rounded-full transition-colors focus:outline-none ${
                        repo.is_active ? "bg-neutral-900" : "bg-neutral-200"
                      } ${toggling === repo.id ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          repo.is_active ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="px-2 pt-1 pb-0.5 text-[11px] text-neutral-400">
              Disabled repos are excluded from the queue.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
