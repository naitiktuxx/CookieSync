-- ==========================================
-- CookieSync Hardened Supabase Schema & RLS
-- ==========================================

-- 1. Create table with auth_hash column for row-level access verification
create table if not exists public.cookie_sync (
  sync_id text primary key,
  payload jsonb not null,
  auth_hash text not null,
  updated_at timestamptz not null default now()
);

-- Ensure auth_hash column exists on legacy tables
alter table public.cookie_sync add column if not exists auth_hash text;

-- Index for efficient TTL cleanup queries
create index if not exists idx_cookie_sync_updated_at on public.cookie_sync(updated_at);

-- 2. Enable Row Level Security (RLS)
alter table public.cookie_sync enable row level security;

-- 3. Drop legacy wide-open policies if existing
drop policy if exists "anon can read cookie sync" on public.cookie_sync;
drop policy if exists "anon can upsert cookie sync" on public.cookie_sync;
drop policy if exists "anon can update cookie sync" on public.cookie_sync;
drop policy if exists "anon can delete cookie sync" on public.cookie_sync;
drop policy if exists "Scoped read with auth header" on public.cookie_sync;
drop policy if exists "Scoped insert with auth header" on public.cookie_sync;
drop policy if exists "Scoped update with auth header" on public.cookie_sync;
drop policy if exists "Scoped delete with auth header" on public.cookie_sync;

-- 4. Create scoped RLS policies enforcing matching x-sync-auth header
create policy "Scoped read with auth header"
on public.cookie_sync
for select
to anon
using (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

create policy "Scoped insert with auth header"
on public.cookie_sync
for insert
to anon
with check (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

create policy "Scoped update with auth header"
on public.cookie_sync
for update
to anon
using (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
  or auth_hash is null
  or auth_hash = ''
)
with check (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

create policy "Scoped delete with auth header"
on public.cookie_sync
for delete
to anon
using (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

-- ==========================================
-- 5. Automated TTL Cleanup (24-Hour Expiry)
-- ==========================================

-- Enable pg_cron for automatic purges (if available on your Supabase tier)
create extension if not exists pg_cron;

select cron.schedule(
  'purge-expired-cookie-syncs',
  '0 * * * *',
  $$ delete from public.cookie_sync where updated_at < now() - interval '24 hours'; $$
);