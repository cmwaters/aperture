"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { Team } from "@/lib/types";
import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;

    setLoading(true);
    setError("");

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      router.push("/login");
      return;
    }

    try {
      const team = await apiFetch<Team>("/api/v1/teams", token, {
        method: "POST",
        body: JSON.stringify({ name: teamName.trim() }),
      });

      // Redirect to GitHub App installation
      const appName = process.env.NEXT_PUBLIC_GITHUB_APP_NAME;
      const installUrl = `https://github.com/apps/${appName}/installations/new?state=${team.id}`;
      window.location.href = installUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create team. Please try again."
      );
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm px-6">
        <div className="mb-12 flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-neutral-900" />
          <span className="text-lg font-semibold tracking-tight">Aperture</span>
        </div>

        <div className="mb-8">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-widest mb-2">
            Step 1 of 2
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-2">
            Name your team
          </h1>
          <p className="text-sm text-neutral-500">
            This is usually your company or org name.
          </p>
        </div>

        <form onSubmit={handleCreateTeam} className="space-y-4">
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. Acme Engineering"
            autoFocus
            className="w-full h-11 px-4 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition"
          />

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !teamName.trim()}
            className="w-full h-11 bg-neutral-900 hover:bg-neutral-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating…
              </span>
            ) : (
              "Continue"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
