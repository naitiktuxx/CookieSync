import { applyCookieRecords, clearAllLocalCookies, cookieKey, cookieSiteDomain, readCookieRecords, removeDomainCookies, toCookieRecord, toDeletedCookieRecord } from "./cookies";
import { decryptJson, deriveAuthHash, encryptJson } from "./crypto";
import { cookieMatchesAllowedDomains, normalizeDomain } from "./domainAllowlist";
import { SupabaseCookieStore } from "./supabaseClient";
import { normalizeSupabaseUrl } from "./supabaseUrl";
import { getSessionStorage, getStorage, removeSessionStorage, setSessionStorage, setStorage } from "./browserApi";
import type { BrowserTarget, CookieRecord, CookieSnapshot, EncryptedPayload, ModeSettingsView, OfflineModeSettings, OnlineModeSettings, RemoteSiteOption, SettingsScope, StoredSettings, SyncDirection } from "./types";

declare const __BROWSER_TARGET__: BrowserTarget;

const SETTINGS_KEY = "settings";
const SESSION_PASSPHRASE_KEYS: Record<SettingsScope, string> = {
  online: "sessionPassphraseOnline",
  offline: "sessionPassphraseOffline"
};

interface LegacyStoredSettings {
  syncPassphrase?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncId?: string;
  rememberPassphrase?: boolean;
  autoSyncEnabled?: boolean;
  lastAutoSyncedDate?: string;
  importedDomains?: string[];
  lastSyncedAt?: number;
  deviceId?: string;
  cookieLedger?: Record<string, CookieRecord>;
  themePreference?: "dark" | "catppuccin";
  syncMode?: "online" | "offline";
}

export interface SyncResult {
  direction: SyncDirection;
  uploaded: boolean;
  downloaded: boolean;
  cookieCount: number;
  deletedCount: number;
  updatedAt: number;
}

export interface SaveConfigurationInput {
  settingsScope?: SettingsScope | "global";
  syncPassphrase?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncId?: string;
  rememberPassphrase?: boolean;
  autoSyncEnabled?: boolean;
  themePreference?: "dark" | "catppuccin";
  syncMode?: "online" | "offline";
}

export class CookieSyncEngine {
  private applyingRemote = false;
  private sessionPassphrases: Partial<Record<SettingsScope, string>> = {};
  private offlineSnapshot?: CookieSnapshot;

  async getSettings(scope: SettingsScope): Promise<ModeSettingsView> {
    await this.getOrHydratePassphrase(scope);
    const settings = await this.loadSettings();
    const modeSettings = getModeBucket(settings, scope);
    const hasPassphrase = Boolean(this.sessionPassphrases[scope]);

    const view: ModeSettingsView = {
      syncMode: settings.syncMode,
      themePreference: settings.themePreference,
      rememberPassphrase: Boolean(modeSettings.rememberPassphrase),
      syncPassphrase: this.sessionPassphrases[scope],
      hasPassphrase,
      lastSyncedAt: modeSettings.lastSyncedAt
    };

    if (scope === "online") {
      const online = modeSettings as OnlineModeSettings;
      view.supabaseUrl = online.supabaseUrl;
      view.supabaseAnonKey = online.supabaseAnonKey;
      view.syncId = online.syncId;
      view.autoSyncEnabled = online.autoSyncEnabled ?? false;

      if (!view.syncId && __BROWSER_TARGET__ === "chromium") {
        const syncId = generateSyncId();
        await this.saveSettings({
          ...settings,
          online: { ...online, syncId }
        });
        view.syncId = syncId;
      }
    }

    return view;
  }

  async saveConfiguration(input: SaveConfigurationInput): Promise<void> {
    const existing = await this.loadSettings();
    const scope = input.settingsScope ?? inferScopeFromInput(input);
    let nextSettings: StoredSettings = { ...existing };

    if (input.syncMode !== undefined && input.syncMode !== existing.syncMode) {
      this.sessionPassphrases = {};
      nextSettings.syncMode = input.syncMode;
    } else if (input.syncMode !== undefined) {
      nextSettings.syncMode = input.syncMode;
    }

    if (input.themePreference !== undefined) {
      nextSettings.themePreference = input.themePreference;
    }

    if (scope === "global") {
      await this.saveSettings(nextSettings);
      return;
    }

    const bucket = { ...getModeBucket(nextSettings, scope) };
    const passphraseProvided = input.syncPassphrase !== undefined;
    const passphraseToUse = passphraseProvided
      ? input.syncPassphrase
      : (this.sessionPassphrases[scope] ?? bucket.syncPassphrase);

    if (passphraseProvided) {
      this.sessionPassphrases[scope] = input.syncPassphrase;
    }

    const rememberPassphrase = input.rememberPassphrase !== undefined
      ? Boolean(input.rememberPassphrase)
      : Boolean(bucket.rememberPassphrase);

    bucket.rememberPassphrase = rememberPassphrase;
    bucket.syncPassphrase = rememberPassphrase ? passphraseToUse : undefined;

    const sessionKey = SESSION_PASSPHRASE_KEYS[scope];
    if (rememberPassphrase && passphraseToUse) {
      await setSessionStorage({ [sessionKey]: passphraseToUse });
    } else {
      await removeSessionStorage([sessionKey]);
    }

    if (scope === "online") {
      const online = bucket as OnlineModeSettings;
      if (input.supabaseUrl !== undefined) {
        online.supabaseUrl = input.supabaseUrl ? normalizeSupabaseUrl(input.supabaseUrl) : "";
      }
      if (input.supabaseAnonKey !== undefined) {
        online.supabaseAnonKey = input.supabaseAnonKey;
      }
      if (input.syncId !== undefined) {
        online.syncId = input.syncId;
      }
      if (input.autoSyncEnabled !== undefined) {
        online.autoSyncEnabled = Boolean(input.autoSyncEnabled);
      }
      nextSettings.online = online;
    } else {
      nextSettings.offline = bucket as OfflineModeSettings;
    }

    await this.saveSettings(nextSettings);
  }

  async exportOfflineCokz(): Promise<{ filename: string; content: string }> {
    const passphrase = await this.requirePassphrase("offline");
    const settings = await this.loadSettings();
    const deviceId = settings.deviceId ?? crypto.randomUUID();
    const snapshot = await this.createSnapshot(settings, deviceId, "offline");
    const encryptedPayload = await encryptJson(snapshot, passphrase);
    const dateStr = new Date().toISOString().slice(0, 10);
    return {
      filename: `cookiesync-${dateStr}.cokz`,
      content: JSON.stringify(encryptedPayload, null, 2)
    };
  }

  async parseOfflineCokz(fileContent: string): Promise<{ snapshot: CookieSnapshot; sites: RemoteSiteOption[] }> {
    const passphrase = await this.requirePassphrase("offline");

    let payload: unknown;
    try {
      payload = JSON.parse(fileContent);
    } catch {
      throw new Error("Invalid .cokz file: Failed to parse JSON.");
    }

    let snapshot: CookieSnapshot;
    try {
      snapshot = normalizeSnapshot(await decryptJson<CookieSnapshot>(payload as EncryptedPayload, passphrase));
      this.offlineSnapshot = snapshot;
      await setStorage({ offlineSnapshot: snapshot });
    } catch {
      throw new Error("Decryption Failed: Incorrect passphrase used for this .cokz file.");
    }

    const settings = await this.loadSettings();
    const importedDomains = settings.offline?.importedDomains ?? [];
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

  private async getOrHydrateOfflineSnapshot(): Promise<CookieSnapshot | undefined> {
    if (this.offlineSnapshot) {
      return this.offlineSnapshot;
    }
    const { offlineSnapshot } = await getStorage<{ offlineSnapshot?: CookieSnapshot }>(["offlineSnapshot"]);
    if (offlineSnapshot) {
      this.offlineSnapshot = offlineSnapshot;
    }
    return this.offlineSnapshot;
  }

  async getOfflineSites(): Promise<RemoteSiteOption[]> {
    const snapshot = await this.getOrHydrateOfflineSnapshot();
    if (!snapshot) {
      return [];
    }
    const settings = await this.loadSettings();
    const importedDomains = settings.offline?.importedDomains ?? [];
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

  async importOfflineDomains(domains: string[], providedSnapshot?: CookieSnapshot): Promise<SyncResult> {
    const settings = await this.loadSettings();
    const snapshot = providedSnapshot ?? (await this.getOrHydrateOfflineSnapshot());
    if (!snapshot) {
      throw new Error("No .cokz file loaded. Please load a .cokz file first.");
    }
    const normalizedDomains = normalizeDomains(domains);
    if (normalizedDomains.length === 0) {
      throw new Error("Select at least one site to import.");
    }

    const selectedRecords = snapshot.records.filter((record) => cookieMatchesAllowedDomains(record.domain, normalizedDomains));
    const importedCookieCount = await this.applyRecords(selectedRecords);

    const offline = settings.offline ?? defaultOfflineSettings();
    const importedDomains = Array.from(new Set([...(offline.importedDomains ?? []), ...normalizedDomains])).sort();
    await this.saveSettings({
      ...settings,
      offline: {
        ...offline,
        importedDomains,
        lastSyncedAt: snapshot.updatedAt
      }
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
    const settings = await this.loadSettings();
    if (settings.syncMode !== "online") {
      return false;
    }

    await this.getOrHydratePassphrase("online");
    const online = settings.online ?? defaultOnlineSettings();

    if (!online.autoSyncEnabled) {
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (online.lastAutoSyncedDate === today) {
      return false;
    }

    const direction = __BROWSER_TARGET__ === "chromium" ? "push" : "pull";
    try {
      await this.sync(direction);
      const updated = await this.loadSettings();
      const updatedOnline = updated.online ?? defaultOnlineSettings();
      await this.saveSettings({
        ...updated,
        online: {
          ...updatedOnline,
          lastAutoSyncedDate: today
        }
      });
      return true;
    } catch (error) {
      console.warn("Startup auto-sync skipped/failed:", error);
      return false;
    }
  }

  async getRemoteSites(): Promise<RemoteSiteOption[]> {
    await this.assertOnlineModeActive();
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
    const importedDomains = settings.online?.importedDomains ?? [];
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
    await this.assertOnlineModeActive();
    const settings = await this.loadSettings();
    const store = await this.getStore(settings);
    const existedBefore = Boolean(await store.downloadLatestPayload());
    const online = settings.online ?? defaultOnlineSettings();

    if (!existedBefore) {
      await this.saveSettings({
        ...settings,
        online: {
          ...online,
          lastSyncedAt: undefined
        }
      });
      return { deleted: false, wiped: false, missing: true };
    }

    const deleted = await store.deletePayload();
    if (deleted) {
      await this.saveSettings({
        ...settings,
        online: {
          ...online,
          cookieLedger: undefined,
          lastSyncedAt: undefined
        }
      });
      return { deleted: true, wiped: false, missing: false };
    }

    const config = requireConfiguredSettings(settings, await this.getOrHydratePassphrase("online"));
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
      online: {
        ...online,
        lastSyncedAt: undefined,
        cookieLedger: undefined
      }
    });
    return { deleted: false, wiped: true, missing: false };
  }

  async importDomains(domains: string[], options?: { deleteOnFetch?: boolean }): Promise<SyncResult> {
    await this.assertOnlineModeActive();
    const settings = await this.loadSettings();
    const normalizedDomains = normalizeDomains(domains);
    if (normalizedDomains.length === 0) {
      throw new Error("Select at least one site to import.");
    }

    const snapshot = await this.downloadSnapshot(settings);
    const selectedRecords = snapshot.records.filter((record) => cookieMatchesAllowedDomains(record.domain, normalizedDomains));
    const importedCookieCount = await this.applyRecords(selectedRecords);

    const online = settings.online ?? defaultOnlineSettings();
    const importedDomains = Array.from(new Set([...(online.importedDomains ?? []), ...normalizedDomains])).sort();
    await this.saveSettings({
      ...settings,
      online: {
        ...online,
        importedDomains,
        cookieLedger: {
          ...(online.cookieLedger ?? {}),
          ...toLedger(selectedRecords)
        },
        lastSyncedAt: snapshot.updatedAt
      }
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
    await this.assertOnlineModeActive();
    const settings = await this.loadSettings();
    const store = await this.getStore(settings);

    const deviceId = settings.deviceId ?? crypto.randomUUID();
    if (!settings.deviceId) {
      await this.saveSettings({ ...settings, deviceId });
    }

    if (direction === "pull") {
      const importedDomains = settings.online?.importedDomains ?? [];
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
    const scope = settings.syncMode === "offline" ? "offline" : "online";
    const bucket = getModeBucket(settings, scope);

    await this.saveSettings({
      ...settings,
      [scope]: {
        ...bucket,
        importedDomains: [],
        ...(scope === "online" ? { cookieLedger: undefined, lastSyncedAt: undefined } : { lastSyncedAt: undefined })
      }
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
    const scope = settings.syncMode === "offline" ? "offline" : "online";
    const bucket = getModeBucket(settings, scope);
    const importedDomains = (bucket.importedDomains ?? []).filter((d) => d !== normalized);

    await this.saveSettings({
      ...settings,
      [scope]: {
        ...bucket,
        importedDomains
      }
    });

    return { domain: normalized, removedCount };
  }

  async setPassphrase(scope: SettingsScope, syncPassphrase: string): Promise<void> {
    await this.saveConfiguration({
      settingsScope: scope,
      syncPassphrase,
      rememberPassphrase: (await this.loadSettings())[scope]?.rememberPassphrase
    });
  }

  async recordCookieChange(changeInfo: chrome.cookies.CookieChangeInfo): Promise<boolean> {
    if (this.applyingRemote) {
      return false;
    }

    const settings = await this.loadSettings();
    if (settings.syncMode !== "online") {
      return false;
    }

    const online = settings.online ?? defaultOnlineSettings();
    const changedAt = Date.now();
    const record = changeInfo.removed
      ? toDeletedCookieRecord(changeInfo.cookie, changedAt)
      : toCookieRecord(changeInfo.cookie, changedAt);
    await this.saveSettings({
      ...settings,
      online: {
        ...online,
        cookieLedger: {
          ...(online.cookieLedger ?? {}),
          [cookieKey(record)]: record
        }
      }
    });
    return true;
  }

  private async requirePassphrase(scope: SettingsScope): Promise<string> {
    const passphrase = await this.getOrHydratePassphrase(scope);
    if (!passphrase) {
      throw new Error("Set a sync passphrase first.");
    }
    return passphrase;
  }

  private async assertOnlineModeActive(): Promise<void> {
    const settings = await this.loadSettings();
    if (settings.syncMode !== "online") {
      throw new Error("Online mode is disabled. Switch to Online in the extension popup.");
    }
  }

  private async getOrHydratePassphrase(scope: SettingsScope): Promise<string | undefined> {
    if (this.sessionPassphrases[scope]) {
      return this.sessionPassphrases[scope];
    }

    const sessionKey = SESSION_PASSPHRASE_KEYS[scope];
    const session = await getSessionStorage<Record<string, string | undefined>>([sessionKey]);
    if (session[sessionKey]) {
      this.sessionPassphrases[scope] = session[sessionKey];
      return this.sessionPassphrases[scope];
    }

    const settings = await this.loadSettings();
    const bucket = getModeBucket(settings, scope);
    if (bucket.rememberPassphrase && bucket.syncPassphrase) {
      this.sessionPassphrases[scope] = bucket.syncPassphrase;
      await setSessionStorage({ [sessionKey]: bucket.syncPassphrase });
      return this.sessionPassphrases[scope];
    }

    return undefined;
  }

  private async downloadSnapshot(settings: StoredSettings): Promise<CookieSnapshot> {
    const config = requireConfiguredSettings(settings, await this.getOrHydratePassphrase("online"));
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
    const config = requireConfiguredSettings(settings, await this.getOrHydratePassphrase("online"));
    const snapshot = await this.createSnapshot(settings, deviceId, "online");
    const payload = await encryptJson(snapshot, config.passphrase);
    await store.uploadPayload(payload);

    const online = settings.online ?? defaultOnlineSettings();
    await this.saveSettings({
      ...settings,
      online: {
        ...online,
        cookieLedger: toLedger(snapshot.records),
        lastSyncedAt: snapshot.updatedAt
      },
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

  private async createSnapshot(settings: StoredSettings, deviceId: string, scope: SettingsScope): Promise<CookieSnapshot> {
    const online = settings.online ?? defaultOnlineSettings();
    const ledger = scope === "online" ? online.cookieLedger : undefined;
    const { records, ledger: normalizedLedger } = await readCookieRecords(ledger);
    const updatedAt = Math.max(Date.now(), newestRecordTime(records));

    if (scope === "online") {
      await this.saveSettings({
        ...settings,
        online: {
          ...online,
          cookieLedger: normalizedLedger
        },
        deviceId
      });
    }

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
    const config = requireConfiguredSettings(settings, await this.getOrHydratePassphrase("online"));
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
    const stored = await getStorage<{ [SETTINGS_KEY]?: StoredSettings | LegacyStoredSettings }>([SETTINGS_KEY]);
    return normalizeStoredSettings(stored[SETTINGS_KEY] ?? {});
  }

  private async saveSettings(settings: StoredSettings): Promise<void> {
    await setStorage({ [SETTINGS_KEY]: normalizeStoredSettings(settings) });
  }
}

interface RequiredSettings {
  url: string;
  anonKey: string;
  syncId: string;
  passphrase: string;
}

function inferScopeFromInput(input: SaveConfigurationInput): SettingsScope | "global" {
  if (input.syncMode !== undefined || input.themePreference !== undefined) {
    const hasModeFields = input.syncPassphrase !== undefined
      || input.rememberPassphrase !== undefined
      || input.supabaseUrl !== undefined
      || input.supabaseAnonKey !== undefined
      || input.syncId !== undefined
      || input.autoSyncEnabled !== undefined;
    if (!hasModeFields) {
      return "global";
    }
  }

  if (input.supabaseUrl !== undefined || input.supabaseAnonKey !== undefined || input.syncId !== undefined || input.autoSyncEnabled !== undefined) {
    return "online";
  }

  return "offline";
}

function defaultOnlineSettings(): OnlineModeSettings {
  return { autoSyncEnabled: false, importedDomains: [] };
}

function defaultOfflineSettings(): OfflineModeSettings {
  return { importedDomains: [] };
}

function getModeBucket(settings: StoredSettings, scope: SettingsScope): OnlineModeSettings | OfflineModeSettings {
  if (scope === "online") {
    return { ...defaultOnlineSettings(), ...settings.online };
  }
  return { ...defaultOfflineSettings(), ...settings.offline };
}

function normalizeStoredSettings(raw: StoredSettings | LegacyStoredSettings): StoredSettings {
  if (isMigratedSettings(raw)) {
    return {
      syncMode: raw.syncMode,
      themePreference: raw.themePreference,
      deviceId: raw.deviceId,
      online: { ...defaultOnlineSettings(), ...raw.online },
      offline: { ...defaultOfflineSettings(), ...raw.offline }
    };
  }

  const legacy = raw as LegacyStoredSettings;
  return {
    syncMode: legacy.syncMode,
    themePreference: legacy.themePreference,
    deviceId: legacy.deviceId,
    online: {
      ...defaultOnlineSettings(),
      syncPassphrase: legacy.syncPassphrase,
      rememberPassphrase: legacy.rememberPassphrase,
      supabaseUrl: legacy.supabaseUrl,
      supabaseAnonKey: legacy.supabaseAnonKey,
      syncId: legacy.syncId,
      autoSyncEnabled: legacy.autoSyncEnabled,
      lastAutoSyncedDate: legacy.lastAutoSyncedDate,
      importedDomains: legacy.importedDomains,
      lastSyncedAt: legacy.lastSyncedAt,
      cookieLedger: legacy.cookieLedger
    },
    offline: {
      ...defaultOfflineSettings()
    }
  };
}

function isMigratedSettings(raw: StoredSettings | LegacyStoredSettings): raw is StoredSettings {
  return Boolean((raw as StoredSettings).online !== undefined || (raw as StoredSettings).offline !== undefined);
}

function requireStoreSettings(settings: StoredSettings): Omit<RequiredSettings, "passphrase"> {
  const online = settings.online ?? defaultOnlineSettings();
  if (!online.supabaseUrl || !online.supabaseAnonKey || !online.syncId) {
    throw new Error("Set Supabase URL, anon key, and sync ID first.");
  }

  return {
    url: online.supabaseUrl,
    anonKey: online.supabaseAnonKey,
    syncId: online.syncId
  };
}

function requireConfiguredSettings(settings: StoredSettings, sessionPassphrase?: string): RequiredSettings {
  const storeSettings = requireStoreSettings(settings);
  const online = settings.online ?? defaultOnlineSettings();
  const passphrase = online.syncPassphrase ?? sessionPassphrase;
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
