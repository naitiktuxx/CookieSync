# CookieSync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Sync selected cookies between two browsers through your own Supabase project. Cookies are encrypted before they leave the browser, and Supabase never sees anything but ciphertext.

### Contents
- [What this is](#what-this-is)
- [Key features](#key-features)
- [Architecture overview](#architecture-overview)
- [Security overview](#security-overview)
- [Installation](#installation)
  - [From a GitHub release](#from-a-github-release)
  - [Build from source](#build-from-source)
- [Usage](#usage)
- [Supabase setup](#supabase-setup)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What this is

CookieSync is a pair of browser extensions built from one codebase: a **Chromium** build (for Chrome, Brave, Edge, Arc, Opera, Vivaldi) and a **Gecko** build (for Firefox, LibreWolf, Zen Browser, Waterfox). The Chromium build uploads an encrypted copy of your cookies to a Supabase table you control. The Gecko build downloads that same encrypted blob, decrypts it locally, and lets you choose which sites' cookies actually get written into your browser.

It exists for the ordinary case of wanting to carry a logged-in session from one browser to another without exporting cookies to a plaintext file and emailing them to yourself.

## Key features

- **Client-side encryption.** Cookie data is encrypted with AES-256-GCM before it ever leaves the browser, using a key derived from your passphrase (PBKDF2-SHA-256, 250,000 iterations).
- **Self-hosted backend.** You point the extension at your own Supabase project. There's no shared server and no account system, just a URL, an anon key, a generated Sync ID, and a passphrase you choose.
- **Upload is all-or-nothing, import is selective.** The Chromium build encrypts and uploads the browser's entire cookie set in one payload. The Gecko build lets you pick exactly which domains from that payload get written back into the browser. See [PRIVACY.md](./PRIVACY.md) for what that means in practice.
- **Dual Theme Support (Dark & Catppuccin).** Single-click theme toggle in the header, supporting both Deep Dark mode (default) and Catppuccin mode in both Chromium and Gecko builds.
- **Optional daily auto-sync.** Off by default. When enabled, it runs once per calendar day on browser startup.
- **Activity log.** The popup keeps a small expandable log of every sync attempt, with the underlying Supabase error message shown rather than hidden.

## Architecture overview

One TypeScript source tree, built twice:

```text
CookieSync/
├── manifests/
│   ├── chromium.json   # Manifest V3, for the publisher build (Chromium)
│   └── gecko.json      # Manifest V2, for the consumer build (Gecko)
├── src/
│   ├── background/     # Message handling, cookie-change tracking, daily auto-sync
│   ├── popup/          # Settings form, site picker, activity log
│   └── shared/
│       ├── crypto.ts           # AES-GCM encryption, PBKDF2 key + auth-hash derivation
│       ├── cookies.ts          # Reading, writing, and diffing cookies
│       ├── domainAllowlist.ts  # Domain matching used at import time
│       ├── supabaseClient.ts   # Thin REST client for one Supabase table
│       └── syncEngine.ts       # Ties the above together
├── supabase_schema_queries/    # SQL for the table and its RLS policies
└── scripts/build.mjs           # Builds dist/chromium and dist/gecko
```

`scripts/build.mjs` compiles the same source twice, once per manifest, and bakes a `__BROWSER_TARGET__` constant of `"chromium"` or `"gecko"` into each bundle at build time. Which role an installed copy plays (publisher or consumer) is fixed by which bundle you installed, not something you switch at runtime.

The background script runs in both builds. It listens for every cookie change in the browser and records it into a local ledger (used to build sync snapshots and detect deletions), answers messages from the popup, and optionally triggers one auto-sync per day on startup. The popup talks to it entirely through `chrome.runtime.sendMessage`.

On the Supabase side there's a single table, `cookie_sync`, holding one row per Sync ID: an encrypted payload, an auth hash, and a timestamp. Row-level security checks that a request's `x-sync-auth` header matches the row's stored hash before allowing read, write, or delete.

## Security overview

- Cookie payloads are encrypted client-side (AES-256-GCM, PBKDF2-SHA-256 key derivation at 250,000 iterations) before upload. Supabase stores ciphertext only.
- Your passphrase is never sent to Supabase. A separate value derived from it is sent as an auth header so Supabase's row-level security can tell requests apart, but that value can't be turned back into your passphrase or your encryption key.
- There's no account system. Access to a row is controlled entirely by knowing its Sync ID and passphrase, so treat both like a shared password.
- This project has not had an independent security audit.

The full threat model, including what's stored locally and what CookieSync can't protect against, is in [SECURITY.md](./SECURITY.md). What's stored, where, and for how long is in [PRIVACY.md](./PRIVACY.md). Read both before using this with an account you can't afford to lose.

## Installation

### From a GitHub release

Every tagged release publishes prebuilt bundles on the [Releases page](https://github.com/naitiktuxx/CookieSync/releases), so you don't need Node or npm to install it.

1. Download the file for your browser family:
   - **Chromium (Chrome, Brave, Edge, Arc, Vivaldi):** `cookie-sync-chromium-vX.Y.Z.zip`
   - **Gecko (Firefox, LibreWolf, Zen Browser):** `cookie-sync-gecko-vX.Y.Z.xpi` if one was published for that release (signed through Mozilla's API), otherwise `cookie-sync-gecko-vX.Y.Z.zip` (unsigned, temporary-load only)
2. Verify the download, since this handles session cookies:
   ```bash
   sha256sum -c checksums.txt --ignore-missing
   ```
3. **Chromium browsers:** unzip it, open `chrome://extensions` (or `brave://extensions`, `edge://extensions`), turn on Developer mode, click **Load unpacked**, and select the unzipped folder.
4. **Gecko / Firefox, signed `.xpi`:** open `about:addons`, click the gear icon, choose **Install Add-on From File**, select the `.xpi`.
5. **Gecko / Firefox, unsigned `.zip`:** unzip it, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `manifest.json` inside the unzipped folder.

> [!NOTE]
> Temporary add-ons in Firefox/Gecko disappear every time you restart the browser. Whether a signed `.xpi` is available depends on whether the repository's AMO signing secrets were configured for that release, check the release notes.

### Build from source

The CI workflow builds with Node.js 20; that's a safe version to match locally. `package.json` doesn't pin a minimum version, but anything reasonably current should work.

```bash
git clone https://github.com/naitiktuxx/CookieSync.git
cd CookieSync
npm install
npm run build:chromium
npm run build:gecko
```

This produces `dist/chromium` and `dist/gecko`. Load either the same way as a downloaded release build, steps 3 to 5 above.

Other scripts worth knowing about:
- `npm run typecheck`, runs `tsc --noEmit`.
- `npm test`, bundles the test files with esbuild and runs them under `node --test`. Coverage is currently limited to `crypto.ts`, `domainAllowlist.ts`, and a few pure helpers in `cookies.ts`, the sync engine itself has no automated tests yet.

## Usage

The popup is titled **CookieSync** in both builds. The Sync ID field label tells you which role a build plays: **Sync ID (Copy to Gecko)** for Chromium Publisher or **Sync ID (From Chromium)** for Gecko Consumer.

**Theme switching:** Click the theme toggle button in the top right of the header bar to switch between **Dark Mode** (default) and **Catppuccin Mode**. Your choice is saved automatically.

**Chromium, first-time setup:**
1. Open the popup and expand **Settings & Credentials**.
2. Enter your Supabase URL and anon key.
3. Enter a passphrase. Use something long and not reused elsewhere, it's the only thing standing between an attacker and your cookies if your Supabase project is ever exposed.
4. Click **Save**. A Sync ID is generated automatically the first time.
5. Click **Copy** next to the Sync ID and send it to yourself however you'd send a password.
6. Click **Upload cookies now**.

**Gecko / Firefox, first-time setup:**
1. Open the popup and expand **Settings & Credentials**.
2. Enter the same Supabase URL and anon key.
3. Paste the Sync ID from Chromium.
4. Enter the exact same passphrase, it's case-sensitive.
5. Click **Save**.
6. Click **Load sites**, tick the domains you want, then click **Import selected**.

**Daily auto-sync**, off by default. Turning it on makes the extension run one push (Chromium) or one pull of previously-imported domains (Gecko) the first time the browser starts each calendar day.

> [!IMPORTANT]
> Auto-sync needs the passphrase to be available at browser startup. If **Remember passphrase on this device** is off, the passphrase only lives in memory for as long as the background script stays loaded, which in Chromium-based browsers can be as little as a few seconds of inactivity. With Remember off, auto-sync will silently do nothing until you reopen the popup and re-enter the passphrase. There's no error shown for this, it fails quietly in the background. If you want auto-sync to actually run unattended, turn Remember on, and understand what that trades away, see [PRIVACY.md](./PRIVACY.md#what-the-remember-passphrase-option-actually-does).

**Clearing data:** Chromium has a **Delete server data** button that removes (or, if the delete is blocked, blanks) the Supabase row for the current Sync ID. Gecko / Firefox has a **Clear all local cookies** button, and a small delete icon next to each imported site, for removing cookies from the browser itself.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the **Project URL** and the **anon / public** key. Don't use the `service_role` key.
3. Open the **SQL Editor**, paste in the script from [`supabase_schema_queries/Supabase Queries.md`](./supabase_schema_queries/Supabase%20Queries.md), and run it. It creates the `cookie_sync` table, enables row-level security, and adds policies scoped to a matching `auth_hash` header.
4. The last part of that script schedules an hourly job that purges rows older than 24 hours, using the `pg_cron` extension. Not every Supabase plan or region has `pg_cron` available. If that line errors, the table and RLS policies are still created fine, you'll just be relying on the manual **Delete server data** button instead of automatic expiry.

> [!WARNING]
> Your Supabase URL and anon key aren't secret in the traditional sense, the anon key ships inside the built extension and is extractable by anyone who has it, but row-level security limits what it can actually do without also knowing a valid `auth_hash`. Still, don't publish them somewhere unrelated to this project, and rotate them from the Supabase dashboard if you ever suspect they've leaked.

## Troubleshooting

Click the **Activity Log** header at the bottom of the popup to see full error text.

| What you see | What's actually happening | What to do |
|---|---|---|
| `Decryption Failed: Incorrect passphrase used for this Sync ID.` | The passphrase in this browser doesn't match the one used to upload the data. | Re-enter the exact same passphrase in both browsers and save. |
| `No data accessible for this Sync ID. Either no cookies have been uploaded yet, or your Sync ID / Passphrase is incorrect.` | Either nothing has been pushed yet, or the Sync ID / passphrase pair doesn't match what's on the server. | Confirm the Chromium side has uploaded successfully, then double-check the Sync ID and passphrase match exactly. |
| `Database RLS Security Error (401/403): ...` | The row-level security policy rejected the request, usually because a different passphrase already owns this Sync ID. | Generate a new Sync ID, or delete the existing server row first. |
| `Database Table Missing (404): ...` | The `cookie_sync` table doesn't exist yet in this Supabase project. | Run the SQL script from [Supabase setup](#supabase-setup). |
| `Supabase Anon Key Error (401): ...` | The anon key saved in settings is wrong or has been rotated. | Copy the current anon key from Supabase's API settings page and re-save. |
| `Network/URL Error: Could not connect to Supabase. ...` | No internet connection, or the Supabase URL is malformed. | Check connectivity and confirm the URL looks like `https://your-ref.supabase.co`. |
| Auto-sync never seems to run | Most likely the passphrase isn't available at startup. | See the auto-sync note in [Usage](#usage). |

## License

MIT, see [LICENSE](./LICENSE).

This software is provided as is, without warranty of any kind. Read [SECURITY.md](./SECURITY.md) before relying on it for anything you'd be upset to lose.
