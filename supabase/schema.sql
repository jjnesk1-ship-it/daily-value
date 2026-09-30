-- Daily Value: database setup for email accounts.
-- Run this once in your Supabase project: SQL Editor > New query > paste > Run. Running it again is safe.
--
-- Every account's diary lives in one table, dv_docs, one row per document:
--   'profile', 'days/<YYYY-MM-DD>' and 'foods/<id>' (custom foods and recipes).
-- Row-level security lets each signed-in account read and write only its own rows.

create sequence if not exists public.dv_docs_seq;

create table if not exists public.dv_docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null,
  data jsonb,                                   -- null when deleted
  u bigint not null default 0,                  -- the app's edit time (ms); the newest copy wins
  deleted boolean not null default false,       -- kept as a marker so other devices remove their copy
  seq bigint not null default nextval('public.dv_docs_seq'),  -- change number, for syncing what's new
  updated_at timestamptz not null default now(),
  primary key (user_id, path),
  constraint dv_docs_path check (path ~ '^(profile|days/[0-9]{4}-[0-9]{2}-[0-9]{2}|foods/[A-Za-z0-9_-]{1,80})$'),
  constraint dv_docs_size check (data is null or pg_column_size(data) < 500000)
);

create index if not exists dv_docs_user_seq on public.dv_docs (user_id, seq);

-- On every change: keep the stored copy if the incoming one is older (a device that was offline catching
-- up), and give the row a new change number so the person's other devices pick it up.
create or replace function public.dv_docs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.u < old.u then
    return null;
  end if;
  new.user_id := old.user_id;
  new.seq := nextval('public.dv_docs_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dv_docs_touch on public.dv_docs;
create trigger dv_docs_touch
before update on public.dv_docs
for each row execute function public.dv_docs_touch();

alter table public.dv_docs enable row level security;

drop policy if exists "Read own rows" on public.dv_docs;
create policy "Read own rows" on public.dv_docs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Add own rows" on public.dv_docs;
create policy "Add own rows" on public.dv_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Change own rows" on public.dv_docs;
create policy "Change own rows" on public.dv_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own rows" on public.dv_docs;
create policy "Delete own rows" on public.dv_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.dv_docs from anon, public;
grant select, insert, update, delete on table public.dv_docs to authenticated;
revoke all on sequence public.dv_docs_seq from anon, public;
grant usage on sequence public.dv_docs_seq to authenticated;

-- Let a signed-in person delete their own account. Their rows go with it (on delete cascade).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
