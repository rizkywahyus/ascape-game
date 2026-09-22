-- Per-role stats for separate monster / survivor leaderboards (plan.md §7).
alter table public.player_stats
  add column monster_matches int not null default 0,
  add column monster_wins int not null default 0,
  add column survivor_matches int not null default 0,
  add column survivor_escapes int not null default 0;

create index player_stats_score_idx on public.player_stats (score desc);
