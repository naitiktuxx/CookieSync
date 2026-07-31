import { extensionApi } from "../shared/browserApi";
import { CookieSyncEngine } from "../shared/syncEngine";
import type { BrowserTarget, SyncDirection } from "../shared/types";

declare const __BROWSER_TARGET__: BrowserTarget;

const SYNC_ALARM_NAME = "selected-site-cookie-sync";
const DAILY_SYNC_PERIOD_MINUTES = 24 * 60;
const engine = new CookieSyncEngine();

extensionApi.runtime.onInstalled.addListener(() => {
  if (__BROWSER_TARGET__ === "brave") {
    scheduleDailySync();
  }
});

extensionApi.runtime.onStartup?.addListener(() => {
  if (__BROWSER_TARGET__ === "brave") {
    scheduleDailySync();
  }
});

extensionApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME && __BROWSER_TARGET__ === "brave") {
    void engine.sync("push").catch((error) => console.error("Scheduled sync failed", error));
  }
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
      rememberPassphrase: message.rememberPassphrase
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
  | { type: "save-settings"; passphrase: string; supabaseUrl: string; supabaseAnonKey: string; syncId: string; rememberPassphrase: boolean }
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

function scheduleDailySync(): void {
  extensionApi.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: DAILY_SYNC_PERIOD_MINUTES,
    periodInMinutes: DAILY_SYNC_PERIOD_MINUTES
  });
}
