-- Piano Log → Supabase READ MIRROR (phase 1, applied 2026-10-07 as migrations
-- pianolog_read_mirror, pianolog_sync_begin_lock, pianolog_sync_runs_read,
-- pianolog_sync_finish_fix on project ismacawxfvvllfinibbf). Kept here as the
-- readable reference of what exists; re-runnable.
--
-- The Google Sheet STAYS the authority (decision 2026-10-07): staff keep
-- editing it, writes keep going through the bridge_queue relay. This is a
-- fast read copy, refreshed by blpsalesapp pianolog-sync-background (every
-- 3 min, after every app write, and from the sheet's onChange trigger).
-- RLS on, no public access: rows hold customer PII, so reads go through
-- role-gated Netlify functions holding the service key. The `pianolog`
-- schema is NOT exposed in PostgREST — access is via the service_role-only
-- RPCs in public.* below.

create schema if not exists pianolog;

create table if not exists pianolog.pianos (
  key         text primary key,            -- serial (first occurrence) | "serial#r<row>" | "~r<row>"
  serial      text not null default '',
  row_index   int  not null,               -- 1-based sheet row
  section     text not null default '',
  subsection  text not null default '',
  queue_pos   int  not null default 0,
  queue_total int  not null default 0,
  active      boolean not null default true,
  archived    boolean not null default false,
  summary     text not null default '',
  phase       text not null default '',
  location    text not null default '',
  status      text not null default '',
  track       text not null default '',
  make        text not null default '',
  model       text not null default '',
  year        text not null default '',
  owner       text not null default '',    -- PII: raw column B (never sent to techs)
  price       text not null default '',    -- never sent to techs
  sm          jsonb,                       -- Store Map record (data.mjs parsePianos shape), null = not a map row
  pl          jsonb,                       -- Piano Log app record (parse.js shape), null = not an app row
  raw         jsonb not null default '{}', -- full sheet row keyed by header (non-empty cells only)
  hash        text not null default '',
  synced_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pianos_row_idx on pianolog.pianos (row_index);
create index if not exists pianos_serial_idx on pianolog.pianos (serial);
create index if not exists pianos_active_idx on pianolog.pianos (active);

create table if not exists pianolog.sync_runs (
  id        bigserial primary key,
  started   timestamptz not null default now(),
  finished  timestamptz,
  rows      int,
  changed   int,
  removed   int,
  skipped   int,
  ok        boolean,
  error     text,
  source    text not null default '',      -- cron | write | queue | sheet-change | manual | pianolog-*
  meta      jsonb not null default '{}'
);
create index if not exists sync_runs_started_idx on pianolog.sync_runs (started desc);

create table if not exists pianolog.meta (     -- sections, header_keys, queue, app_access (roster), last_sync
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table pianolog.pianos    enable row level security;
alter table pianolog.sync_runs enable row level security;
alter table pianolog.meta      enable row level security;
revoke all on schema pianolog from public, anon, authenticated;
revoke all on all tables in schema pianolog from public, anon, authenticated;

-- Realtime ping (no PII): one row per sync/patch that changed something.
-- Browsers subscribe with the publishable key and re-fetch through their
-- role-gated API when a row lands.
create table if not exists public.pianolog_changes (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  kind    text not null default 'sync',    -- sync | patch
  n       int  not null default 0,
  serials text[] not null default '{}'
);
alter table public.pianolog_changes enable row level security;
drop policy if exists pianolog_changes_read on public.pianolog_changes;
create policy pianolog_changes_read on public.pianolog_changes for select using (true);
revoke insert, update, delete on public.pianolog_changes from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pianolog_changes') then
    alter publication supabase_realtime add table public.pianolog_changes;
  end if;
end $$;

-- ---------- RPCs (service_role only) ----------
-- begin: returns null while another run is open and younger than 150 s
create or replace function public.pianolog_sync_begin(p_source text, p_meta jsonb default '{}')
returns bigint language plpgsql security definer set search_path = pianolog, public as $$
declare rid bigint;
begin
  if exists (select 1 from pianolog.sync_runs where finished is null and started > now() - interval '150 seconds') then
    return null;
  end if;
  insert into pianolog.sync_runs (source, meta) values (coalesce(p_source,''), coalesce(p_meta,'{}'::jsonb)) returning id into rid;
  return rid;
end $$;

-- upsert a chunk; rows whose content hash is unchanged are left untouched.
create or replace function public.pianolog_sync_upsert(p_run bigint, p_rows jsonb)
returns int language plpgsql security definer set search_path = pianolog, public as $$
declare n int;
begin
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      key text, serial text, row_index int, section text, subsection text,
      queue_pos int, queue_total int, active boolean, archived boolean,
      summary text, phase text, location text, status text, track text,
      make text, model text, year text, owner text, price text,
      sm jsonb, pl jsonb, raw jsonb, hash text)
  ), up as (
    insert into pianolog.pianos as p (key, serial, row_index, section, subsection, queue_pos, queue_total,
      active, archived, summary, phase, location, status, track, make, model, year, owner, price,
      sm, pl, raw, hash, synced_at, updated_at)
    select key, coalesce(serial,''), row_index, coalesce(section,''), coalesce(subsection,''), coalesce(queue_pos,0), coalesce(queue_total,0),
      coalesce(active,true), coalesce(archived,false), coalesce(summary,''), coalesce(phase,''), coalesce(location,''), coalesce(status,''), coalesce(track,''),
      coalesce(make,''), coalesce(model,''), coalesce(year,''), coalesce(owner,''), coalesce(price,''),
      sm, pl, coalesce(raw,'{}'::jsonb), coalesce(hash,''), now(), now()
    from src
    on conflict (key) do update set
      serial=excluded.serial, row_index=excluded.row_index, section=excluded.section, subsection=excluded.subsection,
      queue_pos=excluded.queue_pos, queue_total=excluded.queue_total, active=excluded.active, archived=excluded.archived,
      summary=excluded.summary, phase=excluded.phase, location=excluded.location, status=excluded.status, track=excluded.track,
      make=excluded.make, model=excluded.model, year=excluded.year, owner=excluded.owner, price=excluded.price,
      sm=excluded.sm, pl=excluded.pl, raw=excluded.raw, hash=excluded.hash, synced_at=now(), updated_at=now()
    where p.hash is distinct from excluded.hash
    returning 1
  ) select count(*) into n from up;
  return n;
end $$;

-- finish: drop rows that vanished from the sheet (except keys the sync chose
-- to keep, e.g. serials with an open bridge_queue write), store meta, ping.
create or replace function public.pianolog_sync_finish(p_run bigint, p_seen text[], p_ok boolean, p_error text,
  p_rows int, p_changed int, p_skipped int, p_meta jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pianolog, public as $$
declare v_removed int := 0; v_serials text[];
begin
  if p_ok then
    with d as (delete from pianolog.pianos where not (key = any(coalesce(p_seen,'{}'))) returning serial)
    select count(*), array_remove(array_agg(serial), '') into v_removed, v_serials from d;
    if p_meta is not null and p_meta <> '{}'::jsonb then
      insert into pianolog.meta (key, value, updated_at)
      select k, v, now() from jsonb_each(p_meta) as e(k, v)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    insert into pianolog.meta (key, value, updated_at) values ('last_sync', jsonb_build_object('run', p_run, 'at', now(), 'rows', p_rows), now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    if coalesce(p_changed,0) + v_removed > 0 then
      insert into public.pianolog_changes (kind, n, serials) values ('sync', coalesce(p_changed,0) + v_removed, coalesce(v_serials,'{}'));
      delete from public.pianolog_changes where id < (select max(id) from public.pianolog_changes) - 200;
    end if;
  end if;
  update pianolog.sync_runs r set finished = now(), ok = p_ok, error = p_error, rows = p_rows,
    changed = p_changed, removed = v_removed, skipped = p_skipped where r.id = p_run;
  return jsonb_build_object('run', p_run, 'removed', v_removed, 'changed', p_changed);
end $$;

-- read: shape 'sm' (Store Map), 'pl' (Piano Log app), 'meta' (sections, roster, last_sync)
create or replace function public.pianolog_read(p_shape text, p_active_only boolean default false)
returns jsonb language plpgsql security definer set search_path = pianolog, public as $$
declare out jsonb; last jsonb;
begin
  select value into last from pianolog.meta where key = 'last_sync';
  if p_shape = 'sm' then
    select coalesce(jsonb_agg(sm order by row_index), '[]'::jsonb) into out
      from pianolog.pianos where sm is not null and (not p_active_only or active);
    return jsonb_build_object('rows', out, 'last_sync', last);
  elsif p_shape = 'pl' then
    select coalesce(jsonb_agg(pl order by row_index), '[]'::jsonb) into out
      from pianolog.pianos where pl is not null and (not p_active_only or active);
    return jsonb_build_object('rows', out, 'last_sync', last,
      'sections', coalesce((select value from pianolog.meta where key='sections'), '[]'::jsonb));
  elsif p_shape = 'meta' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into out from pianolog.meta;
    return out;
  end if;
  raise exception 'unknown shape %', p_shape;
end $$;

-- optimistic patch after a write: merge into the unique-serial row so the
-- apps show the change before the next sheet sync confirms it.
create or replace function public.pianolog_patch(p_serial text, p_cols jsonb, p_sm jsonb, p_pl jsonb, p_raw jsonb)
returns boolean language plpgsql security definer set search_path = pianolog, public as $$
declare n int;
begin
  select count(*) into n from pianolog.pianos where lower(trim(serial)) = lower(trim(p_serial)) and not archived;
  if n <> 1 then return false; end if;
  update pianolog.pianos set
    phase    = coalesce(p_cols->>'phase', phase),
    location = coalesce(p_cols->>'location', location),
    track    = coalesce(p_cols->>'track', track),
    price    = coalesce(p_cols->>'price', price),
    status   = coalesce(p_cols->>'status', status),
    sm  = case when sm is null then sm else sm || coalesce(p_sm, '{}'::jsonb) end,
    pl  = case when pl is null then pl else pl || coalesce(p_pl, '{}'::jsonb) end,
    raw = raw || coalesce(p_raw, '{}'::jsonb),
    updated_at = now()
  where lower(trim(serial)) = lower(trim(p_serial)) and not archived;
  insert into public.pianolog_changes (kind, n, serials) values ('patch', 1, array[p_serial]);
  return true;
end $$;

-- recent sync runs for pianolog-sync-status
create or replace function public.pianolog_sync_runs(p_limit int default 10)
returns jsonb language sql security definer set search_path = pianolog, public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.started desc), '[]'::jsonb)
  from (select id, started, finished, rows, changed, removed, skipped, ok, error, source
        from pianolog.sync_runs order by started desc limit greatest(1, least(coalesce(p_limit,10), 200))) r;
$$;

revoke all on function public.pianolog_sync_begin(text, jsonb) from public, anon, authenticated;
revoke all on function public.pianolog_sync_upsert(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.pianolog_sync_finish(bigint, text[], boolean, text, int, int, int, jsonb) from public, anon, authenticated;
revoke all on function public.pianolog_read(text, boolean) from public, anon, authenticated;
revoke all on function public.pianolog_patch(text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.pianolog_sync_runs(int) from public, anon, authenticated;
grant execute on function public.pianolog_sync_begin(text, jsonb) to service_role;
grant execute on function public.pianolog_sync_upsert(bigint, jsonb) to service_role;
grant execute on function public.pianolog_sync_finish(bigint, text[], boolean, text, int, int, int, jsonb) to service_role;
grant execute on function public.pianolog_read(text, boolean) to service_role;
grant execute on function public.pianolog_patch(text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.pianolog_sync_runs(int) to service_role;
