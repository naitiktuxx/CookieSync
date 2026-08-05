// Mock extension API for node testing environment
const mockLocalStorage: Record<string, unknown> = {};
const mockSessionStorage: Record<string, unknown> = {};

(globalThis as unknown as Record<string, unknown>).__BROWSER_TARGET__ = "chromium";

(globalThis as unknown as Record<string, unknown>).chrome = {
  runtime: {},
  storage: {
    local: {
      get: (keys: string[] | null, cb: (res: Record<string, unknown>) => void) => {
        if (!keys) {
          cb({ ...mockLocalStorage });
          return;
        }
        const res: Record<string, unknown> = {};
        for (const k of keys) {
          if (k in mockLocalStorage) res[k] = mockLocalStorage[k];
        }
        cb(res);
      },
      set: (values: Record<string, unknown>, cb: () => void) => {
        Object.assign(mockLocalStorage, values);
        cb();
      }
    },
    session: {
      get: (keys: string[] | null, cb: (res: Record<string, unknown>) => void) => {
        if (!keys) {
          cb({ ...mockSessionStorage });
          return;
        }
        const res: Record<string, unknown> = {};
        for (const k of keys) {
          if (k in mockSessionStorage) res[k] = mockSessionStorage[k];
        }
        cb(res);
      },
      set: (values: Record<string, unknown>, cb: () => void) => {
        Object.assign(mockSessionStorage, values);
        cb();
      },
      remove: (keys: string[], cb: () => void) => {
        for (const k of keys) delete mockSessionStorage[k];
        cb();
      }
    }
  }
};

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CookieSyncEngine } from "./syncEngine";

describe("syncEngine settings & passphrase saving", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockLocalStorage)) delete mockLocalStorage[key];
    for (const key of Object.keys(mockSessionStorage)) delete mockSessionStorage[key];
  });

  it("should retain passphrase in session storage when rememberPassphrase is false", async () => {
    const engine = new CookieSyncEngine();
    await engine.saveConfiguration({
      settingsScope: "online",
      syncPassphrase: "mySecretPassphrase",
      rememberPassphrase: false,
      syncMode: "online"
    });

    // Check that local storage DOES NOT have the passphrase
    const stored = mockLocalStorage.settings as { online?: { syncPassphrase?: string } };
    assert.equal(stored.online?.syncPassphrase, undefined);

    // Check that session storage DOES have the passphrase
    assert.equal(mockSessionStorage.sessionPassphraseOnline, "mySecretPassphrase");

    // Re-instantiate engine (simulating service worker suspension/restart)
    const newEngine = new CookieSyncEngine();
    const settings = await newEngine.getSettings("online");

    assert.equal(settings.syncPassphrase, "mySecretPassphrase");
    assert.equal(settings.hasPassphrase, true);
    assert.equal(settings.rememberPassphrase, false);
  });

  it("should save passphrase to local storage when rememberPassphrase is true", async () => {
    const engine = new CookieSyncEngine();
    await engine.saveConfiguration({
      settingsScope: "online",
      syncPassphrase: "persistentPassphrase",
      rememberPassphrase: true,
      syncMode: "online"
    });

    const stored = mockLocalStorage.settings as { online?: { syncPassphrase?: string; rememberPassphrase?: boolean } };
    assert.equal(stored.online?.syncPassphrase, "persistentPassphrase");
    assert.equal(stored.online?.rememberPassphrase, true);

    const newEngine = new CookieSyncEngine();
    const settings = await newEngine.getSettings("online");
    assert.equal(settings.syncPassphrase, "persistentPassphrase");
    assert.equal(settings.rememberPassphrase, true);
  });

  it("should clear passphrase from session and local storage when set to empty string", async () => {
    const engine = new CookieSyncEngine();
    await engine.saveConfiguration({
      settingsScope: "online",
      syncPassphrase: "initialPassphrase",
      rememberPassphrase: true,
      syncMode: "online"
    });

    await engine.saveConfiguration({
      settingsScope: "online",
      syncPassphrase: "",
      rememberPassphrase: true,
      syncMode: "online"
    });

    assert.equal(mockSessionStorage.sessionPassphraseOnline, undefined);
    const stored = mockLocalStorage.settings as { online?: { syncPassphrase?: string } };
    assert.equal(stored.online?.syncPassphrase, undefined);

    const newEngine = new CookieSyncEngine();
    const settings = await newEngine.getSettings("online");
    assert.equal(settings.syncPassphrase, undefined);
    assert.equal(settings.hasPassphrase, false);
  });

  it("should infer scope to active mode if settingsScope is omitted", async () => {
    const engine = new CookieSyncEngine();
    await engine.saveConfiguration({
      syncMode: "online",
      settingsScope: "global"
    });

    await engine.saveConfiguration({
      syncPassphrase: "onlineSecret",
      rememberPassphrase: true
    });

    const stored = mockLocalStorage.settings as { online?: { syncPassphrase?: string }; offline?: { syncPassphrase?: string } };
    assert.equal(stored.online?.syncPassphrase, "onlineSecret");
    assert.equal(stored.offline?.syncPassphrase, undefined);
  });

  it("should clear offline snapshot and imported domains when clearOfflineSession is called", async () => {
    const engine = new CookieSyncEngine();
    mockLocalStorage.offlineSnapshot = { schemaVersion: 2, version: 1, updatedAt: 1, sourceBrowser: "chromium", deviceId: "d1", records: [] };
    mockLocalStorage.settings = {
      syncMode: "offline",
      offline: { importedDomains: ["example.com"], lastSyncedAt: 100 }
    };

    await engine.clearOfflineSession();

    assert.equal(mockLocalStorage.offlineSnapshot, undefined);
    const stored = mockLocalStorage.settings as { offline?: { importedDomains?: string[]; lastSyncedAt?: number } };
    assert.deepEqual(stored.offline?.importedDomains, []);
    assert.equal(stored.offline?.lastSyncedAt, undefined);
  });
});
