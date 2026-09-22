-- Initial schema for @scape (plan.md §7).
-- Client (supabase-js) may only read profiles and edit its own profile.
-- player_stats, matches and match_players are written exclusively by the game server,
-- which connects with a privileged role that bypasses RLS; no client policies are defined for them.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 24),
  glyph char(1) not null default '@',
  color text not null default '#ffffff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  matches int not null default 0,
  wins int not null default 0,
  score bigint not null default 0,
  last_room text,
  last_x real,
  last_y real,
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  map_id text,
  started_at timestamptz,
  ended_at timestamptz,
  winner text check (winner in ('monster', 'survivors')),
  result jsonb
);

create table public.match_players (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null, -- null for bots
  is_bot boolean not null default false,
  role text check (role in ('monster', 'survivor')),
  escaped boolean,
  caught boolean,
  generators_repaired int not null default 0,
  hits int not null default 0,
  downs int not null default 0,
  score int not null default 0,
  check (is_bot or user_id is not null)
);

create index match_players_match_id_idx on public.match_players (match_id);
create index match_players_user_id_idx on public.match_players (user_id);

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
