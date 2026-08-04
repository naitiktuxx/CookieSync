import { applyCookieRecords, clearAllLocalCookies, cookieKey, cookieSiteDomain, readCookieRecords, removeDomainCookies, toCookieRecord, toDeletedCookieRecord } from "./cookies";
import { decryptJson, deriveAuthHash, encryptJson } from "./crypto";
import { cookieMatchesAllowedDomains, normalizeDomain } from "./domainAllowlist";
import { SupabaseCookieStore } from "./supabaseClient";
import { normalizeSupabaseUrl } from "./supabaseUrl";
import { getSessionStorage, getStorage, removeSessionStorage, setSessionStorage, setStorage } from "./browserApi";
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

  async getSettings(): Promise<StoredSettings & { hasPassphrase?: boolean }> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const hasPassphrase = Boolean(this.sessionPassphrase);
    if (settings.syncId || __BROWSER_TARGET__ !== "chromium") {
      return { ...settings, hasPassphrase, syncPassphrase: this.sessionPassphrase };
    }

    const syncId = generateSyncId();
    await this.saveSettings({ ...settings, syncId });
    return { ...settings, syncId, hasPassphrase, syncPassphrase: this.sessionPassphrase };
  }

  async saveConfiguration(settings: Partial<Pick<StoredSettings, "syncPassphrase" | "supabaseUrl" | "supabaseAnonKey" | "syncId" | "rememberPassphrase" | "autoSyncEnabled" | "themePreference" | "syncMode">>): Promise<void> {
    const existing = await this.loadSettings();
    const passphraseToUse = settings.syncPassphrase !== undefined ? settings.syncPassphrase : (this.sessionPassphrase ?? existing.syncPassphrase);
    if (settings.syncPassphrase !== undefined) {
      this.sessionPassphrase = passphraseToUse;
    }

    const rememberPassphrase = settings.rememberPassphrase !== undefined ? Boolean(settings.rememberPassphrase) : Boolean(existing.rememberPassphrase);

    if (rememberPassphrase && passphraseToUse) {
      await setSessionStorage({ sessionPassphrase: passphraseToUse });
    } else {
      await removeSessionStorage(["sessionPassphrase"]);
    }

    await this.saveSettings({
      ...existing,
      ...settings,
      rememberPassphrase,
      syncPassphrase: rememberPassphrase ? passphraseToUse : undefined,
      supabaseUrl: settings.supabaseUrl !== undefined ? (settings.supabaseUrl ? normalizeSupabaseUrl(settings.supabaseUrl) : "") : existing.supabaseUrl,
      autoSyncEnabled: settings.autoSyncEnabled !== undefined ? Boolean(settings.autoSyncEnabled) : existing.autoSyncEnabled,
      syncMode: settings.syncMode !== undefined ? settings.syncMode : existing.syncMode
    });
  }

  async exportOfflineCokz(): Promise<{ filename: string; content: string }> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const passphrase = this.sessionPassphrase ?? settings.syncPassphrase;
    if (!passphrase) {
      throw new Error("Set a sync passphrase first.");
    }
    const deviceId = settings.deviceId ?? crypto.randomUUID();
    const snapshot = await this.createSnapshot(settings, deviceId);
    const encryptedPayload = await encryptJson(snapshot, passphrase);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `cookiesync-${dateStr}.cokz`;
    return {
      filename,
      content: JSON.stringify(encryptedPayload, null, 2)
    };
  }

  async parseOfflineCokz(fileContent: string): Promise<{ snapshot: CookieSnapshot; sites: RemoteSiteOption[] }> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const passphrase = this.sessionPassphrase ?? settings.syncPassphrase;
    if (!passphrase) {
      throw new Error("Set a sync passphrase first.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(fileContent);
    } catch {
      throw new Error("Invalid .cokz file: Failed to parse JSON.");
    }

    let snapshot: CookieSnapshot;
    try {
      snapshot = normalizeSnapshot(await decryptJson<CookieSnapshot>(payload as any, passphrase));
    } catch {
      throw new Error("Decryption Failed: Incorrect passphrase used for this .cokz file.");
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

    const sites: RemoteSiteOption[] = Array.from(counts.entries())
      .map(([domain, cookieCount]) => ({
        domain,
        cookieCount,
        imported: importedDomains.includes(domain)
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return { snapshot, sites };
  }

  async importOfflineDomains(snapshot: CookieSnapshot, domains: string[]): Promise<SyncResult> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const normalizedDomains = normalizeDomains(domains);
    if (normalizedDomains.length === 0) {
      throw new Error("Select at least one site to import.");
    }

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

  async runDailyStartupSyncIfNeeded(): Promise<boolean> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();

    // Default is OFF unless explicitly enabled by user
    if (!settings.autoSyncEnabled) {
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (settings.lastAutoSyncedDate === today) {
      return false; // Already synced once today on startup
    }

    const direction = __BROWSER_TARGET__ === "chromium" ? "push" : "pull";
    try {
      await this.sync(direction);
      const updated = await this.loadSettings();
      await this.saveSettings({
        ...updated,
        lastAutoSyncedDate: today
      });
      return true;
    } catch (error) {
      console.warn("Startup auto-sync skipped/failed:", error);
      return false;
    }
  }

  async getRemoteSites(): Promise<RemoteSiteOption[]> {
    await this.getOrHydratePassphrase();
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
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const store = await this.getStore(settings);
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

  async importDomains(domains: string[], options?: { deleteOnFetch?: boolean }): Promise<SyncResult> {
    await this.getOrHydratePassphrase();
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

    if (options?.deleteOnFetch) {
      try {
        const store = await this.getStore(settings);
        await store.deletePayload();
      } catch (error) {
        console.warn("Failed to delete remote payload after import:", error);
      }
    }

    return {
      direction: "pull",
      uploaded: false,
      downloaded: true,
      cookieCount: importedCookieCount,
      deletedCount: 0,
      updatedAt: snapshot.updatedAt
    };
  }

  async sync(direction: SyncDirection, options?: { deleteOnFetch?: boolean }): Promise<SyncResult> {
    await this.getOrHydratePassphrase();
    const settings = await this.loadSettings();
    const store = await this.getStore(settings);

    const deviceId = settings.deviceId ?? crypto.randomUUID();
    if (!settings.deviceId) {
      await this.saveSettings({ ...settings, deviceId });
    }

    if (direction === "pull") {
      const importedDomains = settings.importedDomains ?? [];
      if (importedDomains.length === 0) {
        return emptyResult("pull");
      }
      return this.importDomains(importedDomains, options);
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
    if (settings.rememberPassphrase) {
      await setSessionStorage({ sessionPassphrase: syncPassphrase });
    } else {
      await removeSessionStorage(["sessionPassphrase"]);
    }
    await this.saveSettings({
      ...settings,
      syncPassphrase: settings.rememberPassphrase ? syncPassphrase : undefined
    });
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

  private async getOrHydratePassphrase(): Promise<string | undefined> {
    if (this.sessionPassphrase) {
      return this.sessionPassphrase;
    }
    const session = await getSessionStorage<{ sessionPassphrase?: string }>(["sessionPassphrase"]);
    if (session.sessionPassphrase) {
      this.sessionPassphrase = session.sessionPassphrase;
      return this.sessionPassphrase;
    }
    const settings = await this.loadSettings();
    if (settings.rememberPassphrase && settings.syncPassphrase) {
      this.sessionPassphrase = settings.syncPassphrase;
      await setSessionStorage({ sessionPassphrase: settings.syncPassphrase });
      return this.sessionPassphrase;
    }
    return undefined;
  }

  private async downloadSnapshot(settings: StoredSettings): Promise<CookieSnapshot> {
    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const store = await this.getStore(settings);
    const payload = await store.downloadLatestPayload();
    if (!payload) {
      throw new Error("No data accessible for this Sync ID. Either no cookies have been uploaded yet, or your Sync ID / Passphrase is incorrect.");
    }

    try {
      return normalizeSnapshot(await decryptJson<CookieSnapshot>(payload, config.passphrase));
    } catch {
      throw new Error("Decryption Failed: Incorrect passphrase used for this Sync ID.");
    }
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

  private async getStore(settings: StoredSettings): Promise<SupabaseCookieStore> {
    await this.getOrHydratePassphrase();
    const config = requireConfiguredSettings(settings, this.sessionPassphrase);
    const authHash = await deriveAuthHash(config.passphrase, config.syncId);
    return new SupabaseCookieStore({ ...config, authHash });
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
    const settings = stored[SETTINGS_KEY] ?? {};
    return {
      autoSyncEnabled: false,
      ...settings
    };
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
  return crypto.randomUUID();
}
