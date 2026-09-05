-- SIDD TECHX — GLOBAL VIEW COUNTER
-- À exécuter dans Supabase > SQL Editor > New Query > Run

create table if not exists public.site_stats (
  id bigint primary key,
  views bigint not null default 0
);

insert into public.site_stats (id, views)
values (1, 0)
on conflict (id) do nothing;

alter table public.site_stats enable row level security;

revoke all on table public.site_stats from anon, authenticated;

create or replace function public.increment_site_views()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_views bigint;
begin
  update public.site_stats
  set views = views + 1
  where id = 1
  returning views into new_views;

  return new_views;
end;
$$;

revoke all on function public.increment_site_views() from public;
grant execute on function public.increment_site_views() to anon, authenticated;

-- Vérification facultative :
select * from public.site_stats;
