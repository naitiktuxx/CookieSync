import { applyCookieRecords, clearAllLocalCookies, cookieKey, cookieSiteDomain, readCookieRecords, removeDomainCookies, toCookieRecord, toDeletedCookieRecord } from "./cookies";
import { decryptJson, encryptJson } from "./crypto";
import { cookieMatchesAllowedDomains, normalizeDomain } from "./domainAllowlist";
import { SupabaseCookieStore } from "./supabaseClient";
import { normalizeSupabaseUrl } from "./supabaseUrl";
import { getStorage, setStorage } from "./browserApi";
import type { BrowserTarget, CookieRecord, CookieSnapshot, RemoteSiteOption, StoredSettings, SyncDirection } from "./types";

declare const __BROWSER_TARGET__: BrowserTarget;

const SETTINGS_KEY = "settings";

export interface SyncResult {
  direction: SyncDirection;
  uploaded: boolean;
  downloaded: boolean;
  cookieCount: number;
  deletedCount: number;
  updatedAt: number;
}

export class CookieSyncEngine {
  private applyingRemote = false;
  private sessionPassphrase?: string;

  async getSettings(): Promise<StoredSettings> {
    const settings = await this.loadSettings();
    if (settings.syncId) {
      return settings;
    }

    const syncId = generateSyncId();
    await this.saveSettings({ ...settings, syncId });
    return { ...settings, syncId };
  }

  async saveConfiguration(settings: Pick<StoredSettings, "syncPassphrase" | "supabaseUrl" | "supabaseAnonKey" | "syncId" | "rememberPassphrase">): Promise<void> {
    const existing = await this.loadSettings();
    this.sessionPassphrase = settings.syncPassphrase;
    await this.saveSettings({
      ...existing,
      ...settings,
      syncPassphrase: settings.rememberPassphrase ? settings.syncPassphrase : undefined,
      supabaseUrl: settings.supabaseUrl ? normalizeSupabaseUrl(settings.supabaseUrl) : settings.supabaseUrl
    });
  }

  async getRemoteSites(): Promise<RemoteSiteOption[]> {
    const settings = await this.loadSettings();
    let snapshot: CookieSnapshot;
    try {
      snapshot = await this.downloadSnapshot(settings);
    } catch (error) {
      if (error instanceof Error && error.message === "No cookie upload found for this Sync ID yet.") {
        return [];
      }
      throw error;
    }
    const importedDomains = settings.importedDomains ?? [];
    const counts = new Map<string, number>();

    for (const record of snapshot.records) {
      if (record.deleted) {
        continue;
      }
      const domain = cookieSiteDomain(record);
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([domain, cookieCount]) => ({
        domain,
        cookieCount,
        imported: importedDomains.includes(domain)
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }

  async deleteRemoteData(): Promise<{ deleted: boolean; wiped: boolean; missing: boolean }> {
    const settings = await this.loadSettings();
    const storeSettings = requireStoreSettings(settings);
    const store = new SupabaseCookieStore(storeSettings);
    const existedBefore = Boolean(await store.downloadLatestPayload());
    if (!existedBefore) {
      await this.saveSettings({
        ...settings,
        lastSyncedAt: undefined
      });
      return { deleted: false, wiped: false, missing: true };
    }

    const deleted = await store.deletePayload();
    if (deleted) {
      await this.saveSettings({
        ...settings,
        cookieLedger: undefined,
        lastSyncedAt: undefined
      });
      return { deleted: true, wiped: false, missing: false };
    }

    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const deviceId = settings.deviceId ?? crypto.randomUUID();
    const updatedAt = Date.now();
    const emptySnapshot: CookieSnapshot = {
      schemaVersion: 2,
      version: updatedAt,
      updatedAt,
      sourceBrowser: __BROWSER_TARGET__,
      deviceId,
      records: []
    };
    await store.uploadPayload(await encryptJson(emptySnapshot, config.passphrase));
    await this.saveSettings({
      ...settings,
      deviceId,
      lastSyncedAt: undefined,
      cookieLedger: undefined
    });
    return { deleted: false, wiped: true, missing: false };
  }

  async importDomains(domains: string[]): Promise<SyncResult> {
    const settings = await this.loadSettings();
    const normalizedDomains = normalizeDomains(domains);
    if (normalizedDomains.length === 0) {
      throw new Error("Select at least one site to import.");
    }

    const snapshot = await this.downloadSnapshot(settings);
    const selectedRecords = snapshot.records.filter((record) => cookieMatchesAllowedDomains(record.domain, normalizedDomains));
    const importedCookieCount = await this.applyRecords(selectedRecords);

    const importedDomains = Array.from(new Set([...(settings.importedDomains ?? []), ...normalizedDomains])).sort();
    await this.saveSettings({
      ...settings,
      importedDomains,
      cookieLedger: {
        ...(settings.cookieLedger ?? {}),
        ...toLedger(selectedRecords)
      },
      lastSyncedAt: snapshot.updatedAt
    });

    return {
      direction: "pull",
      uploaded: false,
      downloaded: true,
      cookieCount: importedCookieCount,
      deletedCount: 0,
      updatedAt: snapshot.updatedAt
    };
  }

  async sync(direction: SyncDirection): Promise<SyncResult> {
    const settings = await this.loadSettings();
    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const store = new SupabaseCookieStore(config);

    const deviceId = settings.deviceId ?? crypto.randomUUID();
    if (!settings.deviceId) {
      await this.saveSettings({ ...settings, deviceId });
    }

    if (direction === "pull") {
      const importedDomains = settings.importedDomains ?? [];
      if (importedDomains.length === 0) {
        return emptyResult("pull");
      }
      return this.importDomains(importedDomains);
    }

    if (direction === "push") {
      return this.push(settings, deviceId, store);
    }

    return this.push(settings, deviceId, store);
  }

  async clearAllLocalCookies(): Promise<{ removedCount: number }> {
    const settings = await this.loadSettings();
    const removedCount = await clearAllLocalCookies();
    await this.saveSettings({
      ...settings,
      importedDomains: [],
      cookieLedger: undefined,
      lastSyncedAt: undefined
    });
    return { removedCount };
  }

  async clearDomainCookies(domain: string): Promise<{ domain: string; removedCount: number }> {
    const settings = await this.loadSettings();
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw new Error("Invalid domain.");
    }

    const removedCount = await removeDomainCookies(normalized);
    const importedDomains = (settings.importedDomains ?? []).filter((d) => d !== normalized);

    await this.saveSettings({
      ...settings,
      importedDomains
    });

    return { domain: normalized, removedCount };
  }

  async setPassphrase(syncPassphrase: string): Promise<void> {
    const settings = await this.loadSettings();
    this.sessionPassphrase = syncPassphrase;
    await this.saveSettings({ ...settings, syncPassphrase });
  }

  async recordCookieChange(changeInfo: chrome.cookies.CookieChangeInfo): Promise<boolean> {
    if (this.applyingRemote) {
      return false;
    }

    const settings = await this.loadSettings();
    const changedAt = Date.now();
    const record = changeInfo.removed
      ? toDeletedCookieRecord(changeInfo.cookie, changedAt)
      : toCookieRecord(changeInfo.cookie, changedAt);
    await this.saveSettings({
      ...settings,
      cookieLedger: {
        ...(settings.cookieLedger ?? {}),
        [cookieKey(record)]: record
      }
    });
    return true;
  }

  private async downloadSnapshot(settings: StoredSettings): Promise<CookieSnapshot> {
    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const store = new SupabaseCookieStore(config);
    const payload = await store.downloadLatestPayload();
    if (!payload) {
      throw new Error("No cookie upload found for this Sync ID yet.");
    }

    return normalizeSnapshot(await decryptJson<CookieSnapshot>(payload, config.passphrase));
  }

  private async push(settings: StoredSettings, deviceId: string, store: SupabaseCookieStore): Promise<SyncResult> {
    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const snapshot = await this.createSnapshot(settings, deviceId);
    const payload = await encryptJson(snapshot, config.passphrase);
    await store.uploadPayload(payload);

    await this.saveSettings({
      ...settings,
      cookieLedger: toLedger(snapshot.records),
      lastSyncedAt: snapshot.updatedAt,
      deviceId
    });

    return {
      direction: "push",
      uploaded: true,
      downloaded: false,
      cookieCount: countActive(snapshot.records),
      deletedCount: countDeleted(snapshot.records),
      updatedAt: snapshot.updatedAt
    };
  }

  private async createSnapshot(settings: StoredSettings, deviceId: string): Promise<CookieSnapshot> {
    const { records, ledger } = await readCookieRecords(settings.cookieLedger);
    const updatedAt = Math.max(Date.now(), newestRecordTime(records));
    await this.saveSettings({ ...settings, cookieLedger: ledger, deviceId });

    return {
      schemaVersion: 2,
      version: updatedAt,
      updatedAt,
      sourceBrowser: __BROWSER_TARGET__,
      deviceId,
      records
    };
  }

  private async applyRecords(records: CookieRecord[]): Promise<number> {
    this.applyingRemote = true;
    try {
      return await applyCookieRecords(records);
    } finally {
      this.applyingRemote = false;
    }
  }

  private async loadSettings(): Promise<StoredSettings> {
    const stored = await getStorage<{ [SETTINGS_KEY]?: StoredSettings }>([SETTINGS_KEY]);
    return stored[SETTINGS_KEY] ?? {};
  }

  private async saveSettings(settings: StoredSettings): Promise<void> {
    await setStorage({ [SETTINGS_KEY]: settings });
  }
}

interface RequiredSettings {
  url: string;
  anonKey: string;
  syncId: string;
  passphrase: string;
}

function requireStoreSettings(settings: StoredSettings): Omit<RequiredSettings, "passphrase"> {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !settings.syncId) {
    throw new Error("Set Supabase URL, anon key, and sync ID first.");
  }

  return {
    url: settings.supabaseUrl,
    anonKey: settings.supabaseAnonKey,
    syncId: settings.syncId
  };
}

function requireConfiguredSettings(settings: StoredSettings, sessionPassphrase?: string): RequiredSettings {
  const storeSettings = requireStoreSettings(settings);
  const passphrase = settings.syncPassphrase ?? sessionPassphrase;
  if (!passphrase) {
    throw new Error("Set a sync passphrase first.");
  }

  return {
    ...storeSettings,
    passphrase
  };
}

function normalizeSnapshot(snapshot: CookieSnapshot): CookieSnapshot {
  return {
    ...snapshot,
    schemaVersion: 2,
    records: snapshot.records ?? []
  };
}

function toLedger(records: CookieRecord[]): Record<string, CookieRecord> {
  return Object.fromEntries(records.map((record) => [cookieKey(record), record]));
}

function newestRecordTime(records: CookieRecord[]): number {
  return records.reduce((latest, record) => Math.max(latest, recordTimestamp(record)), 0);
}

function recordTimestamp(record: CookieRecord): number {
  return record.deletedAt ?? record.updatedAt;
}

function countActive(records: CookieRecord[]): number {
  return records.filter((record) => !record.deleted).length;
}

function countDeleted(records: CookieRecord[]): number {
  return records.filter((record) => record.deleted).length;
}

function normalizeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map((domain) => normalizeDomain(domain)).filter((domain): domain is string => Boolean(domain)))).sort();
}

function emptyResult(direction: SyncDirection): SyncResult {
  return {
    direction,
    uploaded: false,
    downloaded: false,
    cookieCount: 0,
    deletedCount: 0,
    updatedAt: Date.now()
  };
}

function generateSyncId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
