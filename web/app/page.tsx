import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "@/lib/api";
import { Team } from "@/lib/types";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;

  if (!token) {
    redirect("/login");
  }

  try {
    const { teams } = await apiFetch<{ teams: Team[] }>(
      "/api/v1/me/teams",
      token
    );

    if (teams.length === 0) {
      redirect("/onboarding");
    }

    redirect(`/${teams[0].slug}`);
  } catch {
    redirect("/onboarding");
  }
}
