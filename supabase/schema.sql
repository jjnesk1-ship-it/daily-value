-- Daily Value: database setup for email accounts.
-- Run this once in your Supabase project: SQL Editor > New query > paste > Run. Running it again is safe.
--
-- Every account's diary lives in one table, dv_docs, one row per document:
--   'profile', 'days/<YYYY-MM-DD>' and 'foods/<id>' (custom foods and recipes).
-- Row-level security lets each signed-in account read and write only its own rows, and each account
-- can store at most 5,000 documents and 20 MB.

create sequence if not exists public.dv_docs_seq;

create table if not exists public.dv_docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null,
  data jsonb,                                   -- null when deleted
  u bigint not null default 0,                  -- the app's edit time (ms); the newest copy wins
  deleted boolean not null default false,       -- kept as a marker so other devices remove their copy
  seq bigint not null default 0,                -- change number, for syncing what's new (set by the trigger)
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- Real dates only, and a size limit per document (a busy day or a big recipe is well under 64 KB).
alter table public.dv_docs drop constraint if exists dv_docs_path;
alter table public.dv_docs add constraint dv_docs_path
  check (path ~ '^(profile|days/(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|foods/[A-Za-z0-9_-]{1,80})$');
alter table public.dv_docs drop constraint if exists dv_docs_size;
alter table public.dv_docs add constraint dv_docs_size check (data is null or pg_column_size(data) < 262144);

create index if not exists dv_docs_user_seq on public.dv_docs (user_id, seq);

-- On every write:
--  * one account's writes run one at a time, so change numbers become visible in order and a device
--    reading "changes after N" never skips one;
--  * an older copy arriving late (a device catching up after being offline) leaves the stored one alone;
--  * edit times more than a minute ahead of the server's clock are pulled back, so a device with a
--    fast clock can't lock a document against everyone else's later edits;
--  * each account stays within 5,000 documents and 20 MB.
create or replace function public.dv_docs_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n bigint;       -- documents the account has (deletion markers don't count)
  total bigint;   -- bytes the account stores
  here bigint;    -- 1 if this document already exists (as a document or a marker)
  mine bigint;    -- bytes this document already takes
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    if new.u < old.u then
      return null;
    end if;
  end if;
  new.u := least(new.u, (extract(epoch from clock_timestamp()) * 1000)::bigint + 60000);
  -- (An upsert runs this as INSERT even when it ends up updating, so the existing row is looked up.)
  select count(*) filter (where not deleted),
         coalesce(sum(pg_column_size(data)), 0),
         count(*) filter (where path = new.path),
         coalesce(sum(pg_column_size(data)) filter (where path = new.path), 0)
    into n, total, here, mine
    from public.dv_docs where user_id = new.user_id;
  if (here = 0 and not new.deleted and n >= 5000)
     or total - mine + coalesce(pg_column_size(new.data), 0) > 20971520 then
    raise exception 'This account is out of storage space' using errcode = '54000';
  end if;
  new.seq := nextval('public.dv_docs_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dv_docs_touch on public.dv_docs;
drop function if exists public.dv_docs_touch();
drop trigger if exists dv_docs_write on public.dv_docs;
create trigger dv_docs_write
before insert or update on public.dv_docs
for each row execute function public.dv_docs_write();

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

-- Supabase no longer gives new tables to the app's roles automatically, so grant exactly what's needed.
revoke all on table public.dv_docs from anon, public;
grant select, insert, update, delete on table public.dv_docs to authenticated, service_role;
revoke all on sequence public.dv_docs_seq from anon, public;
grant usage, select on sequence public.dv_docs_seq to authenticated, service_role;

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
