export type BrowserTarget = "chromium" | "gecko";

export type SyncDirection = "push" | "pull" | "sync";

export type SettingsScope = "online" | "offline";

export interface OnlineModeSettings {
  syncPassphrase?: string;
  rememberPassphrase?: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncId?: string;
  autoSyncEnabled?: boolean;
  lastAutoSyncedDate?: string;
  importedDomains?: string[];
  lastSyncedAt?: number;
  cookieLedger?: Record<string, CookieRecord>;
}

export interface OfflineModeSettings {
  syncPassphrase?: string;
  rememberPassphrase?: boolean;
  importedDomains?: string[];
  lastSyncedAt?: number;
}

export interface StoredSettings {
  syncMode?: "online" | "offline";
  themePreference?: "dark" | "catppuccin";
  deviceId?: string;
  online?: OnlineModeSettings;
  offline?: OfflineModeSettings;
}

/** Flat view returned to a mode-specific UI. */
export interface ModeSettingsView {
  syncMode?: "online" | "offline";
  themePreference?: "dark" | "catppuccin";
  syncPassphrase?: string;
  rememberPassphrase?: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncId?: string;
  autoSyncEnabled?: boolean;
  lastSyncedAt?: number;
  hasPassphrase?: boolean;
}

export interface SerializableCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: chrome.cookies.SameSiteStatus;
  expirationDate?: number;
  storeId?: string;
}

export interface CookieRecord extends SerializableCookie {
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number;
}

export interface CookieSnapshot {
  schemaVersion: 2;
  version: number;
  updatedAt: number;
  sourceBrowser: BrowserTarget;
  deviceId: string;
  records: CookieRecord[];
}

export interface RemoteSiteOption {
  domain: string;
  cookieCount: number;
  imported: boolean;
}

export interface EncryptedPayload {
  schemaVersion: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}
