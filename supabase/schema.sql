create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  team_logo_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_display_name_unique
  on profiles (lower(display_name));

create table if not exists self_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  duration_label text not null,
  created_at timestamptz not null default now()
);

create table if not exists user_bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  banned_by uuid references profiles(id) on delete set null,
  reason text,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists league_bans (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  banned_by uuid references profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists admin_users (
  user_id uuid primary key references profiles(id) on delete cascade,
  role text not null check (role in ('super_admin')),
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references profiles(id) on delete restrict,
  season_length_weeks integer not null default 12,
  max_members integer not null default 10,
  season_start date,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists asset_universe_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  as_of timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists asset_universe_members (
  snapshot_id uuid not null references asset_universe_snapshots(id) on delete cascade,
  ticker text not null,
  company_name text,
  sector text,
  industry text,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, ticker)
);

create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  lock_time timestamptz not null,
  universe_snapshot_id uuid references asset_universe_snapshots(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (league_id, week_start)
);

create table if not exists matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_id uuid not null references weeks(id) on delete cascade,
  home_user_id uuid not null references profiles(id) on delete cascade,
  away_user_id uuid not null references profiles(id) on delete cascade,
  home_score numeric(10,6),
  away_score numeric(10,6),
  winner_user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (week_id, home_user_id, away_user_id)
);

create table if not exists lineups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_id uuid not null references weeks(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  user_locked_at timestamptz,
  weekly_return numeric(10,6),
  unique (week_id, user_id)
);

create table if not exists lineup_positions (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references lineups(id) on delete cascade,
  ticker text not null,
  weight numeric(6,5) not null check (weight > 0 and weight <= 1),
  created_at timestamptz not null default now(),
  unique (lineup_id, ticker)
);

create table if not exists weekly_prices (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  ticker text not null,
  monday_open numeric(12,4) not null,
  friday_close numeric(12,4) not null,
  created_at timestamptz not null default now(),
  unique (week_id, ticker)
);

create table if not exists market_data_snapshots (
  ticker text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  has_overview boolean not null default false
);

alter table profiles enable row level security;
alter table self_exclusions enable row level security;
alter table user_bans enable row level security;
alter table league_bans enable row level security;
alter table admin_users enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table weeks enable row level security;
alter table asset_universe_snapshots enable row level security;
alter table asset_universe_members enable row level security;
alter table matchups enable row level security;
alter table lineups enable row level security;
alter table lineup_positions enable row level security;
alter table weekly_prices enable row level security;
alter table market_data_snapshots enable row level security;

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create policy "self_exclusions_select_own" on self_exclusions
  for select using (auth.uid() = user_id);

create policy "self_exclusions_insert_own" on self_exclusions
  for insert with check (auth.uid() = user_id);

create policy "user_bans_select_own" on user_bans
  for select using (auth.uid() = user_id);

create policy "league_bans_select_creator" on league_bans
  for select using (
    exists (
      select 1 from leagues
      where leagues.id = league_bans.league_id
        and leagues.created_by = auth.uid()
    )
  );

create policy "league_bans_insert_creator" on league_bans
  for insert with check (
    exists (
      select 1 from leagues
      where leagues.id = league_bans.league_id
        and leagues.created_by = auth.uid()
    )
  );

create policy "league_bans_delete_creator" on league_bans
  for delete using (
    exists (
      select 1 from leagues
      where leagues.id = league_bans.league_id
        and leagues.created_by = auth.uid()
    )
  );

create policy "leagues_select_members" on leagues
  for select using (
    exists (
      select 1 from league_members
      where league_members.league_id = leagues.id
        and league_members.user_id = auth.uid()
    )
  );

create policy "leagues_insert_creator" on leagues
  for insert with check (created_by = auth.uid());

create policy "league_members_select" on league_members
  for select using (user_id = auth.uid());

create policy "league_members_insert_self" on league_members
  for insert with check (user_id = auth.uid());

create policy "weeks_select_members" on weeks
  for select using (
    exists (
      select 1 from league_members
      where league_members.league_id = weeks.league_id
        and league_members.user_id = auth.uid()
    )
  );

create policy "asset_universe_snapshots_select_all" on asset_universe_snapshots
  for select using (true);

create policy "asset_universe_members_select_all" on asset_universe_members
  for select using (true);

create policy "matchups_select_members" on matchups
  for select using (
    exists (
      select 1 from league_members
      where league_members.league_id = matchups.league_id
        and league_members.user_id = auth.uid()
    )
  );

create policy "lineups_select_members" on lineups
  for select using (
    exists (
      select 1 from league_members
      where league_members.league_id = lineups.league_id
        and league_members.user_id = auth.uid()
    )
  );

create policy "lineups_insert_self" on lineups
  for insert with check (user_id = auth.uid());

create policy "lineup_positions_select_members" on lineup_positions
  for select using (
    exists (
      select 1 from lineups
      join league_members on league_members.league_id = lineups.league_id
      where lineups.id = lineup_positions.lineup_id
        and league_members.user_id = auth.uid()
    )
  );

create policy "lineup_positions_insert_self" on lineup_positions
  for insert with check (
    exists (
      select 1 from lineups
      where lineups.id = lineup_positions.lineup_id
        and lineups.user_id = auth.uid()
    )
  );

create policy "weekly_prices_select_members" on weekly_prices
  for select using (
    exists (
      select 1 from weeks
      join league_members on league_members.league_id = weeks.league_id
      where weeks.id = weekly_prices.week_id
        and league_members.user_id = auth.uid()
    )
  );

create table if not exists league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  email text not null,
  invited_by uuid references profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists league_invites_unique on league_invites (league_id, email);

alter table league_invites enable row level security;

create policy "league_invites_select_own" on league_invites
  for select using (
    lower(email) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1 from leagues
      where leagues.id = league_invites.league_id
        and leagues.created_by = auth.uid()
    )
  );

create policy "league_invites_insert_creator" on league_invites
  for insert with check (
    exists (
      select 1 from leagues
      where leagues.id = league_invites.league_id
        and leagues.created_by = auth.uid()
    )
  );

create policy "league_invites_update_invitee" on league_invites
  for update using (
    lower(email) = lower(auth.jwt() ->> 'email')
    or exists (
      select 1 from leagues
      where leagues.id = league_invites.league_id
        and leagues.created_by = auth.uid()
    )
  );

create table if not exists wizyrd_chat_history (
  user_id uuid primary key references auth.users(id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table wizyrd_chat_history enable row level security;

create policy "wizyrd_chat_history_select_own" on wizyrd_chat_history
  for select using (auth.uid() = user_id);

create policy "wizyrd_chat_history_insert_own" on wizyrd_chat_history
  for insert with check (auth.uid() = user_id);

create policy "wizyrd_chat_history_update_own" on wizyrd_chat_history
  for update using (auth.uid() = user_id);
