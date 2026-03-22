-- ============================================================
-- Aperture — Initial Schema
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- Teams
-- ============================================================
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Users (mirrors auth.users, extended with display info)
-- ============================================================
create table users (
  id            uuid primary key, -- matches auth.users.id
  email         text not null,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

-- Auto-create a users row when a new auth user is created
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_auth_user();

-- ============================================================
-- Team Members
-- ============================================================
create table team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  unique (team_id, user_id)
);

-- ============================================================
-- GitHub App Installations
-- ============================================================
create table github_installations (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references teams(id) on delete cascade,
  installation_id   bigint not null unique,
  account_login     text not null,
  account_type      text not null check (account_type in ('Organization', 'User')),
  account_avatar_url text,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- Repositories
-- ============================================================
create table repositories (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references teams(id) on delete cascade,
  installation_id   uuid not null references github_installations(id) on delete cascade,
  github_repo_id    bigint not null,
  full_name         text not null,   -- e.g. "acme/backend"
  default_branch    text not null default 'main',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (team_id, github_repo_id)
);

-- ============================================================
-- Pull Requests
-- ============================================================
create table pull_requests (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references teams(id) on delete cascade,
  repo_id               uuid not null references repositories(id) on delete cascade,
  github_pr_id          bigint not null,
  number                int not null,
  title                 text not null,
  body                  text,
  author_github_login   text not null,
  author_avatar_url     text,
  base_branch           text not null,
  head_branch           text not null,
  state                 text not null check (state in ('open', 'closed', 'merged')),
  draft                 boolean not null default false,
  additions             int not null default 0,
  deletions             int not null default 0,
  changed_files         int not null default 0,
  html_url              text not null,
  opened_at             timestamptz not null,
  closed_at             timestamptz,
  merged_at             timestamptz,
  last_activity_at      timestamptz,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (repo_id, github_pr_id)
);

-- ============================================================
-- PR Analyses (AI-generated)
-- ============================================================
create table pr_analyses (
  id                uuid primary key default gen_random_uuid(),
  pull_request_id   uuid not null references pull_requests(id) on delete cascade,
  commit_sha        text not null,
  summary           text,
  why               text,
  impacted_areas    text[] not null default '{}',
  key_files         text[] not null default '{}',
  size_label        text check (size_label in ('small', 'medium', 'large')),
  risk_score        int check (risk_score between 1 and 10),
  risk_label        text check (risk_label in ('low', 'medium', 'high')),
  risk_reasons      text[] not null default '{}',
  semantic_groups   jsonb,
  ai_provider       text,
  ai_model          text,
  generated_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- PR Reviews (synced from GitHub)
-- ============================================================
create table pr_reviews (
  id                uuid primary key default gen_random_uuid(),
  pull_request_id   uuid not null references pull_requests(id) on delete cascade,
  github_review_id  bigint not null unique,
  reviewer_login    text not null,
  reviewer_avatar_url text,
  state             text not null check (state in ('approved', 'changes_requested', 'commented', 'dismissed')),
  submitted_at      timestamptz not null
);

-- ============================================================
-- Team Preferences
-- ============================================================
create table team_preferences (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references teams(id) on delete cascade unique,
  pr_size_small_max     int not null default 100,
  pr_size_medium_max    int not null default 400,
  stale_after_hours     int not null default 48,
  risk_sensitivity      text not null default 'medium' check (risk_sensitivity in ('low', 'medium', 'high')),
  ai_provider           text not null default 'anthropic' check (ai_provider in ('anthropic', 'openai')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================
create index on pull_requests (team_id, state);
create index on pull_requests (repo_id, state);
create index on pull_requests (last_activity_at desc);
create index on pr_analyses (pull_request_id);
create index on pr_reviews (pull_request_id);
create index on team_members (user_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table teams enable row level security;
alter table users enable row level security;
alter table team_members enable row level security;
alter table github_installations enable row level security;
alter table repositories enable row level security;
alter table pull_requests enable row level security;
alter table pr_analyses enable row level security;
alter table pr_reviews enable row level security;
alter table team_preferences enable row level security;

-- Helper: is the current auth user a member of a given team?
create or replace function is_team_member(team_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from team_members
    where team_members.team_id = $1
      and team_members.user_id = auth.uid()
  );
$$;

-- Teams: members can read their own team
create policy "team members can read their team"
  on teams for select using (is_team_member(id));

-- Teams: any authenticated user can create a team
create policy "authenticated users can create teams"
  on teams for insert with check (auth.uid() is not null);

-- Team members: members can read their own membership rows
create policy "team members can read memberships"
  on team_members for select using (is_team_member(team_id));

-- Team members: owners can insert (invite)
create policy "team owners can insert memberships"
  on team_members for insert with check (
    auth.uid() = user_id -- allow self-join on team creation
    or exists (
      select 1 from team_members tm
      where tm.team_id = team_id and tm.user_id = auth.uid() and tm.role = 'owner'
    )
  );

-- Users: users can read their own profile
create policy "users can read own profile"
  on users for select using (id = auth.uid());

-- Users: users can update their own profile
create policy "users can update own profile"
  on users for update using (id = auth.uid());

-- Resource tables: team members can read
create policy "team members can read github_installations"
  on github_installations for select using (is_team_member(team_id));
create policy "team members can insert github_installations"
  on github_installations for insert with check (is_team_member(team_id));

create policy "team members can read repositories"
  on repositories for select using (is_team_member(team_id));
create policy "team members can insert repositories"
  on repositories for insert with check (is_team_member(team_id));
create policy "team members can update repositories"
  on repositories for update using (is_team_member(team_id));

create policy "team members can read pull_requests"
  on pull_requests for select using (is_team_member(team_id));

create policy "team members can read pr_analyses"
  on pr_analyses for select using (
    exists (
      select 1 from pull_requests pr
      where pr.id = pull_request_id and is_team_member(pr.team_id)
    )
  );

create policy "team members can read pr_reviews"
  on pr_reviews for select using (
    exists (
      select 1 from pull_requests pr
      where pr.id = pull_request_id and is_team_member(pr.team_id)
    )
  );

create policy "team members can read team_preferences"
  on team_preferences for select using (is_team_member(team_id));
create policy "team members can upsert team_preferences"
  on team_preferences for insert with check (is_team_member(team_id));
create policy "team members can update team_preferences"
  on team_preferences for update using (is_team_member(team_id));
