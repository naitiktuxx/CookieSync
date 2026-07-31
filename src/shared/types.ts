export type BrowserTarget = "brave" | "firefox";

export type SyncDirection = "push" | "pull" | "sync";

export interface StoredSettings {
  syncPassphrase?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncId?: string;
  rememberPassphrase?: boolean;
  importedDomains?: string[];
  lastSyncedAt?: number;
  deviceId?: string;
  cookieLedger?: Record<string, CookieRecord>;
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
