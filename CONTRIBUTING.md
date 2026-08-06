# Contributing to CookieSync

Thank you for your interest in contributing to CookieSync. 

CookieSync is an open-source project built with TypeScript, WebExtensions APIs, and Web Crypto primitives. This document outlines development setup, build workflows, testing requirements, release processes, and core architectural principles.

---

## Development Environment

- **Node.js**: Version 20 LTS (matching the CI build environment).
- **Package Manager**: `npm` (v9 or later).
- **Supported Browsers for Development & Testing**:
  - Chromium-based: Chrome, Brave, Edge, Opera, Vivaldi.
  - Gecko-based: Firefox (Developer Edition, Nightly, or unbranded builds for unsigned extensions), Zen Browser, LibreWolf.

---

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/naitiktuxx/CookieSync.git
   cd CookieSync
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

---

## Building and Testing

CookieSync builds two target extension bundles from a single TypeScript source tree: a **Chromium Publisher** build and a **Firefox Receiver** build.

### Build Commands

- **Build extension targets**:
  ```bash
  npm run build
  ```
  Compiles TypeScript sources into `dist/chromium` (Manifest V3) and `dist/gecko` (Manifest V2).

- **Run type checks**:
  ```bash
  npm run typecheck
  ```
  Executes `tsc --noEmit` to verify type safety across the project.

- **Run unit tests**:
  ```bash
  npm test
  ```
  Runs the unit test suite under the native Node.js test runner using `esbuild`.

- **Package release bundles**:
  ```bash
  npm run package
  ```
  Compiles production builds, packages `CookieSync-Chromium-Host-v<version>.zip` and `CookieSync-Firefox-Receiver-v<version>.xpi` archives, calculates SHA-256 checksums into `SHA256SUMS.txt`, and generates versioned release notes (`RELEASE_NOTES.md`) via `scripts/generate-changelog.mjs`.

> [!NOTE]
> **CI & Test Automation**: Release CI (`.github/workflows/release.yml`) is triggered on release tags (`v*`) and runs `npm run typecheck` along with packaging verification. Unit tests (`npm test`) run locally during development; contributors must ensure all unit tests pass locally before submitting pull requests.

---

## Codebase Organization

The project separates extension manifests, core TypeScript sources, and build scripts:

```text
CookieSync/
├── manifests/
│   ├── chromium.json       # Manifest V3 (Chromium Publisher target)
│   └── gecko.json          # Manifest V2 (Firefox Receiver target)
├── src/
│   ├── background/         # Event listeners, Cookie Ledger tracking, startup auto-sync
│   ├── offline/            # Offline Workspace interface (.cokz file handler)
│   ├── popup/              # Popup UI, settings form, domain selector, activity log
│   └── shared/
│       ├── browserApi.ts           # Extension API wrapper for MV3 and MV2 targets
│       ├── cookies.ts              # Cookie reading, writing, and attribute parsing
│       ├── cookies.test.ts         # Unit tests for cookie conversion and application
│       ├── crypto.ts               # AES-256-GCM encryption & PBKDF2 key derivation
│       ├── crypto.test.ts          # Unit tests for Web Crypto functions and KDFs
│       ├── defaultConfig.ts       # Default configuration constants
│       ├── domainAllowlist.ts      # Domain matching and family expansion rules
│       ├── domainAllowlist.test.ts # Unit tests for domain normalization and matching
│       ├── supabaseClient.ts       # REST client for Supabase table operations
│       ├── supabaseUrl.ts          # REST endpoint URL utility helper
│       ├── syncEngine.ts           # Central engine orchestrating state and workflows
│       ├── syncEngine.test.ts      # Unit tests for engine configuration and state
│       └── types.ts                # Shared TypeScript interfaces and type definitions
└── scripts/
    ├── build.mjs               # Compiles dist/chromium and dist/gecko targets
    ├── package.mjs             # Packages release archives, checksums, and release notes
    ├── sync-versions.mjs       # Version synchronization utility
    └── generate-changelog.mjs  # Extracts git commits into RELEASE_NOTES.md
```

---

## Core Project Principles

When contributing changes to CookieSync, adhere to these project principles:

1. **Preserve Security & Privacy Guarantees**:
   - Plaintext cookie data must **never** be transmitted over any network connection.
   - All payload encryption must remain client-side (AES-256-GCM with PBKDF2-SHA-256 key derivation).
   - Authentication hashes (`x-sync-auth`) and payload encryption keys must use distinct salts and derivation parameters.

2. **Prefer Build-Time Target Separation Over Runtime Branching**:
   - Rely on the build-time constant `__BROWSER_TARGET__` (`"chromium"` or `"gecko"`) to compile specialized target artifacts rather than using runtime platform feature detection where possible.

3. **Avoid Unnecessary Abstraction**:
   - Keep WebExtensions API calls and Web Crypto operations direct, readable, and transparent. Avoid wrapper libraries that obscure browser API or cryptographic behavior.

4. **Explain Rationale, Trade-offs & Limitations**:
   - Maintain clear inline documentation explaining *why* design decisions were made, *why* specific trade-offs were accepted, and *where* limitations reside.

5. **Maintain Technical Honesty & Documentation Quality**:
   - Keep documentation calm, factual, and technically accurate. Avoid marketing buzzwords, AI clichés, and unverified claims.

---

## Submitting Pull Requests

1. Fork the repository and create a feature branch off `main`.
2. Verify that `npm run typecheck` and `npm test` pass cleanly.
3. Commit your changes with clear, descriptive commit messages.
4. Push to your fork and submit a Pull Request describing your changes and rationale.

---

## Release Notes & Changelogs

Full release notes for each release are generated automatically during packaging (`scripts/generate-changelog.mjs`) and attached to GitHub Releases. You can inspect previous release notes on the [GitHub Releases](https://github.com/naitiktuxx/CookieSync/releases) page.

---

## Security Vulnerabilities

Please **do not** open public GitHub issues for security vulnerabilities. Refer to [SECURITY.md](./SECURITY.md#reporting-a-vulnerability) for instructions on submitting private security advisories.
