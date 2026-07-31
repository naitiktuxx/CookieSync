# Cookie Sync Extension

A cross-browser WebExtensions project for syncing encrypted browser cookies through Supabase.

The project builds separate extension folders for Brave and Firefox while sharing the sync engine, encryption, cookie access, Supabase storage, and popup UI.

## Structure

```text
manifests/
  brave.json      Chromium/Brave Manifest V3
  firefox.json    Firefox WebExtensions manifest
src/
  background/     Extension event wiring
  popup/          Settings and manual sync UI
  shared/         Browser APIs, cookies, encryption, Supabase, sync engine
scripts/
  build.mjs       Builds dist/brave and dist/firefox
```

## Supabase Setup

This project is prefilled with:

- Supabase URL: `https://wryujsoegvvagmovfdlf.supabase.co`
- Anon key: configured in `src/shared/defaultConfig.ts`

Create this table in Supabase SQL editor:

```sql
create table if not exists public.cookie_sync (
  sync_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.cookie_sync enable row level security;

create policy "anon can read cookie sync"
on public.cookie_sync
for select
to anon
using (true);

create policy "anon can upsert cookie sync"
on public.cookie_sync
for insert
to anon
with check (true);

create policy "anon can update cookie sync"
on public.cookie_sync
for update
to anon
using (true)
with check (true);
```

Use a hard-to-guess `Sync ID`, because anyone with your Supabase URL, anon key, and sync ID can read the encrypted blob. The cookies are still encrypted locally with your passphrase before upload.

## Build

Install dependencies:

```bash
npm install
```

Build one or both targets:

```bash
npm run build:brave
npm run build:firefox
```

The generated extension folders will be in `dist/brave` and `dist/firefox`.

## Architecture

- Cookies are read with the WebExtensions cookies API.
- Cookie snapshots are encrypted locally using AES-GCM before upload.
- Supabase stores only the encrypted payload.
- Sync behavior lives in `src/shared/syncEngine.ts`.
- Cookie changes are tracked in a local ledger by latest change time.
- Brave uploads all cookie domains into one encrypted payload.
- Firefox lets you choose which uploaded domains to import.
- Firefox import is update-only: deletion records are ignored, so Firefox-only logged-in sites are not removed.
- Firefox marks domains that were imported before with a check mark.
- Supabase receives only an encrypted blob: AES-GCM ciphertext plus salt and IV. Cookie details are encrypted locally with the passphrase.

## Browser behavior

Brave:

- Popup shows Supabase settings, passphrase, sites to sync, and `Upload cookies now`.
- Background job uploads all encrypted cookies once per day.
- Cookie changes are tracked locally, but they are not uploaded on every change.
- Copy the Brave Sync ID and paste that same value into Firefox.

Firefox:

- Popup shows Supabase settings, passphrase, uploaded server sites, and `Import selected sites`.
- Click `Load server sites`, tick the domains you want, then import them.
- Sites imported before are checked and marked with `✓`.
- Background job imports/restores the domains you previously imported once per day.
- Firefox does not upload cookies in this one-way setup.

The `Sync ID` is generated automatically and saved in extension storage. Use the same Sync ID and passphrase in Brave and Firefox.
