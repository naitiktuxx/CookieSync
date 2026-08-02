# CookieSync — Cross-Browser Encrypted Cookie Sync Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A secure, high-performance WebExtensions project for syncing end-to-end encrypted browser session cookies between browsers (e.g., Brave/Chromium to Firefox) via a self-hosted or cloud Supabase backend.

---

## 📌 Table of Contents (Rooprekha / Table of Contents)

Click any item below to auto-scroll directly to that section:

1. [Overview & Key Features](#1-overview--key-features)
2. [Project Architecture & Directory Structure](#2-project-architecture--directory-structure)
3. [Security Model & Zero-Knowledge Architecture](#3-security-model--zero-knowledge-architecture)
   - [3.4 Known Limitations & Threat Model](#34-known-limitations--threat-model)
4. [Complete Supabase Setup Wiki (Step-by-Step)](#4-complete-supabase-setup-wiki-step-by-step)
   - [4.1 Create a Free Supabase Project](#41-create-a-free-supabase-project)
   - [4.2 Obtain Supabase API Credentials](#42-obtain-supabase-api-credentials)
   - [4.3 Execute the Database & RLS Security Script](#43-execute-the-database--rls-security-script)
5. [Build & Installation Guide](#5-build--installation-guide)
   - [5.1 Build Requirements](#51-build-requirements)
   - [5.2 Building Extension Bundles](#52-building-extension-bundles)
   - [5.3 Installing in Brave / Chromium](#53-installing-in-brave--chromium)
   - [5.4 Installing in Firefox](#54-installing-in-firefox)
   - [5.5 Installing from GitHub Releases (Recommended for Non-Developers)](#55-installing-from-github-releases-recommended-for-non-developers)
6. [Extension Pairing & Usage Walkthrough](#6-extension-pairing--usage-walkthrough)
   - [6.1 Brave Setup (Publisher/Host)](#61-brave-setup-publisherhost)
   - [6.2 Firefox Setup (Consumer/Receiver)](#62-firefox-setup-consumerreceiver)
   - [6.3 Optional Daily Startup Auto-Sync](#63-optional-daily-startup-auto-sync)
7. [Comprehensive Error Reference & Troubleshooting Guide](#7-comprehensive-error-reference--troubleshooting-guide)
8. [License & Disclaimers](#8-license--disclaimers)

---

## 1. Overview & Key Features

CookieSync enables seamless session sync across different browsers while guaranteeing that **no plaintext cookie or passkey ever leaves your browser**:

- 🔒 **End-to-End Client Encryption**: Cookies are encrypted locally via **AES-256-GCM** using keys derived via **PBKDF2-SHA-256 (250,000 iterations)**.
- 🔑 **Zero-Knowledge Server Authentication**: Client requests pass a cryptographic token (`x-sync-auth`) derived via PBKDF2 (50,000 iterations) to satisfy Row-Level Security (RLS). Supabase never sees your raw passkey or AES key.
- 💾 **Non-Disk Session Storage**: Passkeys remembered for a session live strictly in `chrome.storage.session` (in-memory RAM), never written to disk, and automatically cleared when the browser closes.
- ⏱️ **Automatic 24-Hour TTL Expiry**: Database rows are automatically purged after 24 hours using PostgreSQL `pg_cron`.
- ⚡ **Read-Only Site Import & Manual Wipe**: Firefox imports selected domains without mutating server state; manual server wipe is available on demand.
- 🔄 **Optional Daily Startup Auto-Sync**: Disabled by default; when enabled, auto-syncs once per day on the browser's first boot of the day.
- ↕️ **Expandable Activity Console**: Built-in Activity Log box with detailed red error diagnosis and expandable UI height.

---

## 2. Project Architecture & Directory Structure

```text
CookieSync/
├── manifests/
│   ├── brave.json         # Manifest V3 configuration for Chromium / Brave
│   └── firefox.json       # WebExtensions manifest configuration for Firefox
├── src/
│   ├── background/
│   │   └── index.ts       # Service worker background event handling & daily startup trigger
│   ├── popup/
│   │   ├── popup.html     # Extension popup UI structure
│   │   ├── popup.css      # Custom styling, dark themes, responsive expandable console
│   │   └── popup.ts       # Popup event wiring, input validation, and log console UI
│   └── shared/
│       ├── browserApi.ts  # Cross-browser wrappers for storage, session storage, and cookies
│       ├── cookies.ts     # Cookie reading, serialization, URL construction, and deletion
│       ├── crypto.ts      # Web Crypto AES-256-GCM encryption & PBKDF2 auth token derivation
│       ├── supabaseClient.ts # Supabase REST API client with x-sync-auth header support
│       ├── syncEngine.ts  # Core CookieSyncEngine implementation (snapshot, push, pull)
│       └── types.ts       # TypeScript interfaces (StoredSettings, CookieSnapshot, etc.)
├── supabase_schema_queries/
│   └── Supabase Queries.md # Hardened PostgreSQL table schema & RLS policies
├── goal/
│   └── goal.md            # Project feature specs & architecture decisions
├── scripts/
│   └── build.mjs          # Target bundler script generating dist/brave and dist/firefox
└── package.json           # Node.js project configuration & build scripts
```

---

## 3. Security Model & Zero-Knowledge Architecture

> [!IMPORTANT]
> **Cookie Sensitivity Advisory**: Browser cookies grant session access equivalent to active passwords. Use CookieSync only with strong passphrases and a trusted Supabase database instance.

### Security Layers

1. **Client-Side Encryption**:
   - Web Crypto API (`crypto.subtle`) encrypts cookie JSON snapshots into ciphertext using AES-GCM 256-bit keys.
   - Salt (16 bytes) and IV (12 bytes) are generated randomly for every upload payload using `crypto.getRandomValues()`.
2. **Passkey Protection**:
   - The user's raw passkey is **never stored on disk or `chrome.storage.local`**.
   - If "Remember passphrase" is checked, the passkey is kept in `chrome.storage.session` (in-memory RAM), which is automatically erased when the browser closes.
3. **Zero-Knowledge RLS Authorization**:
   - Client derives `authHash` from `(passphrase, sync_id)` via PBKDF2-SHA-256 with salt `CookieSync-Auth-v1:<sync_id>`.
   - The hash is sent as an HTTP header (`x-sync-auth`). Supabase PostgreSQL RLS verifies `auth_hash = header`.
   - Supabase cannot reverse `x-sync-auth` to recover the original passphrase or AES key.

### 3.4 Known Limitations & Threat Model

This section exists so you can decide, with full information, how much you
trust CookieSync with your session cookies. Read it before using this with
accounts you can't afford to lose.

**Every CookieSync installation is self-hosted.** You create your own free
Supabase project and enter your own URL + anon key when you set it up.
Nothing is shared between different people's installations — there is no
central server, and no secret in this repository is meant to protect *your*
data. Your own Supabase URL, anon key, sync ID, and passphrase are the only
things that matter for your instance, and they're never committed to this
repo or shared with anyone else who clones it.

**What CookieSync protects against:**
- Someone with read access to your Supabase database (a breach, a curious
  admin, Supabase itself) sees only ciphertext — they cannot recover your
  cookies without your passphrase.
- Network interception between your browser and Supabase sees only
  ciphertext and a non-reversible auth hash, never your passphrase or
  encryption key.

**What CookieSync does *not* protect against:**
- **A compromised device.** If malware or a malicious extension has access
  to your browser, it can read your passphrase and decrypted cookies
  directly — no client-side encryption tool can defend against this.
- **A weak or reused passphrase.** The encryption key is derived from your
  passphrase via PBKDF2 (250,000 iterations). That raises the cost of
  offline brute-forcing a captured ciphertext blob, it doesn't eliminate
  it — use a long, unique passphrase you don't use anywhere else.
- **Anyone who obtains your Sync ID *and* passphrase.** Pairing is
  intentionally simple (no account system, no identity verification) — treat
  both like a shared password, and don't send them over an insecure channel.
- **The 24-hour exposure window.** Encrypted payloads persist in your
  Supabase table for up to 24 hours (automatic TTL cleanup) or until you
  manually wipe them. Treat this like leaving an encrypted backup online for
  a day, not an instant, ephemeral transfer.
- **Row-level write access from anyone holding your anon key.** The `anon`
  key is embedded in the built extension and is, by nature of being
  client-side, extractable. Row Level Security policies restrict what an
  anon-key holder can do to rows scoped by `auth_hash`, but if you ever
  suspect your anon key or Supabase credentials have leaked, rotate them in
  the Supabase dashboard immediately and generate a new Sync ID.
- **Formal security review.** This project has not been independently
  audited — see [SECURITY.md](./SECURITY.md) for the full disclaimer and how
  to report issues.

---

## 4. Complete Supabase Setup Wiki (Step-by-Step)

Follow these steps to set up your free Supabase database from scratch.

### 4.1 Create a Free Supabase Project

1. Go to [Supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New Project** and select your Organization.
3. Enter your project details:
   - **Name**: `CookieSync`
   - **Database Password**: Set a strong password
   - **Region**: Choose the region closest to you
4. Click **Create new project** and wait 1–2 minutes while Supabase initializes your database.

---

### 4.2 Obtain Supabase API Credentials

1. In your Supabase project dashboard, click **Project Settings** (gear icon at the bottom of the left sidebar).
2. Select **API** under Configuration.
3. Copy the following two credentials:
   - **Project URL**: Example: `https://xyzprojectref.supabase.co`
   - **`anon` / `public` API Key**: Example: `eyJhbGciOi...` *(Do NOT copy the service_role key).*

> [!WARNING]
> These credentials are yours alone. Never commit them to a git repository
> (including this one, if you fork it) and never share them publicly —
> anyone with your URL + anon key can interact with your `cookie_sync`
> table within the bounds of the RLS policies below.

---

### 4.3 Execute the Database & RLS Security Script

1. In your Supabase left sidebar, click **SQL Editor** (`>/_` icon).
2. Click **"+ New query"** at the top left.
3. Paste the complete SQL script from
   [`supabase_schema_queries/Supabase Queries.md`](./supabase_schema_queries/Supabase%20Queries.md)
   into the editor.
4. Click **"Run"** (`Cmd + Enter` / `Ctrl + Enter`).
5. Output should show `Success. No rows returned` or `schedule: 1`.

---

## 5. Build & Installation Guide

### 5.1 Build Requirements
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### 5.2 Building Extension Bundles

Install project dependencies and run build scripts:

```bash
# Install dependencies
npm install

# Build both Brave and Firefox targets
npm run build:brave
npm run build:firefox
```

The output directories will be generated in `dist/brave` and `dist/firefox`.

---

### 5.3 Installing in Brave / Chromium

1. Open Brave and navigate to `brave://extensions`.
2. Enable **Developer mode** (toggle switch at top right).
3. Click **Load unpacked**.
4. Select the `dist/brave` directory in your file picker.

---

### 5.4 Installing in Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `dist/firefox/manifest.json`.

> [!NOTE]
> Temporary add-ons in Firefox are removed every time you restart the
> browser. For a persistent install without building from source, use the
> signed release below instead.

---

### 5.5 Installing from GitHub Releases (Recommended for Non-Developers)

Every tagged release publishes pre-built bundles on the
[Releases page](../../releases) — you don't need Node.js or npm installed.

**Brave / Chromium:**
1. Download `cookie-sync-brave-vX.Y.Z.zip` from the latest release.
2. Unzip it.
3. Follow [5.3 Installing in Brave / Chromium](#53-installing-in-brave--chromium), selecting the unzipped folder in **Load unpacked**.

**Firefox:**
1. Download `cookie-sync-firefox-vX.Y.Z.xpi` from the latest release (a
   signed package, if available for that release — check the release notes).
2. Open `about:addons` → gear icon → **Install Add-on From File...** → select
   the `.xpi`.
3. If only the unsigned `cookie-sync-firefox-vX.Y.Z.zip` is available for a
   given release, it can only be loaded temporarily via
   [5.4](#54-installing-in-firefox) and will not persist across restarts.

**Verifying integrity (recommended, since this handles cookies):**
Every release includes a `checksums.txt`. Verify a download before
installing it:
```bash
sha256sum -c checksums.txt --ignore-missing
```

---

## 6. Extension Pairing & Usage Walkthrough

### 6.1 Brave Setup (Publisher/Host)

1. Open the CookieSync popup in Brave.
2. Expand **Supabase Credentials**.
3. Enter your **Supabase URL** and **Anon Key**.
4. Enter a strong **Sync Passphrase** (e.g., `MySecretKey123!`).
5. (Optional) Check **Remember passphrase on this device**.
6. Click **Save Configuration**.
7. Click **Copy** next to the generated **Sync ID**.
8. Click **Upload cookies now**.

---

### 6.2 Firefox Setup (Consumer/Receiver)

1. Open the CookieSync popup in Firefox.
2. Expand **Supabase Credentials**.
3. Enter the **same Supabase URL** and **same Anon Key**.
4. Paste the **Sync ID** copied from Brave.
5. Enter the **EXACT same Sync Passphrase** (case-sensitive).
6. Click **Save Configuration**.
7. Click **Load server sites** -> Tick the domains you wish to import -> Click **Import selected sites**.

---

### 6.3 Optional Daily Startup Auto-Sync

- **Default State**: OFF.
- **Enabling**: Check **"Auto sync once per day on browser startup"** in settings and click **Save Configuration**.
- **Behavior**: On your first browser startup/boot of the day, the extension automatically performs one sync (`push` on Brave, `pull` on Firefox for saved domains) and records today's date. Subsequent browser restarts on the same day skip auto-syncing.

---

## 7. Comprehensive Error Reference & Troubleshooting Guide

Click the header of the **Activity Log** console at the bottom of the extension popup to expand it and read full error details.

| Category / Icon | Error Message in Activity Log | Root Cause | Solution / Fix |
|---|---|---|---|
| **🔑 Passphrase Mismatch** | `Decryption Failed: Incorrect passphrase used for this Sync ID.` | The passphrase entered in Firefox does not match the passphrase used when uploading from Brave. | Enter the exact same (case-sensitive) Passphrase in both Brave and Firefox, then click **Save Configuration**. |
| **🔍 Access Denied / Mismatch** | `No data accessible for this Sync ID. Either no cookies have been uploaded yet, or your Sync ID / Passphrase is incorrect.` | Either Brave hasn't uploaded data yet, or the Sync ID / Passphrase in Firefox does not match Brave. | 1. Ensure Brave uploaded cookies successfully.<br>2. Copy the exact Sync ID from Brave and paste it in Firefox.<br>3. Ensure both browsers use identical Passphrases. |
| **🛡️ Database RLS Policy** | `Database RLS Error (401/403): Row-level security policy blocked access...` | Supabase Row-Level Security policy rejected the request, or table was created before RLS script. | Run the SQL setup script in Supabase SQL Editor (`Supabase Queries.md`) and execute `truncate table public.cookie_sync;`. |
| **🗄️ Missing Table** | `Database Table Missing (404): Table 'public.cookie_sync' does not exist...` | The table `public.cookie_sync` has not been created in your Supabase project. | Open Supabase Dashboard -> SQL Editor -> Run the table creation script in `Supabase Queries.md`. |
| **🔑 Invalid Anon Key** | `Supabase Anon Key Error (401): Invalid or expired Anon Key in settings.` | The Supabase Anon Key in extension settings is incorrect or expired. | Copy the project Anon Key from Supabase Dashboard -> Project Settings -> API, and paste it into extension settings. |
| **🌐 Network / URL Failure** | `Network/URL Error: Could not connect to Supabase. Check your internet connection...` | Computer is offline, or Supabase project URL is malformed/unreachable. | Check internet connectivity and verify the Supabase URL format (`https://your-ref.supabase.co`). |
| **⚠️ Incomplete Settings** | `Fill all settings first.` | One or more configuration fields (URL, Anon Key, Sync ID, Passphrase) are empty. | Expand **Supabase Credentials** and fill all fields before saving or syncing. |

---

## 8. License & Disclaimers

CookieSync is provided under the open-source MIT License (see [LICENSE](./LICENSE)). Use responsibly and ensure you adhere to session security best practices.

This software is provided "as is," without warranty of any kind. See
[SECURITY.md](./SECURITY.md) for the project's security scope, known
limitations, and how to report vulnerabilities.
