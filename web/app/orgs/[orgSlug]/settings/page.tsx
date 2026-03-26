"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/layout/app-header";
import { Organization, Repository } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const GITHUB_APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME;

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;

  const [token, setToken] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const currentOrg = orgs.find((o) => o.slug === orgSlug);
  const currentAccountType = currentOrg?.github_account_type ?? null;

  // Load token + all orgs
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      try {
        const res = await fetch(`${API_URL}/api/v1/me/orgs`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setOrgs(data.orgs ?? []);
        }
      } catch {}
    }
    init();
  }, []);

  // Load repos for current org
  useEffect(() => {
    if (!token) return;
    setLoadingRepos(true);
    fetch(`${API_URL}/api/v1/orgs/${orgSlug}/repos`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.ok ? res.json() : { repos: [] })
      .then((data) => setRepos(data.repos ?? []))
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [orgSlug, token]);

  const toggleRepo = useCallback(async (repo: Repository) => {
    if (!token || toggling) return;
    setToggling(repo.id);
    const newActive = !repo.is_active;
    setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, is_active: newActive } : r)));
    try {
      const res = await fetch(`${API_URL}/api/v1/orgs/${orgSlug}/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: newActive }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRepos((prev) => prev.map((r) => (r.id === repo.id ? { ...r, is_active: repo.is_active } : r)));
    }
    setToggling(null);
  }, [token, toggling, orgSlug]);

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader orgSlug={orgSlug} />

      {/* Org switcher bar */}
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-2">
        <div className="flex items-center gap-1 flex-wrap">
          {orgs.map((org) => {
            const isActive = org.slug === orgSlug;
            const letter = org.name[0]?.toUpperCase() ?? "?";
            const isUser = org.github_account_type === "User";
            return (
              <button
                key={org.id}
                onClick={() => router.push(`/orgs/${org.slug}/settings`)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white shadow-sm border border-neutral-200 text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100"
                }`}
              >
                {org.avatar_url ? (
                  <div className="relative">
                    <img src={org.avatar_url} alt={org.name} className="h-5 w-5 rounded-full object-cover" />
                    {isUser && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-neutral-400 border border-neutral-50 flex items-center justify-center">
                        <svg className="h-1.5 w-1.5 text-white" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 6a5 5 0 0 1 10 0H3Z" />
                        </svg>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="h-5 w-5 rounded-full bg-neutral-200 flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-neutral-600">{letter}</span>
                  </div>
                )}
                {org.name}
              </button>
            );
          })}
          {GITHUB_APP_NAME && (
            <a
              href={`https://github.com/apps/${GITHUB_APP_NAME}/installations/new`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
              </svg>
              Add org
            </a>
          )}
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-6">
        {currentAccountType === "User" ? (
          /* User settings */
          <section>
            <h2 className="text-sm font-semibold text-neutral-500 mb-3 uppercase tracking-wide">
              User Settings
            </h2>
            <div className="rounded-xl border border-neutral-200 bg-white px-5 py-8 text-center">
              <p className="text-sm text-neutral-400">User-specific settings coming soon.</p>
            </div>
          </section>
        ) : (
          /* Org settings — repositories */
          <section>
            <h2 className="text-sm font-semibold text-neutral-500 mb-3 uppercase tracking-wide">
              Repositories
            </h2>
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              {loadingRepos ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-neutral-400">Loading repositories…</p>
                </div>
              ) : repos.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-neutral-400">No repositories connected.</p>
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {repos.map((repo) => (
                    <li key={repo.id} className="flex items-center justify-between px-5 py-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900 truncate">{repo.full_name}</p>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          Default branch: <span className="font-mono">{repo.default_branch}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => toggleRepo(repo)}
                        disabled={toggling === repo.id}
                        role="switch"
                        aria-checked={repo.is_active}
                        className={`relative ml-4 shrink-0 h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 ${
                          repo.is_active ? "bg-neutral-900" : "bg-neutral-200"
                        } ${toggling === repo.id ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                            repo.is_active ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-2">
              Disabled repositories are excluded from the queue and won&apos;t receive analysis.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
