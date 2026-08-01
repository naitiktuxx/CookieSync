import type { EncryptedPayload } from "./types";
import { normalizeSupabaseUrl } from "./supabaseUrl";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  syncId: string;
  authHash?: string;
}

export class SupabaseCookieStore {
  constructor(private readonly config: SupabaseConfig) {}

  async downloadLatestPayload(): Promise<EncryptedPayload | null> {
    const url = this.endpoint(`/rest/v1/cookie_sync?sync_id=eq.${encodeURIComponent(this.config.syncId)}&select=payload&limit=1`);
    const response = await this.fetchSupabase(url);
    const rows = (await response.json()) as Array<{ payload?: EncryptedPayload }>;
    return rows[0]?.payload ?? null;
  }

  async uploadPayload(payload: EncryptedPayload): Promise<void> {
    const url = this.endpoint("/rest/v1/cookie_sync?on_conflict=sync_id");
    const body: Record<string, unknown> = {
      sync_id: this.config.syncId,
      payload,
      updated_at: new Date().toISOString()
    };
    if (this.config.authHash) {
      body.auth_hash = this.config.authHash;
    }

    await this.fetchSupabase(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(body)
    });
  }

  async deletePayload(): Promise<boolean> {
    const url = this.endpoint(`/rest/v1/cookie_sync?sync_id=eq.${encodeURIComponent(this.config.syncId)}&select=sync_id`);
    const response = await this.fetchSupabase(url, {
      method: "DELETE",
      headers: {
        Prefer: "return=representation"
      }
    });
    const rows = (await response.json()) as Array<{ sync_id?: string }>;
    return rows.length > 0;
  }

  private endpoint(path: string): string {
    return `${normalizeSupabaseUrl(this.config.url)}${path}`;
  }

  private async fetchSupabase(url: string, init: RequestInit = {}): Promise<Response> {
    const authHeaders: Record<string, string> = {
      apikey: this.config.anonKey,
      Authorization: `Bearer ${this.config.anonKey}`
    };
    if (this.config.authHash) {
      authHeaders["x-sync-auth"] = this.config.authHash;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...authHeaders,
          ...(init.headers ?? {})
        }
      });
    } catch {
      throw new Error("Network/URL Error: Could not connect to Supabase. Check your internet connection or Supabase URL.");
    }

    if (!response.ok) {
      const message = await response.text();
      if (response.status === 401 || response.status === 403) {
        if (message.includes("row-level security policy") || message.includes("42501")) {
          throw new Error("Database RLS Security Error (401/403): Server data for this Sync ID exists under a different passphrase. Solution: Click 'Delete database data' or generate a new Sync ID.");
        }
        if (message.includes("Invalid API key") || message.includes("JWT") || message.includes("apiKey")) {
          throw new Error("Supabase Anon Key Error (401): Invalid or expired Anon Key in settings.");
        }
        throw new Error(`Access Denied (${response.status}): Credentials or Passphrase rejected by Supabase.`);
      }
      if (response.status === 404 || message.includes("42P01")) {
        throw new Error("Database Table Missing (404): Table 'public.cookie_sync' does not exist in Supabase. Run the SQL setup script.");
      }
      throw new Error(`Supabase Request Error (${response.status}): ${message}`);
    }

    return response;
  }
}
