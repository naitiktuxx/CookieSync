import { extensionApi } from "../shared/browserApi";
import { CookieSyncEngine } from "../shared/syncEngine";
import type { BrowserTarget, CookieSnapshot, SyncDirection } from "../shared/types";

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

const registeredOfflineTabIds = new Set<number>();

function syncOfflineTabsOnStartup(): void {
  const offlineUrl = extensionApi.runtime?.getURL?.("offline.html");
  if (!offlineUrl || !extensionApi.tabs?.query) return;
  extensionApi.tabs.query({ url: offlineUrl }, (tabs) => {
    if (extensionApi.runtime?.lastError) return;
    for (const tab of tabs ?? []) {
      if (tab.id !== undefined) {
        registeredOfflineTabIds.add(tab.id);
      }
    }
  });
}
syncOfflineTabsOnStartup();

extensionApi.tabs?.onRemoved?.addListener((tabId) => {
  if (registeredOfflineTabIds.has(tabId)) {
    registeredOfflineTabIds.delete(tabId);
    if (registeredOfflineTabIds.size === 0) {
      void engine.clearOfflineSession().catch((error) => console.error("Failed to clear offline session on tab close:", error));
    }
  }
});

extensionApi.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  return true;
});

async function handleMessage(message: unknown, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  if (!isMessage(message)) {
    throw new Error("Unknown message.");
  }

  if (message.type === "register-offline-tab") {
    if (sender?.tab?.id !== undefined) {
      registeredOfflineTabIds.add(sender.tab.id);
    }
    return { registered: true };
  }

  if (message.type === "clear-offline-session") {
    await engine.clearOfflineSession();
    return { cleared: true };
  }

  if (message.type === "set-passphrase") {
    await engine.setPassphrase(message.settingsScope ?? "online", message.passphrase);
    return { saved: true };
  }

  if (message.type === "get-settings") {
    return engine.getSettings(message.settingsScope ?? "online");
  }

  if (message.type === "save-settings") {
    await engine.saveConfiguration({
      settingsScope: message.settingsScope,
      syncPassphrase: message.passphrase,
      supabaseUrl: message.supabaseUrl,
      supabaseAnonKey: message.supabaseAnonKey,
      syncId: message.syncId,
      rememberPassphrase: message.rememberPassphrase,
      autoSyncEnabled: message.autoSyncEnabled,
      themePreference: message.themePreference,
      syncMode: message.syncMode
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

  if (message.type === "get-offline-sites") {
    return engine.getOfflineSites();
  }

  if (message.type === "export-offline-cokz") {
    return engine.exportOfflineCokz();
  }

  if (message.type === "parse-offline-cokz") {
    return engine.parseOfflineCokz(message.fileContent);
  }

  if (message.type === "import-offline-domains") {
    return engine.importOfflineDomains(message.domains, message.snapshot);
  }

  if (message.type === "sync") {
    return engine.sync(message.direction);
  }

  return { ok: true };
}

function isMessage(
  message: unknown
): message is
  | { type: "sync"; direction: SyncDirection }
  | { type: "register-offline-tab" }
  | { type: "clear-offline-session" }
  | { type: "set-passphrase"; passphrase: string; settingsScope?: "online" | "offline" }
  | { type: "get-settings"; settingsScope?: "online" | "offline" }
  | { type: "save-settings"; settingsScope?: "online" | "offline" | "global"; passphrase?: string; supabaseUrl?: string; supabaseAnonKey?: string; syncId?: string; rememberPassphrase?: boolean; autoSyncEnabled?: boolean; themePreference?: "dark" | "catppuccin"; syncMode?: "online" | "offline" }
  | { type: "get-remote-sites" }
  | { type: "get-offline-sites" }
  | { type: "delete-remote-data" }
  | { type: "clear-domain-cookies"; domain: string }
  | { type: "clear-all-local-cookies" }
  | { type: "import-domains"; domains: string[] }
  | { type: "export-offline-cokz" }
  | { type: "parse-offline-cokz"; fileContent: string }
  | { type: "import-offline-domains"; domains: string[]; snapshot?: CookieSnapshot } {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as {
    type?: string;
    direction?: string;
    settingsScope?: unknown;
    passphrase?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    syncId?: string;
    rememberPassphrase?: unknown;
    autoSyncEnabled?: unknown;
    themePreference?: unknown;
    syncMode?: unknown;
    fileContent?: string;
    snapshot?: CookieSnapshot;
    domains?: unknown;
    domain?: unknown;
  };
  return (
    candidate.type === "register-offline-tab" ||
    candidate.type === "clear-offline-session" ||
    (candidate.type === "sync" && ["push", "pull", "sync"].includes(candidate.direction ?? "")) ||
    (candidate.type === "set-passphrase" && typeof candidate.passphrase === "string") ||
    candidate.type === "get-settings" ||
    candidate.type === "get-remote-sites" ||
    candidate.type === "get-offline-sites" ||
    candidate.type === "delete-remote-data" ||
    candidate.type === "clear-all-local-cookies" ||
    (candidate.type === "clear-domain-cookies" && typeof candidate.domain === "string") ||
    (candidate.type === "import-domains" && Array.isArray(candidate.domains)) ||
    candidate.type === "export-offline-cokz" ||
    (candidate.type === "parse-offline-cokz" && typeof candidate.fileContent === "string") ||
    (candidate.type === "import-offline-domains" && Array.isArray(candidate.domains)) ||
    candidate.type === "save-settings"
  );
}
