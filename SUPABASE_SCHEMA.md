# CookieSync - Supabase Database Setup & RLS Schema Guide

This document contains the complete SQL script and setup guide required to initialize your self-hosted Supabase database for **CookieSync**.

---

## 📋 Overview

CookieSync uses a single Supabase table (`public.cookie_sync`) to store client-encrypted cookie payloads. 

### Key Security Guarantees:
1. **Zero Plaintext Storage**: Only AES-256-GCM encrypted ciphertext payloads are saved.
2. **Row-Level Security (RLS)**: Scoped access policies enforce that reads, inserts, updates, and deletes require a matching `x-sync-auth` HTTP request header derived from your private passphrase.
3. **Automated 24-Hour TTL Expiry**: Stale cookie payloads are automatically purged after 24 hours using PostgreSQL cron tasks (when supported by your Supabase project tier).

---

## 🛠️ Step-by-Step Setup Guide

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **`anon` / `public` API key**
3. Navigate to **SQL Editor** from the left navigation menu.
4. Click **New Query**, paste the complete SQL script below into the editor, and click **Run**.

---

## 📜 Full SQL Setup Script

```sql
-- ============================================================================
-- CookieSync Hardened Supabase Schema & Row-Level Security (RLS) Setup
-- ============================================================================

-- 1. Create the cookie_sync table
CREATE TABLE IF NOT EXISTS public.cookie_sync (
  sync_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  auth_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure auth_hash column exists on existing/upgraded schemas
ALTER TABLE public.cookie_sync ADD COLUMN IF NOT EXISTS auth_hash TEXT;

-- Create index on updated_at for fast TTL cleanup operations
CREATE INDEX IF NOT EXISTS idx_cookie_sync_updated_at ON public.cookie_sync(updated_at);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.cookie_sync ENABLE ROW LEVEL SECURITY;

-- 3. Drop legacy or insecure open policies if present
DROP POLICY IF EXISTS "anon can read cookie sync" ON public.cookie_sync;
DROP POLICY IF EXISTS "anon can upsert cookie sync" ON public.cookie_sync;
DROP POLICY IF EXISTS "anon can update cookie sync" ON public.cookie_sync;
DROP POLICY IF EXISTS "anon can delete cookie sync" ON public.cookie_sync;
DROP POLICY IF EXISTS "Scoped read with auth header" ON public.cookie_sync;
DROP POLICY IF EXISTS "Scoped insert with auth header" ON public.cookie_sync;
DROP POLICY IF EXISTS "Scoped update with auth header" ON public.cookie_sync;
DROP POLICY IF EXISTS "Scoped delete with auth header" ON public.cookie_sync;

-- 4. Create scoped RLS policies requiring matching x-sync-auth header
CREATE POLICY "Scoped read with auth header"
ON public.cookie_sync
FOR SELECT
TO anon
USING (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

CREATE POLICY "Scoped insert with auth header"
ON public.cookie_sync
FOR INSERT
TO anon
WITH CHECK (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

CREATE POLICY "Scoped update with auth header"
ON public.cookie_sync
FOR UPDATE
TO anon
USING (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
)
WITH CHECK (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

CREATE POLICY "Scoped delete with auth header"
ON public.cookie_sync
FOR DELETE
TO anon
USING (
  auth_hash = (current_setting('request.headers', true)::json->>'x-sync-auth')
);

-- ============================================================================
-- 5. Automated 24-Hour TTL Cleanup (pg_cron)
-- ============================================================================

-- Enable pg_cron extension for hourly purging of rows older than 24 hours
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'purge-expired-cookie-syncs',
  '0 * * * *',
  $$ DELETE FROM public.cookie_sync WHERE updated_at < NOW() - INTERVAL '24 hours'; $$
);
```

---

## 🔍 Verification & Testing

To verify that your RLS policies are working properly from the Supabase SQL Editor:

### 1. Test Unauthorized Access (Should return 0 rows)
```sql
SELECT * FROM public.cookie_sync;
```

### 2. Manual Emergency Data Clear (If needed)
If you ever need to clear all synced cookie data manually from the Supabase dashboard:
```sql
TRUNCATE TABLE public.cookie_sync;
```

---

## ❓ Troubleshooting `pg_cron`

If running `CREATE EXTENSION IF NOT EXISTS pg_cron;` returns an error such as `extension "pg_cron" is not available`:
- **Reason**: Certain Supabase free tier regions or self-hosted PostgreSQL instances do not enable `pg_cron` by default.
- **Impact**: The table structure and RLS security policies will still work perfectly for sync uploads and downloads.
- **Alternative**: Expired records can be deleted directly from the extension UI using the **Delete server data** button in Chromium, or by running the `DELETE FROM public.cookie_sync WHERE updated_at < NOW() - INTERVAL '24 hours';` query manually in your SQL Editor when desired.
