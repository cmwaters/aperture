"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { Organization } from "@/lib/types";

interface Props {
  currentOrgSlug: string;
}

export function OrgSwitcher({ currentOrgSlug }: Props) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const { orgs } = await apiFetch<{ orgs: Organization[] }>("/api/v1/me/orgs", session.access_token);
        setOrgs(orgs ?? []);
      } catch {}
    }
    init();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const current = orgs.find((o) => o.slug === currentOrgSlug);
  const name = current?.name ?? currentOrgSlug;
  const others = orgs.filter((o) => o.slug !== currentOrgSlug);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100 transition-colors text-left"
      >
        <OrgAvatar org={current} name={name} size={6} />
        <span className="flex-1 text-sm font-medium text-neutral-900 truncate">{name}</span>
        <svg className="h-3.5 w-3.5 text-neutral-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5.22 10.22a.75.75 0 0 0 1.06 1.06l2.25-2.25 2.25 2.25a.75.75 0 1 0 1.06-1.06l-2.78-2.78a.75.75 0 0 0-1.06 0L5.22 10.22Z" />
          <path d="M5.22 5.78a.75.75 0 0 1 1.06-1.06l2.25 2.25 2.25-2.25a.75.75 0 1 1 1.06 1.06L8.78 8.56a.75.75 0 0 1-1.06 0L5.22 5.78Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-xl border border-neutral-200 shadow-lg overflow-hidden z-50">
          {/* Other orgs to switch to */}
          {others.length > 0 && (
            <div className="py-1">
              {others.map((org) => (
                <button
                  key={org.id}
                  onClick={() => { router.push(`/orgs/${org.slug}`); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 transition-colors text-left"
                >
                  <OrgAvatar org={org} name={org.name} size={5} />
                  <span className="text-sm text-neutral-700 truncate">{org.name}</span>
                </button>
              ))}
              <div className="border-t border-neutral-100 my-1" />
            </div>
          )}

          {/* Settings for current org */}
          <div className="py-1">
            <Link
              href={`/orgs/${currentOrgSlug}/settings`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 transition-colors text-sm text-neutral-500"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgAvatar({ org, name, size }: { org?: Organization | null; name: string; size: number }) {
  const cls = `h-${size} w-${size} rounded-full shrink-0`;
  if (org?.avatar_url) {
    return <img src={org.avatar_url} alt={name} className={`${cls} object-cover`} />;
  }
  return (
    <div className={`${cls} bg-neutral-200 flex items-center justify-center`}>
      <span className="text-[10px] font-semibold text-neutral-600">{name[0]?.toUpperCase() ?? "?"}</span>
    </div>
  );
}
