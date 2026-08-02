# CookieSync — Code Review & Path to 10/10

**Scope reviewed:** `manifests/`, `src/**`, `scripts/build.mjs`, `README.md`, `security_check.md`, `supabase_schema_queries/Supabase Queries.md`, git history.

## Overall score: **6/10** (against your own stated "public release" bar in `security_check.md`)

| Category | Score | Notes |
|---|---|---|
| Crypto design | 8/10 | Solid primitives, correctly used |
| Server-side security (RLS/anon key model) | 4/10 | Real hole + unfinished hardening |
| Architecture / code quality | 8/10 | Clean, well-typed, good separation of concerns |
| Testing | 0/10 | No test suite exists at all |
| Documentation | 6/10 | README is excellent; supporting docs are broken/malformed |
| Project hygiene / process | 5/10 | Git history suggests scope drift into cosmetic tweaking |

This is a genuinely well-structured TypeScript codebase with good crypto fundamentals — but it does **not yet meet the bar your own `security_check.md` sets for public release**, and it has zero automated tests protecting a security-critical sync engine.

---

## 1. What's good (keep doing this)

- **AES-256-GCM via Web Crypto**, random salt/IV per payload, PBKDF2-SHA-256 at 250,000 iterations for the encryption key — correct, modern, no homemade crypto.
- **Separate, purpose-built auth token** (`deriveAuthHash`) distinct from the encryption key, sent as `x-sync-auth` — this is exactly the "hashed value distinct from the actual encryption key" your checklist asked for.
- **`crypto.randomUUID()`** for sync IDs — not guessable, satisfies item 3 of your checklist.
- **Raw passphrase never written to `chrome.storage.local`** — `syncPassphrase: undefined` is explicitly stripped before persisting settings; "remember" only uses in-memory/session storage.
- Clean module boundaries (`crypto.ts`, `cookies.ts`, `supabaseClient.ts`, `syncEngine.ts`, `browserApi.ts`) with cross-browser abstraction (`chrome` vs `browser`) done properly.
- Good, specific user-facing error messages mapped from Supabase HTTP failure modes.
- `pg_cron` TTL purge implemented in the schema — satisfies the "auto-expire" half of item 5.

---

## 2. Real gaps vs. your own `security_check.md`

Your own checklist is the right bar to grade against — here's the honest scorecard:

| Checklist item | Status |
|---|---|
| 1. Client-side AEAD encryption, KDF-derived key | ✅ Done |
| 2. Passkey never stored raw; server never sees it | ✅ Done |
| 3. Cryptographically random `sync_id` | ✅ Done |
| 4. RLS not wide-open / prefer Edge Function | ⚠️ **Partially done, one real bug** |
| 5. TTL expiry | ⚠️ Cron purge exists; **delete-on-fetch is not implemented** |
| 6. Don't request `<all_urls>` unless necessary | ❌ **Not addressed** — both manifests still request it |

### 2a. RLS policy hole (the update policy)
In `Supabase Queries.md`, the **update** policy allows a match when:
```sql
using (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
  or auth_hash is null
  or auth_hash = ''
)
```
The `or auth_hash is null or auth_hash = ''` clause was clearly meant as a one-time migration allowance for rows created before `auth_hash` existed. Left in place, it means **any holder of the shipped `anon` key can overwrite any row whose `auth_hash` is null/empty**, regardless of their own passphrase — e.g. immediately after a fresh table creation, or if any code path ever inserts without an `auth_hash`. This directly contradicts the "not wide open" goal of item 4 and should be removed once you're past the migration.

### 2b. Direct table access with the anon key is still the primary model
Your checklist's *preferred* fix — routing through a Supabase Edge Function holding `service_role`, with the extension never touching the table directly — was not implemented. What exists (per-row `auth_hash` header check) is the checklist's *acceptable fallback*, correctly implemented, but it still means the anon key (extractable from the shipped extension) plus a guessed/leaked sync ID + passphrase-derived hash is enough to touch a row. That's an acceptable risk for personal use, not yet for public release.

### 2c. No delete-on-fetch
`downloadLatestPayload()` in `supabaseClient.ts` only reads — nothing calls `deletePayload()` after a successful `importDomains()`/pull. Cookies sit in Supabase (ciphertext, but still session-equivalent-to-passwords data) for up to 24h even after the receiving browser has already picked them up. Your own checklist calls this out explicitly under "minimize exposure window."

### 2d. `<all_urls>` host permission
Both `manifests/brave.json` and `manifests/firefox.json` request `<all_urls>` unconditionally. Since the extension only needs to *read/write cookies* (not inject scripts or fetch pages), this is broader than `cookies` + `host_permissions` needs to be for most of the flow, and is exactly the "major trust signal" your checklist warns about for an open-source extension asking for cookie access.

---

## 3. Code-quality issues (not security, just quality)

- **Zero tests.** No `*.test.ts`, no test runner in `package.json`, no CI config. For a codebase whose entire value proposition is "we handle your session cookies safely," `crypto.ts`, `syncEngine.ts`, and `domainAllowlist.ts` are exactly where unit tests earn their keep (round-trip encrypt/decrypt, wrong-passphrase failure, domain matching edge cases, ledger merge logic).
- **`security_check.md` is not actually markdown.** It's RTF content saved with a `.md` extension (`{\rtf1\ansi...`). It renders as garbage on GitHub/any markdown viewer. Convert it to plain `.md`.
- **`README.md` references `goal/goal.md`** in the directory tree, but that file doesn't exist in the working tree (only `goal/.DS_Store` does) — and `git status` shows it was deleted but the deletion isn't committed. Either restore it or remove the reference.
- **`domainAllowlist.ts`'s `DOMAIN_FAMILIES`** hardcodes exactly two entries (`youtube.com`, `google.com`) with a specific expansion list. This reads like a one-off fix for a specific bug rather than a general mechanism — worth a comment explaining why these two (and only these two) domains get special treatment, or generalizing it if more will follow.
- **`.DS_Store` files are committed/zipped** throughout (`goal/.DS_Store`, root `.DS_Store`) despite `.gitignore` not excluding them — add `.DS_Store` (already listed, so double check why it's present — likely just an export artifact, but worth a `git rm --cached` sweep).
- **Git history is dominated by cosmetic micro-tweaks** — of the last 20 commits, the majority are pixel-level CSS height adjustments (330px → 295px → 270px → 290px → 285px → 284px in successive commits) and animation/UI polish, rather than the security hardening items your own checklist prioritizes. This suggests the coding assistant you've been using is optimizing for whatever's asked in the moment rather than tracking the outstanding security backlog — worth explicitly steering it back to `security_check.md` periodically.

---

## 4. Improvement list — hand this to your coding AI assistant

Ordered by priority. Written as direct instructions you can paste in.

### Must-fix (blocks "10/10" / public-release bar)
1. **Remove the `auth_hash is null or auth_hash = ''` clause** from the update RLS policy in `Supabase Queries.md` (and re-run against your live Supabase project). If you need a migration path for old rows, do it as a one-time manual `UPDATE` instead of a permanent policy hole.
2. **Implement delete-on-fetch**: after a successful pull/import in `CookieSyncEngine.importDomains()`, call `store.deletePayload()` (or a narrower "mark consumed" flag) once the receiver has the data, matching your own checklist's item 5.
3. **Narrow `host_permissions`** in both manifests. Cookies API access doesn't need `<all_urls>` — audit whether `<all_urls>` is used for anything beyond `chrome.cookies.*`/`fetch()` to your fixed Supabase domain, and drop it if not, or scope it to only what's actually read.
4. **Add a test suite** (`vitest` or `node:test` is enough — no need for anything heavy): at minimum, round-trip tests for `encryptJson`/`decryptJson`/`deriveAuthHash` in `crypto.ts`, wrong-passphrase failure behavior, and `cookieMatchesAllowedDomains` edge cases in `domainAllowlist.ts`. Wire it into `npm test` and a basic CI workflow (GitHub Actions: `npm ci && npm run typecheck && npm test`).
5. **Decide on and implement the Edge Function model** (your checklist's *preferred* fix for item 4), or explicitly document in the README that direct-table-with-anon-key is a deliberate, accepted tradeoff for this project's threat model — don't leave it silently unresolved.

### Should-fix (quality/hygiene)
6. Convert `security_check.md` from RTF-with-.md-extension to actual markdown.
7. Fix the `README.md` ↔ `goal/goal.md` mismatch (restore the file or remove the reference from the directory tree).
8. Add a short comment in `domainAllowlist.ts` explaining the `DOMAIN_FAMILIES` special-case, or generalize it.
9. Sweep `.DS_Store` out of the repo (`git rm --cached -r . && git add . -A` after fixing `.gitignore` if needed, or add `find . -name .DS_Store -delete` as a pre-commit hook).
10. Add rate-limiting guidance or at least document the risk: since decryption is entirely client-side, someone with a leaked ciphertext blob can brute-force offline at whatever rate their hardware allows — 250k PBKDF2 iterations raises the cost but doesn't rate-limit it. Consider bumping iterations further (OWASP currently recommends 600k+ for PBKDF2-SHA256) if this is heading to public release.

### Process suggestion
11. Before your next round of UI polish commits, do one pass explicitly against the six items in your own `security_check.md` and update its "status legend" section to reflect what's actually done — right now it's an unmaintained checklist sitting next to code that has partially diverged from it in both directions (some items done, one item regressed via the RLS hole).

---

## 5. What "10/10" looks like here

Given this project's own stated goal (public/open-source release of a tool that syncs session-cookie-equivalent data), a 10/10 means:
- Every item in `security_check.md` is either done or has an explicit, documented decision *not* to do it and why.
- The RLS hole above is closed.
- `<all_urls>` is gone or justified in the README.
- There's a test suite covering the crypto and domain-matching logic, wired into CI.
- The two malformed/missing docs (`security_check.md`, `goal/goal.md`) are fixed.

None of this requires a rewrite — the architecture is sound. It's a focused hardening + hygiene pass, roughly items 1–5 above, that gets you there.
