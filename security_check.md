{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # CookieSync \'97 Public Release Security Checklist\
\
Context: Browser extension that syncs cookie/session data between browsers (Chrome/Firefox/Brave) via a Supabase relay. One extension instance (host) uploads encrypted cookie data; another instance (receiver) pairs via a client ID + passkey and downloads it. Currently in personal testing phase with an `anon` key hardcoded in the extension for convenience. **Before public/open-source release, the items below must be addressed.**\
\
---\
\
## 1. Application-level encryption (client-side only)\
\
- Cookies must be encrypted **in the extension**, before the upload ever leaves the browser.\
- Use a proper AEAD cipher: **AES-256-GCM** (via Web Crypto API \'97 `crypto.subtle`). No homemade/XOR-style encryption.\
- Supabase should only ever receive and store **ciphertext**. It should never see plaintext cookie values or the raw passkey.\
- Encryption key must be **derived from the user's passkey using a KDF** (PBKDF2, or better, Argon2/scrypt if available) \'97 not the passkey used directly as a key.\
\
## 2. Passkey handling ("Remember passkey")\
\
- **Never store the raw passkey in plaintext** in `chrome.storage.local` or anywhere on disk.\
- If "remember" must be supported:\
  - Prefer OS-level secure storage if the extension platform exposes it.\
  - At minimum, store a derived value (not the raw passkey) and re-derive the encryption key from it in a way that limits reuse if leaked.\
- Server (Supabase) should **never receive or verify the raw passkey**. Passkey usage should stay entirely client-side (key derivation only). If a "does this passkey unlock this session" check is needed server-side, use a separate hashed value distinct from the actual encryption key \'97 never the key itself or the passkey.\
- Add rate-limiting / lockout on passkey attempts if it's short (e.g., PIN-length) to prevent brute-forcing.\
\
## 3. `sync_id` / client ID generation\
\
- Must be generated with a **cryptographically secure random generator**: `crypto.randomUUID()` (or `crypto.getRandomValues()`), not `Date.now()`, incrementing counters, or `Math.random()`.\
- Should be long enough to be non-guessable (UUID v4 / 128-bit is the standard, already sufficient).\
- Predictable/short IDs allow enumeration attacks \'97 even without breaking encryption, an attacker could locate, delete, or overwrite someone else's row.\
\
## 4. Row Level Security (RLS) \'97 currently wide open\
\
Current policies use `using (true)` / `with check (true)` for select, insert, update, and delete \'97 meaning **any holder of the anon key (extractable from the shipped extension) can read, overwrite, or delete any row, for any user.** This is fine for solo testing, but **must be fixed before public release**:\
\
- Preferred fix: route all reads/writes through a **Supabase Edge Function** instead of direct table access from the extension. The Edge Function holds the `service_role` key server-side and enforces ownership checks (matching client ID + auth proof) before touching any row. The extension never talks to the table directly.\
- If direct table access is kept, RLS policies must be scoped per-row (e.g., tied to a server-verified ownership token), not blanket `true`.\
\
## 5. Data lifecycle \'97 minimize exposure window\
\
- **Auto-expire uploaded data**: current 24hr auto-upload is fine, but add a TTL cleanup (Postgres scheduled job / Edge Function cron) to purge anything past 24hrs, including already-expired cookies.\
- **Delete-on-fetch**: once the receiver picks up a specific site's cookies, delete that row/entry immediately rather than leaving it available for repeat reads.\
\
## 6. Misc\
\
- Don't request `<all_urls>` host permission in the manifest unless strictly necessary \'97 scope it as tightly as possible; this is a major trust signal for an open-source extension asking for cookie access.\
- Document clearly in the README that cookies are session-equivalent to passwords \'97 users should understand the risk model before using the tool.\
\
---\
\
**Status legend for tracking:** mark each section done/in-progress as the public-release hardening work happens. Sections 1\'964 are the highest priority (they affect confidentiality/integrity of user data); 5\'966 are hardening/hygiene.\
}