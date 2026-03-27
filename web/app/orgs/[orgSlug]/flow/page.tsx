import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/app-sidebar";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function FlowPage({ params }: Props) {
  const { orgSlug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="h-screen flex bg-neutral-50">
      <AppSidebar orgSlug={orgSlug} activeTab="flow" />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="mb-8">
            <h1 className="text-base font-semibold text-neutral-900">Flow</h1>
            <p className="text-xs text-neutral-400 mt-0.5">Team throughput and review health</p>
          </div>

          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="h-10 w-10 rounded-full bg-neutral-100 flex items-center justify-center mb-4">
              <svg className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-neutral-600">Coming soon</p>
            <p className="text-xs text-neutral-400 mt-1">Flow metrics are on the way.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
