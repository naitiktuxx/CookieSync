# CookieSync — Public Release Security Checklist

Context: Browser extension that syncs cookie/session data between browsers (Chrome/Firefox/Brave) via a Supabase relay. One extension instance (host) uploads encrypted cookie data; another instance (receiver) pairs via a client ID + passkey and downloads it.

---

## 1. Application-level encryption (client-side only)

- Cookies must be encrypted **in the extension**, before the upload ever leaves the browser.
- Use a proper AEAD cipher: **AES-256-GCM** (via Web Crypto API — `crypto.subtle`). No homemade/XOR-style encryption.
- Supabase should only ever receive and store **ciphertext**. It should never see plaintext cookie values or the raw passkey.
- Encryption key must be **derived from the user's passkey using a KDF** (PBKDF2-SHA-256, 250,000 iterations) — not the passkey used directly as a key.

## 2. Passkey handling ("Remember passkey")

- **Never store the raw passkey in plaintext** in `chrome.storage.local` or anywhere on disk.
- If "remember" must be supported:
  - Prefer OS-level secure storage if the extension platform exposes it.
  - At minimum, store a derived value (not the raw passkey) and re-derive the encryption key from it in a way that limits reuse if leaked.
- Server (Supabase) should **never receive or verify the raw passkey**. Passkey usage stays entirely client-side (key derivation only). Check requests pass a separate derived `auth_hash` token (`x-sync-auth`) via PBKDF2 (50,000 iterations) — distinct from the encryption key.
- Offline brute-forcing note: PBKDF2-SHA-256 at 250k iterations raises offline cracking costs significantly. For public releases, users are advised to use strong passphrases.

## 3. `sync_id` / client ID generation

- Must be generated with a **cryptographically secure random generator**: `crypto.randomUUID()` (or `crypto.getRandomValues()`), not `Date.now()`, incrementing counters, or `Math.random()`.
- Cryptographically non-guessable UUID v4 (128-bit) prevents row enumeration attacks.

## 4. Row Level Security (RLS) — Hardened Header Verification

- All `cookie_sync` table queries enforce strict matching on `auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')` across `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
- The legacy `auth_hash is null or auth_hash = ''` migration clause has been removed to prevent unauthorized updates.
- Threat Model Note: Direct table access with the `anon` key + row-level `x-sync-auth` verification is the active model. Edge Function routing remains an optional server-side enhancement for environments requiring complete isolation from direct table endpoints.

## 5. Data lifecycle — minimize exposure window

- **Auto-expire uploaded data**: 24hr auto-upload TTL cleanup scheduled via Postgres `pg_cron` extension.
- **Delete-on-fetch**: Receiver sync engine (`importDomains()`) supports an explicit `deleteOnFetch` flag to purge remote payload once receiver imports cookie records.

## 6. Host Permissions & Scope

- Host permissions scoped tightly to `"http://*/*"` and `"https://*/*"` in extension manifests, removing unnecessary `<all_urls>` wildcards (which include non-web protocols like `file://` or `chrome://`).
- Documented clearly in README that session cookies grant password-equivalent access.

---

## Status Legend & Hardening Audit Log

| Checklist item | Status | Implementation Details |
|---|---|---|
| 1. Client-side AEAD encryption | ✅ Done | AES-256-GCM via Web Crypto; PBKDF2-SHA-256 (250,000 iterations) |
| 2. Passkey never stored raw | ✅ Done | Passphrase in RAM (`chrome.storage.session`); `x-sync-auth` derived token |
| 3. Random `sync_id` | ✅ Done | `crypto.randomUUID()` |
| 4. Hardened RLS policies | ✅ Done | Strict `x-sync-auth` matching; legacy `auth_hash is null` hole removed |
| 5. TTL expiry & delete-on-fetch | ✅ Done | Postgres `pg_cron` 24h purge + `deleteOnFetch` engine option |
| 6. Scoped permissions | ✅ Done | Removed `<all_urls>`; restricted host permissions to `http`/`https` |