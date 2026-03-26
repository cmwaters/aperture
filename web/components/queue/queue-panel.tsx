import Link from "next/link";
import { QueueItem } from "@/lib/types";
import { RefreshButton } from "./refresh-button";

interface Props {
  items: QueueItem[];
  total: number;
  orgSlug: string;
}

export function ReviewQueuePanel({ items, total, orgSlug }: Props) {
  return (
    <aside className="w-80 shrink-0 border-l border-neutral-100 bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Review Queue</h2>
          {total > 0 && (
            <p className="text-xs text-neutral-400 mt-0.5">{total} open</p>
          )}
        </div>
        <RefreshButton />
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
            <div className="h-8 w-8 rounded-full bg-neutral-100 flex items-center justify-center mb-3">
              <svg className="h-4 w-4 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-xs font-medium text-neutral-500">All caught up</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">No open PRs need attention.</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {items.map((item) => (
              <PanelItem key={item.id} item={item} orgSlug={orgSlug} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

const STATE_CONFIG: Record<string, { label: string; className: string }> = {
  needs_review: { label: "Review", className: "text-blue-600 bg-blue-50" },
  needs_author: { label: "Author", className: "text-amber-600 bg-amber-50" },
  stalled:      { label: "Stalled", className: "text-red-600 bg-red-50" },
  draft:        { label: "Draft",   className: "text-neutral-500 bg-neutral-100" },
};

function PanelItem({ item, orgSlug }: { item: QueueItem; orgSlug: string }) {
  const state = STATE_CONFIG[item.review_state] ?? STATE_CONFIG.needs_review;
  const wait = formatWait(item.waiting_hours);

  return (
    <Link
      href={`/orgs/${orgSlug}/pr/${item.id}`}
      className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors"
    >
      <img
        src={item.author_avatar_url}
        alt={item.author_github_login}
        className="h-5 w-5 rounded-full mt-0.5 shrink-0 bg-neutral-100"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-neutral-900 truncate leading-snug">{item.title}</p>
        <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
          {item.repo_full_name} · #{item.number}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${state.className}`}>
          {state.label}
        </span>
        <span className="text-[10px] text-neutral-400">{wait}</span>
      </div>
    </Link>
  );
}

function formatWait(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
