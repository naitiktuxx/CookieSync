import { extensionApi } from "../shared/browserApi";
import { CookieSyncEngine } from "../shared/syncEngine";
import type { BrowserTarget, SyncDirection } from "../shared/types";

declare const __BROWSER_TARGET__: BrowserTarget;

const engine = new CookieSyncEngine();

// Run daily startup sync once per day on first browser boot (if enabled by user)
void engine.runDailyStartupSyncIfNeeded().catch((error) => console.error("Initial startup sync check failed", error));

extensionApi.runtime.onInstalled.addListener(() => {
  void engine.runDailyStartupSyncIfNeeded().catch((error) => console.error("Startup sync check failed", error));
});

extensionApi.runtime.onStartup?.addListener(() => {
  void engine.runDailyStartupSyncIfNeeded().catch((error) => console.error("Startup sync check failed", error));
});

extensionApi.cookies.onChanged.addListener((changeInfo) => {
  void engine.recordCookieChange(changeInfo).catch((error) => console.error("Cookie change tracking failed", error));
});

extensionApi.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  return true;
});

async function handleMessage(message: unknown): Promise<unknown> {
  if (!isMessage(message)) {
    throw new Error("Unknown message.");
  }

  if (message.type === "set-passphrase") {
    await engine.setPassphrase(message.passphrase);
    return { saved: true };
  }

  if (message.type === "get-settings") {
    return engine.getSettings();
  }

  if (message.type === "save-settings") {
    await engine.saveConfiguration({
      syncPassphrase: message.passphrase,
      supabaseUrl: message.supabaseUrl,
      supabaseAnonKey: message.supabaseAnonKey,
      syncId: message.syncId,
      rememberPassphrase: message.rememberPassphrase,
      autoSyncEnabled: message.autoSyncEnabled
    });
    return { saved: true };
  }

  if (message.type === "get-remote-sites") {
    return engine.getRemoteSites();
  }

  if (message.type === "import-domains") {
    return engine.importDomains(message.domains);
  }

  if (message.type === "delete-remote-data") {
    return engine.deleteRemoteData();
  }

  if (message.type === "clear-domain-cookies") {
    return engine.clearDomainCookies(message.domain);
  }

  if (message.type === "clear-all-local-cookies") {
    return engine.clearAllLocalCookies();
  }

  return engine.sync(message.direction);
}

function isMessage(
  message: unknown
): message is
  | { type: "sync"; direction: SyncDirection }
  | { type: "set-passphrase"; passphrase: string }
  | { type: "get-settings" }
  | { type: "save-settings"; passphrase: string; supabaseUrl: string; supabaseAnonKey: string; syncId: string; rememberPassphrase: boolean; autoSyncEnabled?: boolean }
  | { type: "get-remote-sites" }
  | { type: "delete-remote-data" }
  | { type: "clear-domain-cookies"; domain: string }
  | { type: "clear-all-local-cookies" }
  | { type: "import-domains"; domains: string[] } {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as {
    type?: string;
    direction?: string;
    passphrase?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    syncId?: string;
    rememberPassphrase?: unknown;
    autoSyncEnabled?: unknown;
    domains?: unknown;
    domain?: unknown;
  };
  return (
    (candidate.type === "sync" && ["push", "pull", "sync"].includes(candidate.direction ?? "")) ||
    (candidate.type === "set-passphrase" && typeof candidate.passphrase === "string") ||
    candidate.type === "get-settings" ||
    candidate.type === "get-remote-sites" ||
    candidate.type === "delete-remote-data" ||
    candidate.type === "clear-all-local-cookies" ||
    (candidate.type === "clear-domain-cookies" && typeof candidate.domain === "string") ||
    (candidate.type === "import-domains" && Array.isArray(candidate.domains)) ||
    (candidate.type === "save-settings" &&
      typeof candidate.passphrase === "string" &&
      typeof candidate.supabaseUrl === "string" &&
      typeof candidate.supabaseAnonKey === "string" &&
      typeof candidate.syncId === "string" &&
      typeof candidate.rememberPassphrase === "boolean")
  );
}
