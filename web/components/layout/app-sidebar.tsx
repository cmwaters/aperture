"use client";

import Link from "next/link";
import { OrgSwitcher } from "./org-switcher";

interface Props {
  orgSlug: string;
  activeTab: "queue" | "flow" | "settings";
}

export function AppSidebar({ orgSlug, activeTab }: Props) {
  return (
    <aside className="w-48 shrink-0 border-r border-neutral-100 bg-white flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 h-14 flex items-center gap-2 border-b border-neutral-100">
        <div className="h-4 w-4 rounded-full bg-neutral-900" />
        <span className="text-sm font-semibold tracking-tight">aperture</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        <NavItem
          href={`/orgs/${orgSlug}`}
          active={activeTab === "queue"}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h4.5" />
            </svg>
          }
        >
          Queue
        </NavItem>
        <NavItem
          href={`/orgs/${orgSlug}/flow`}
          active={activeTab === "flow"}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          }
        >
          Flow
        </NavItem>
      </nav>

      {/* Org switcher — also the entry point to settings */}
      <div className="px-2 py-3 border-t border-neutral-100">
        <OrgSwitcher currentOrgSlug={orgSlug} />
      </div>
    </aside>
  );
}

function NavItem({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-neutral-100 text-neutral-900"
          : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}
