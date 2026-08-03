# Privacy

This describes what CookieSync actually stores, uploads, and contacts, based on reading the code, not on what a privacy policy template says it should do. If something isn't covered here, it isn't happening in this project.

### Contents
- [What is stored](#what-is-stored)
- [Where it's stored, and for how long](#where-its-stored-and-for-how-long)
- [What the "Remember passphrase" option actually does](#what-the-remember-passphrase-option-actually-does)
- [What gets uploaded](#what-gets-uploaded)
- [What's encrypted, and what isn't](#whats-encrypted-and-what-isnt)
- [What never leaves the browser](#what-never-leaves-the-browser)
- [Analytics, telemetry, crash reporting](#analytics-telemetry-crash-reporting)
- [Third-party services](#third-party-services)
- [Permissions, in plain English](#permissions-in-plain-english)
- [Deleting your data](#deleting-your-data)
- [Uninstalling](#uninstalling)

## What is stored

Two kinds of things live in the extension's local storage:

**Settings.** Your Supabase URL and anon key, your Sync ID, whether "Remember passphrase" and daily auto-sync are turned on, the date auto-sync last ran, the list of domains you've imported, when you last synced, and a randomly generated device ID. None of this is cookie data itself.

**A local cookie ledger.** This is the part worth reading carefully. The extension listens for every cookie change event the browser reports, on every site, not only sites you've chosen to sync, and keeps a running record of each cookie's name, value, domain, path, and flags, keyed so that the latest known state of each distinct cookie is kept. This ledger is what gets turned into the encrypted snapshot on upload, and what lets the extension tell you which cookies have been deleted since the last sync.

In practice, this means the extension maintains an unencrypted local copy of the current value of every cookie set in your browser since you installed it, whether or not you've ever clicked Upload, and whether or not that site is one you actually intend to sync. Cookies that get deleted are recorded too, but with the value stripped out, only a tombstone marking that a deletion happened, not the value that was deleted.

If "Remember passphrase" is on, your passphrase is stored here as well. See [the section below](#what-the-remember-passphrase-option-actually-does) for what that specifically means.

## Where it's stored, and for how long

Settings and the cookie ledger live in `chrome.storage.local`, which is written to disk as part of the browser's extension storage for your profile. It isn't encrypted by the extension, and it isn't cleared automatically. It stays until you clear it yourself, uninstall the extension, or (for cookies specifically) use the local-clearing actions described under [Deleting your data](#deleting-your-data).

A passphrase entered without "Remember" checked is kept only in the background script's memory and mirrored into `chrome.storage.session`, which the browser itself clears when it closes. It is never written to `chrome.storage.local` in that case.

## What the "Remember passphrase" option actually does

With it off (the default), the passphrase lives only in memory for the current browser session. In Chromium-based browsers specifically, the background service worker can be shut down by the browser after a short period of inactivity, at which point that in-memory copy is gone and you'll need to type the passphrase again the next time you open the popup, not just after a full restart.

With it on, the passphrase is written in plaintext into `chrome.storage.local`, on disk, in addition to being kept in session memory. This is what lets it survive both service worker restarts and full browser restarts, which is also what daily auto-sync depends on to run unattended. The tradeoff is direct: anyone with read access to that profile's storage, through a compromised device, a browser profile backup, or forensic access to the disk, can read the passphrase without needing to break the encryption at all.

Turning Remember on is a reasonable choice for a personal device you already trust. It's a meaningfully different one on a shared or less-trusted machine.

## What gets uploaded

Uploading (the Brave build's "Upload cookies now") encrypts and sends the entire local cookie ledger described above, that is, every cookie currently in the browser across every site, not a filtered subset. There's no per-site opt-in on the upload side; "selective" only applies when importing.

Importing (the Firefox build) downloads that same encrypted payload, decrypts it locally, and shows you every domain found inside it before writing anything. Only the domains you tick get written into Firefox's actual cookie store; the rest of what was downloaded and decrypted is discarded in memory and never applied.

## What's encrypted, and what isn't

The payload that travels to and from Supabase is encrypted (AES-256-GCM, see [SECURITY.md](./SECURITY.md) for the details). Nothing stored locally, in `chrome.storage.local` or `chrome.storage.session`, is encrypted by the extension. That includes the settings, the cookie ledger, and, if Remember is on, the passphrase itself.

## What never leaves the browser

Your raw passphrase is never transmitted anywhere, to Supabase or otherwise. Only a value derived from it (the auth hash, used for Supabase's access control) is ever sent over the network.

## Analytics, telemetry, crash reporting

None of these exist in this codebase. There is no analytics library, no crash reporter, and no telemetry call anywhere in the source.

## Third-party services

Two, and only two, external hosts are contacted anywhere in this project:

- **The Supabase project you configure.** All cookie sync traffic goes here, and only here.
- **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`). The popup's HTML loads the "Plus Jakarta Sans" font from Google's font CDN every time it opens. This is unrelated to cookie syncing, it's just how the popup's typeface is served, but it does mean Google's CDN receives a request, and your IP address, whenever you open the popup.

Nothing else is contacted. There is no CookieSync-operated server of any kind.

## Permissions, in plain English

| Permission | What it's for |
|---|---|
| `cookies` | Reading, writing, and removing cookies through the browser's cookies API. This is the extension's entire purpose. |
| `storage` | Saving settings and the local cookie ledger, and optionally caching the passphrase in session storage. |
| `alarms` | Requested in the manifest, but nothing in the current code actually calls the alarms API. Daily auto-sync is driven by the extension's own startup and install events instead. |
| Host access to `http://*/*` and `https://*/*` | The cookies API requires matching host permissions to read or write a site's cookies. Since any site's cookies might need to be read (on upload) or written (on import), the permission covers all http/https pages rather than a fixed list of domains. |

## Deleting your data

**Cookies already written into the browser:** the Firefox build has a **Clear all local cookies** button that removes every cookie in the browser and resets the local ledger, and a small delete icon next to each site in the import list that clears just that domain's cookies. The Brave build doesn't currently expose an equivalent action from the popup.

**Local settings and the ledger:** clear the extension's storage from the browser's own extension management page, or uninstall the extension (see below).

**Data on Supabase:** the Brave build's **Delete server data** button removes the row for the current Sync ID outright, or, if the delete is blocked for some reason, overwrites it with an encrypted empty snapshot instead. You can also delete or truncate the row directly from Supabase's SQL editor. If the `pg_cron` extension is enabled on your project, rows older than 24 hours are purged automatically regardless.

## Uninstalling

Removing the extension clears its `chrome.storage.local` and `chrome.storage.session` data, this is standard browser behavior for any extension, not something CookieSync does specifically. That means the local ledger, saved settings, and any remembered passphrase go away with it.

Uninstalling does **not** touch cookies already written into the browser by a previous import, and does **not** touch anything already sitting in your Supabase table. If you want those gone too, clear them explicitly beforehand using the actions described under [Deleting your data](#deleting-your-data).
