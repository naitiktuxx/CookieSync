import type { EncryptedPayload } from "./types";
import { normalizeSupabaseUrl } from "./supabaseUrl";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  syncId: string;
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
    await this.fetchSupabase(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        sync_id: this.config.syncId,
        payload,
        updated_at: new Date().toISOString()
      })
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
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${this.config.anonKey}`,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Supabase request failed: ${response.status} ${message}`);
    }

    return response;
  }
}
