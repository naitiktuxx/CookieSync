# CookieSync — Revert Delete-on-Fetch (Simplification)

## Context / Decision
Delete-on-fetch (auto-removing a domain's data from the server the moment it's imported) was implemented earlier, but it's being reverted. Reason: the extension already has two mechanisms that cover the same security goal without the downsides:
- A **full manual wipe button** (`deleteRemoteData()`) that deletes the entire server row for a `sync_id` on demand.
- An **automatic 24hr TTL cron** (`pg_cron` job in `Supabase Queries.md`) that purges any row older than 24 hours regardless of user action.

Per-site auto-delete-on-import added complexity and real risk without adding meaningful security, since selective per-site retention isn't an actual use case here:
- **Race condition**: re-uploading a trimmed snapshot based on a stale download could silently overwrite newer data if another device pushed in between.
- **Lost recoverability**: if a receiver imported a site and then accidentally cleared its local cookies, there was no way to re-import — the data was already gone from the server, and only a fresh push from the host would restore it.
- **`deviceId` churn**: a new random `deviceId` was generated on every import re-upload and never persisted.
- **Misleading status/wasted writes**: importing a domain that didn't actually exist in the payload still triggered a full re-upload and reset the row's `updated_at` (resetting the TTL clock) for no reason.

## What to revert

### `src/shared/syncEngine.ts` — `importDomains()`
Remove the delete-on-fetch block entirely. The function should go back to being **read-only against the server**: download the snapshot, filter matching records, apply them locally, update local settings — and nothing else. No `store.uploadPayload()` or `store.deletePayload()` calls inside `importDomains()`.

Also remove the `remoteRemoved` / `remoteDeleted` fields from the `SyncResult` interface and from the object returned by `importDomains()`, since they no longer apply.

### `src/popup/popup.ts` — `formatResult()`
Remove the `remoteRemoved` / `remoteDeleted` handling added for delete-on-fetch. Go back to the plain "Downloaded N cookies" message for pull/import results.

### No changes needed to
- `crypto.ts`, `supabaseClient.ts`, `supabaseUrl.ts`, `types.ts`, `domainAllowlist.ts`, `cookies.ts` — untouched by this revert.
- The "remember passkey" session-storage work (`browserApi.ts` session helpers, `getOrHydratePassphrase()`) — that's a separate feature and stays as-is.
- The trash icon (`clear-domain-cookies`) — stays local-only, as it originally was. No server-side removal gets added to it.
- `Supabase Queries.md` (RLS + TTL cron) — stays as-is; the TTL cron remains the only automatic server-side cleanup mechanism.

## Resulting data-lifecycle model (final, simple)
- **Import** = read-only. Never touches the server.
- **Full wipe button** = the only way to explicitly remove server data early, and it removes everything for that `sync_id` at once (not per-site).
- **24hr TTL cron** = automatic backstop if the user does nothing.

This matches the original security checklist's intent for "minimize exposure window" without introducing per-site delete complexity.
