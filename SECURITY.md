# Security Policy

CookieSync handles browser cookies, which for most sites are equivalent to an active, logged-in password. This document explains what protection the implementation actually provides, what it doesn't, and how to report a problem.

## Security philosophy

Nothing here is described as more secure than it is. If a claim can't be traced to a specific line of code or a specific SQL policy, it isn't made. There is no professional audit behind this project, and open-source visibility is not a substitute for one, code being readable doesn't mean every reader has actually reviewed the cryptography or the RLS policies for correctness.

The design goal is narrow: keep Supabase, and anyone who compromises Supabase, from ever seeing a plaintext cookie or your passphrase. It is not designed to protect you from a compromised device, a weak passphrase, or someone who obtains both your Sync ID and passphrase.

## Encryption model

Every upload and exported `.cokz` file is encrypted client-side with **AES-256-GCM** through the Web Crypto API (`crypto.subtle`). A fresh 16-byte salt and 12-byte IV are generated with `crypto.getRandomValues()` for every single payload, they are never reused across uploads or file exports. The resulting ciphertext, salt, IV, KDF name, and iteration count are what actually reach Supabase or get written to `.cokz` files; the plaintext snapshot and your passphrase never do.

## Key derivation

Two separate values are derived from your passphrase, for two separate purposes:

| Purpose | Derivation | Iterations |
|---|---|---|
| Encryption key (AES-256-GCM) | PBKDF2-SHA-256 over the passphrase, with the payload's random salt | 250,000 |
| Auth hash (`x-sync-auth` header) | PBKDF2-SHA-256 over the passphrase, with a fixed salt of `CookieSync-Auth-v1:<sync_id>` | 50,000 |

These two derivations are intentionally different values with different salts, so having one doesn't give you the other. The auth hash exists purely so Supabase's row-level security can distinguish requests; it is not, and was never meant to be, a second encryption key. It's worth noting explicitly that 50,000 iterations is lower than the 250,000 used for the encryption key. That's a defensible tradeoff, since Supabase only ever sees ciphertext regardless of the auth hash, but a leaked auth hash is somewhat cheaper to attack offline than a leaked encrypted payload would be.

In **Offline Mode**, `.cokz` files use the 250,000-iteration key derivation directly and do not attach or embed `auth_hash` headers, ensuring offline payload files contain strictly ciphertext.

## Authentication and session isolation model

There are no user accounts. A "session" is a Sync ID (a random UUID) paired with a passphrase you choose. Whoever holds both can read, overwrite, or delete that row. The first successful write to a given Sync ID sets its `auth_hash`; every request after that, including reads, must present a header that matches it. If you lose the passphrase, the encrypted data on the server is not recoverable by any means built into this project.

**Offline Mode Session Teardown:** Offline mode enforces strict per-session isolation. Whenever an `offline.html` tab is closed or a new offline workspace tab is opened, the in-memory and local storage copies of the `.cokz` snapshot (`offlineSnapshot`) and imported site selections (`importedDomains`) are immediately wiped. If "Remember passphrase" is disabled, the session passphrase is also erased. Opening an offline tab always requires loading a fresh `.cokz` file.

## Browser trust assumptions

CookieSync assumes the browser's own `cookies` and `storage` APIs, and the Web Crypto implementation behind them, behave correctly and aren't being tampered with by something else running in the browser. It has no way to detect or defend against a malicious extension, a compromised browser build, or OS-level malware with access to the profile.

## What CookieSync protects against

- **A Supabase data breach, or a curious party with database access.** They see ciphertext, a non-reversible auth hash, and a timestamp. Recovering cookie values without the passphrase means attacking AES-256-GCM directly, not reading a database dump.
- **Network interception between your browser and Supabase.** The same ciphertext and auth hash are all that cross the wire; the passphrase and the encryption key derived from it never are.
- **Offline file leakage across browser restarts.** `.cokz` snapshots and site picker selections are purged on tab close/open, preventing persistent plaintext or decrypted site lists from accumulating on disk.

## What CookieSync does not protect against

- **A compromised device.** Malware or a malicious extension running alongside CookieSync can read the passphrase and decrypted cookies directly. No client-side tool can defend against that.
- **A weak or reused passphrase.** PBKDF2 at 250,000 iterations raises the cost of offline brute-forcing a captured ciphertext blob; it doesn't make brute-forcing impossible. Use something long and unique to this project.
- **Enabling "Remember passphrase on this device."** This writes the plaintext passphrase into `chrome.storage.local`, the browser's on-disk extension storage, not only into in-memory session storage. See [PRIVACY.md](./PRIVACY.md#what-the-remember-passphrase-option-actually-does) for exactly what that means. Leaving it off keeps the passphrase in memory only, at the cost of having to retype it more often.
- **The local cookie ledger.** Independently of encryption or Remember settings, the extension keeps an unencrypted local record of every cookie it has ever seen change in the browser, across every site, not only ones you've chosen to sync. This lives in `chrome.storage.local` and is described in full in [PRIVACY.md](./PRIVACY.md#what-is-stored). Anyone with access to that storage (a compromised device, again) can read it without needing your passphrase at all.
- **Anyone who obtains your Sync ID and passphrase together.** There's no second factor and no identity check. Treat both like a shared password, not like a public identifier.
- **The remote exposure window.** Encrypted payloads sit in your Supabase table until you delete them or, if the `pg_cron` extension is available on your project, until an hourly job purges rows older than 24 hours. That extension isn't guaranteed to be available on every plan or region, confirm it actually ran rather than assuming it did.
- **Anyone holding the shipped anon key.** It's embedded in the built extension and extractable by design, anon keys are meant to be client-side. Row-level security limits what a holder can do to rows scoped by `auth_hash`, but if you suspect your Supabase credentials leaked, rotate them and generate a new Sync ID.
- **A formal, independent security review.** None has happened. Use your own judgment about how much to trust this with an account you can't afford to lose.

## Known limitations in the current implementation

- The Chromium build has no way, from the popup, to clear its own local cookie ledger. Gecko / Firefox has a "Clear all local cookies" action that resets both the browser's cookies and the ledger; Chromium doesn't expose an equivalent.
- The manifests request the `alarms` permission, but no code in this repository currently calls the alarms API. It isn't a security issue on its own, just a permission that outlived whatever it was originally added for.

## Reporting a vulnerability

Please don't open a public GitHub issue for a security vulnerability. Use GitHub's private reporting instead: **Repository → Security tab → Report a vulnerability**.

This is a personal, best-effort project. There's no guaranteed response time, but security reports get priority over everything else. Please allow a reasonable window to fix and release before any public disclosure.

## Scope

**In scope:**
- Extension code under `src/` (encryption, cookie handling, message passing)
- The Supabase schema and RLS policies under `supabase_schema_queries/`
- The build and release pipeline (`scripts/`, `.github/workflows/`)

**Out of scope:**
- Vulnerabilities in Supabase, the browsers themselves, or the Web Crypto API, report those upstream
- Attacks that require a device the extension is already compromised on, no client-side tool can defend against that
- Published weaknesses of the underlying primitives (PBKDF2, AES-GCM) as primitives, as opposed to how this project applies them

## Supported versions

Only the latest tagged release gets security fixes. Please confirm an issue still exists on the latest release before reporting it.
