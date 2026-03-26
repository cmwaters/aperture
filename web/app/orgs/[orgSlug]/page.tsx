import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { QueueResponse } from "@/lib/types";
import { AppHeader } from "@/components/layout/app-header";
import { ReviewQueuePanel } from "@/components/queue/queue-panel";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function FlowPage({ params }: Props) {
  const { orgSlug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) redirect("/login");

  let queue: QueueResponse = { items: [], total: 0 };
  try {
    queue = await apiFetch<QueueResponse>(`/api/v1/orgs/${orgSlug}/queue`, token);
  } catch (err) {
    console.error("Failed to load queue:", err);
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <AppHeader orgSlug={orgSlug} activeTab="flow" />
      <div className="flex flex-1 min-h-0">
        {/* Flow */}
        <main className="flex-1 overflow-y-auto px-10 py-10">
          <h1 className="text-xl font-semibold text-neutral-900">Flow</h1>
          <p className="text-sm text-neutral-400 mt-1">Coming soon.</p>
        </main>

        {/* Review Queue panel */}
        <ReviewQueuePanel items={queue.items} total={queue.total} orgSlug={orgSlug} />
      </div>
    </div>
  );
}
