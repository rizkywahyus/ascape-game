-- Unauthenticated guests (dev / load tests) play without a Supabase user, so a human participant can also have
-- no user_id. user_id is now simply "the signed-in player, if any".
alter table public.match_players drop constraint if exists match_players_check;
comment on column public.match_players.user_id is 'Signed-in player; null for bots and unauthenticated guests';
