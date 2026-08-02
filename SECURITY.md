# Security Policy

CookieSync handles browser session cookies — data that is, for most sites,
equivalent to an active password. This document explains what protection
the project provides, what it does not, and how to report a problem.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use GitHub's private reporting:
**Repository → Security tab → "Report a vulnerability"**

If you'd rather not use GitHub's flow, email `<your-security-contact-email>`
with a description and, if possible, steps to reproduce.

This is a personal open-source project maintained on a best-effort basis —
there's no guaranteed SLA, but security reports will be prioritized over
everything else. Please give a reasonable window to fix and release a patch
before any public disclosure.

## Scope

**In scope:**
- The extension code (`src/**`) — encryption, cookie handling, message passing
- The Supabase schema and RLS policies (`supabase_schema_queries/`)
- The build/release pipeline (`scripts/`, `.github/workflows/`)

**Out of scope:**
- Vulnerabilities in Supabase itself, the browsers, or Web Crypto — report
  those upstream
- Attacks that require a compromised device the extension runs on (no
  client-side tool can defend against a compromised endpoint)
- Known, published weaknesses of the underlying primitives (PBKDF2, AES-GCM)
  themselves, as opposed to how this project uses them

## No formal audit

CookieSync has **not** undergone an independent third-party security audit.
The design choices are documented in the README's Security Model section,
and the code is open for review — but
"open source" is not a substitute for an audit. Use your own judgment about
how much you trust it with sensitive session data, especially before relying
on it for accounts you can't afford to lose.

## Supported versions

Only the latest tagged release is supported with security fixes. Please
upgrade before reporting an issue that may already be fixed.
