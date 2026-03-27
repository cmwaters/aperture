import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { QueueItem, QueueResponse } from "@/lib/types";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { QueueItemRow } from "@/components/queue/queue-item-row";
import { RefreshButton } from "@/components/queue/refresh-button";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function QueuePage({ params }: Props) {
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

  const authorItems   = (queue.items ?? []).filter((i) => i.action_bucket === "author");
  const reviewerItems = (queue.items ?? []).filter((i) => i.action_bucket === "reviewer");

  return (
    <div className="h-screen flex bg-neutral-50">
      <AppSidebar orgSlug={orgSlug} activeTab="queue" />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Title row */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-base font-semibold text-neutral-900">Review Queue</h1>
              {queue.total > 0 && (
                <p className="text-xs text-neutral-400 mt-0.5">{queue.total} open</p>
              )}
            </div>
            <RefreshButton />
          </div>

          {(queue.items ?? []).length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-8">
              {authorItems.length > 0 && (
                <Section title="Your action" items={authorItems} orgSlug={orgSlug} />
              )}
              {reviewerItems.length > 0 && (
                <Section title="Review needed" items={reviewerItems} orgSlug={orgSlug} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({ title, items, orgSlug }: { title: string; items: QueueItem[]; orgSlug: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">
        {items.map((item) => (
          <QueueItemRow key={item.id} item={item} teamSlug={orgSlug} />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="h-10 w-10 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
        <svg className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-neutral-600">All caught up</p>
      <p className="text-xs text-neutral-400 mt-1">No open pull requests need your attention.</p>
    </div>
  );
}
