-- ============================================================
-- Fantasy IPL 2026 — Full Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users can view all profiles" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- LEAGUES
-- ============================================================
create table public.leagues (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique not null,
  commissioner_id uuid references public.profiles(id),
  season int not null default 2026,
  created_at timestamptz default now()
);
alter table public.leagues enable row level security;
create policy "Anyone can view leagues" on public.leagues for select using (true);
create policy "Commissioner can update league" on public.leagues for update using (auth.uid() = commissioner_id);

-- ============================================================
-- TEAMS
-- ============================================================
create table public.teams (
  id uuid default uuid_generate_v4() primary key,
  league_id uuid references public.leagues(id) on delete cascade,
  manager_id uuid references public.profiles(id),
  name text not null,
  manager_name text not null,
  budget_remaining int not null default 0,
  created_at timestamptz default now(),
  unique(league_id, manager_id)
);
alter table public.teams enable row level security;
create policy "Anyone can view teams" on public.teams for select using (true);
create policy "Manager can update own team" on public.teams for update using (auth.uid() = manager_id);

-- ============================================================
-- PLAYERS (master list)
-- ============================================================
create table public.players (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  ipl_team text not null,
  role text not null check (role in ('BAT','BOWL','AR','WK')),
  created_at timestamptz default now()
);
alter table public.players enable row level security;
create policy "Anyone can view players" on public.players for select using (true);

-- ============================================================
-- SQUADS (team ↔ player assignments, week-aware)
-- ============================================================
create table public.squads (
  id uuid default uuid_generate_v4() primary key,
  team_id uuid references public.teams(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  effective_from_week int not null default 1,
  effective_to_week int,  -- null = still active
  created_at timestamptz default now()
);
alter table public.squads enable row level security;
create policy "Anyone can view squads" on public.squads for select using (true);
create policy "Commissioner can manage squads" on public.squads for all
  using (exists (
    select 1 from public.teams t
    join public.leagues l on t.league_id = l.id
    where t.id = squads.team_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- MATCHES (schedule)
-- ============================================================
create table public.matches (
  id text primary key,  -- e.g. 'm1', 'm2' matching existing IDs
  league_id uuid references public.leagues(id) on delete cascade,
  week int not null,
  match_num int not null,
  home_team text not null,
  away_team text not null,
  date text not null,
  venue text not null,
  scored boolean not null default false,
  result text,
  match_sr numeric,
  match_er numeric,
  created_at timestamptz default now()
);
alter table public.matches enable row level security;
create policy "Anyone can view matches" on public.matches for select using (true);
create policy "Commissioner can update matches" on public.matches for update
  using (exists (
    select 1 from public.leagues l
    where l.id = matches.league_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- PLAYER POINTS (per match)
-- ============================================================
create table public.player_points (
  id uuid default uuid_generate_v4() primary key,
  match_id text references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  total numeric not null default 0,
  bat_base numeric,
  bat_final numeric,
  bat_sr numeric,
  bowl_base numeric,
  bowl_final numeric,
  bowl_er numeric,
  field_pts int,
  created_at timestamptz default now(),
  unique(match_id, player_id)
);
alter table public.player_points enable row level security;
create policy "Anyone can view points" on public.player_points for select using (true);
create policy "Commissioner can manage points" on public.player_points for all
  using (exists (
    select 1 from public.matches m
    join public.leagues l on m.league_id = l.id
    where m.id = player_points.match_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- TRANSFERS
-- ============================================================
create table public.transfers (
  id uuid default uuid_generate_v4() primary key,
  league_id uuid references public.leagues(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  player_out_id uuid references public.players(id),
  player_in_id uuid references public.players(id),
  cost_cr int not null default 0,
  effective_week int not null default 2,
  note text,
  created_at timestamptz default now()
);
alter table public.transfers enable row level security;
create policy "Anyone can view transfers" on public.transfers for select using (true);
create policy "Commissioner can manage transfers" on public.transfers for all
  using (exists (
    select 1 from public.leagues l
    where l.id = transfers.league_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- WAIVER BIDS
-- ============================================================
create table public.waiver_bids (
  id uuid default uuid_generate_v4() primary key,
  league_id uuid references public.leagues(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  player_in_id uuid references public.players(id),
  drop_player_id uuid references public.players(id),
  amount int not null default 1,
  week int not null,
  placed_at timestamptz default now(),
  last_bid_at timestamptz default now(),
  status text not null default 'active' check (status in ('active','resolved','cancelled','outbid')),
  resolved_at timestamptz
);
alter table public.waiver_bids enable row level security;
create policy "Anyone can view waiver bids" on public.waiver_bids for select using (true);
create policy "Managers can place bids for own team" on public.waiver_bids for insert
  using (exists (select 1 from public.teams where id = waiver_bids.team_id and manager_id = auth.uid()));
create policy "Commissioner can manage all bids" on public.waiver_bids for all
  using (exists (
    select 1 from public.leagues l
    where l.id = waiver_bids.league_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- WAIVER BID HISTORY
-- ============================================================
create table public.waiver_bid_history (
  id uuid default uuid_generate_v4() primary key,
  bid_id uuid references public.waiver_bids(id) on delete cascade,
  team_id uuid references public.teams(id),
  amount int not null,
  created_at timestamptz default now()
);
alter table public.waiver_bid_history enable row level security;
create policy "Anyone can view bid history" on public.waiver_bid_history for select using (true);

-- ============================================================
-- BUDGET BOOSTS
-- ============================================================
create table public.budget_boosts (
  id uuid default uuid_generate_v4() primary key,
  league_id uuid references public.leagues(id) on delete cascade,
  week int not null,
  amount int not null default 15,
  applied_at timestamptz default now(),
  unique(league_id, week)
);
alter table public.budget_boosts enable row level security;
create policy "Anyone can view boosts" on public.budget_boosts for select using (true);
create policy "Commissioner can manage boosts" on public.budget_boosts for all
  using (exists (
    select 1 from public.leagues l
    where l.id = budget_boosts.league_id and l.commissioner_id = auth.uid()
  ));

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Team total points view
create or replace view public.team_points as
select
  t.id as team_id,
  t.league_id,
  t.name as team_name,
  t.manager_name,
  coalesce(sum(pp.total), 0) as total_points
from public.teams t
left join public.squads s on s.team_id = t.id
left join public.player_points pp on pp.player_id = s.player_id
left join public.matches m on m.id = pp.match_id
  and m.week >= s.effective_from_week
  and (s.effective_to_week is null or m.week <= s.effective_to_week)
group by t.id, t.league_id, t.name, t.manager_name;

-- Free agents view (players not in any active squad)
create or replace view public.free_agents as
select p.*
from public.players p
where p.id not in (
  select player_id from public.squads
  where effective_to_week is null
);
