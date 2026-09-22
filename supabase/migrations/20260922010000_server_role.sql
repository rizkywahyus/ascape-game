-- Dedicated login role for the game server (plan.md §7): it may only touch the game tables, never auth.*.
-- The password is NOT set here; set it out of band and keep it in the server's env:
--   alter role ascape_server with password '<secret>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ascape_server') then
    create role ascape_server login noinherit;
  end if;
end
$$;

grant usage on schema public to ascape_server;
grant select, insert, update on public.profiles, public.player_stats, public.matches, public.match_players
  to ascape_server;
grant usage on all sequences in schema public to ascape_server;

-- RLS stays on for these tables; the server role gets explicit full-access policies instead of BYPASSRLS.
create policy "server manages profiles" on public.profiles for all to ascape_server using (true) with check (true);
create policy "server manages player stats" on public.player_stats for all to ascape_server using (true) with check (true);
create policy "server manages matches" on public.matches for all to ascape_server using (true) with check (true);
create policy "server manages match players" on public.match_players for all to ascape_server using (true) with check (true);
