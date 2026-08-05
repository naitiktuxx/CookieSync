import { extensionApi } from "../shared/browserApi";
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from "../shared/defaultConfig";
import type { BrowserTarget, ModeSettingsView, RemoteSiteOption, SyncDirection } from "../shared/types";

declare const __BROWSER_TARGET__: BrowserTarget;

const title = document.querySelector<HTMLHeadingElement>("#title");
const syncIdLabel = document.querySelector<HTMLSpanElement>("#sync-id-label");
const supabaseUrlInput = document.querySelector<HTMLInputElement>("#supabase-url");
const supabaseAnonKeyInput = document.querySelector<HTMLInputElement>("#supabase-anon-key");
const syncIdInput = document.querySelector<HTMLInputElement>("#sync-id");
const passphraseInput = document.querySelector<HTMLInputElement>("#passphrase");
const togglePassphraseButton = document.querySelector<HTMLButtonElement>("#toggle-passphrase");
const rememberPassphraseInput = document.querySelector<HTMLInputElement>("#remember-passphrase");
const autoSyncEnabledInput = document.querySelector<HTMLInputElement>("#auto-sync-enabled");
const saveButton = document.querySelector<HTMLButtonElement>("#save-settings");
const copySyncIdButton = document.querySelector<HTMLButtonElement>("#copy-sync-id");
const loadSitesButton = document.querySelector<HTMLButtonElement>("#load-sites");
const selectAllSitesInput = document.querySelector<HTMLInputElement>("#select-all-sites");
const selectAllWrap = document.querySelector<HTMLLabelElement>("#select-all-wrap");
const expandSitesButton = document.querySelector<HTMLButtonElement>("#expand-sites");

const EXPAND_ICON_SVG = `<svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const COMPACT_ICON_SVG = `<svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;

function updateExpandSitesButton(): void {
  if (!expandSitesButton) return;
  const isExpanded = document.body.classList.contains("sites-expanded");
  const titleText = isExpanded ? "Compact list" : "Expand list";
  expandSitesButton.title = titleText;
  expandSitesButton.setAttribute("aria-label", titleText);
  expandSitesButton.innerHTML = isExpanded ? COMPACT_ICON_SVG : EXPAND_ICON_SVG;
}
const siteSearchInput = document.querySelector<HTMLInputElement>("#site-search");
const status = document.querySelector<HTMLDivElement>("#status");
const actionButtons = document.querySelectorAll<HTMLButtonElement>("[data-direction]");
const uploadButton = document.querySelector<HTMLButtonElement>("#upload-now");
const deleteRemoteDataButton = document.querySelector<HTMLButtonElement>("#delete-remote-data");
const clearAllCookiesButton = document.querySelector<HTMLButtonElement>("#clear-all-cookies");
const importButton = document.querySelector<HTMLButtonElement>("#import-now");
const sitePicker = document.querySelector<HTMLElement>("#site-picker");
const sitesContainer = document.querySelector<HTMLDivElement>("#sites");
const targetBadgeIcon = document.querySelector<HTMLDivElement>("#target-badge-icon");
const settingsSection = document.querySelector<HTMLElement>("#settings-section");
const settingsHeader = document.querySelector<HTMLDivElement>("#settings-header");
const settingsStatusBadge = document.querySelector<HTMLSpanElement>("#settings-status-badge");
const lastSyncedBox = document.querySelector<HTMLElement>("#last-synced-box");
const lastSyncedText = document.querySelector<HTMLElement>("#last-synced-text");
const statusFooter = document.querySelector<HTMLElement>("#status-footer");
const statusHeader = document.querySelector<HTMLElement>("#status-header");
const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle");
const modeOnlineButton = document.querySelector<HTMLButtonElement>("#mode-online");
const modeOfflineButton = document.querySelector<HTMLButtonElement>("#mode-offline");
const modeOnboardingOverlay = document.querySelector<HTMLDivElement>("#mode-onboarding-overlay");
const onboardOfflineBtn = document.querySelector<HTMLButtonElement>("#onboard-offline-btn");
const onboardOnlineBtn = document.querySelector<HTMLButtonElement>("#onboard-online-btn");
const offlinePanel = document.querySelector<HTMLElement>("#offline-panel");
const onlinePanel = document.querySelector<HTMLElement>("#online-panel");
const openOfflinePageButton = document.querySelector<HTMLButtonElement>("#open-offline-page");

let loadedSites: RemoteSiteOption[] = [];
let selectedDomains = new Set<string>();
let currentTheme: "dark" | "catppuccin" = "dark";
let currentMode: "online" | "offline" = "online";
let isExplicitlySaved = false;

function setMode(mode: "online" | "offline"): void {
  currentMode = mode;
  document.body.dataset.mode = mode;
  if (modeOnlineButton) {
    modeOnlineButton.classList.toggle("active", mode === "online");
  }
  if (modeOfflineButton) {
    modeOfflineButton.classList.toggle("active", mode === "offline");
  }

  if (mode === "online") {
    const supabaseUrl = supabaseUrlInput?.value.trim() ?? "";
    const supabaseAnonKey = supabaseAnonKeyInput?.value.trim() ?? "";
    const syncId = syncIdInput?.value.trim() ?? "";
    const passphrase = passphraseInput?.value.trim() ?? "";
    const isConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey) && Boolean(syncId) && Boolean(passphrase);
    const isRemembered = Boolean(rememberPassphraseInput?.checked);

    if (settingsStatusBadge) {
      if (isConfigured && isExplicitlySaved) {
        settingsStatusBadge.textContent = isRemembered ? "Passphrase Remembered ✓" : "Passphrase Set (Session)";
        settingsStatusBadge.className = "badge-status configured";
      } else {
        settingsStatusBadge.textContent = "Save Pass First";
        settingsStatusBadge.className = "badge-status setup";
      }
    }
  }

  updateModePanels();
  setupTargetUi();
}

function updateModePanels(): void {
  const isOffline = currentMode === "offline";
  if (offlinePanel) {
    offlinePanel.hidden = !isOffline;
  }
  if (onlinePanel) {
    onlinePanel.hidden = isOffline;
  }
}

function openOfflinePage(): void {
  const url = extensionApi.runtime.getURL("offline.html");
  window.open(url, "_blank");
}

function setTheme(theme: "dark" | "catppuccin"): void {
  currentTheme = theme;
  document.body.dataset.theme = theme;
  if (themeToggleButton) {
    const isDark = theme === "dark";
    themeToggleButton.title = isDark
      ? "Current: Dark Mode (Click for Catppuccin)"
      : "Current: Catppuccin Mode (Click for Dark)";
    themeToggleButton.setAttribute(
      "aria-label",
      isDark ? "Switch to Catppuccin theme" : "Switch to Dark theme"
    );
  }
}

function toggleTheme(): void {
  const newTheme = currentTheme === "dark" ? "catppuccin" : "dark";
  setTheme(newTheme);
  void sendMessage({ type: "save-settings", settingsScope: "global", themePreference: newTheme })
    .catch((error) => console.warn("Failed to save theme preference:", error));
}

function updateLastSyncedDisplay(timestamp?: number): void {
  if (lastSyncedBox) {
    lastSyncedBox.hidden = false;
  }

  if (!lastSyncedText) {
    return;
  }

  if (!timestamp) {
    lastSyncedText.textContent = "Never";
    return;
  }

  const date = new Date(timestamp);
  const formattedDate = date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  const formattedTime = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  lastSyncedText.textContent = `${formattedDate}, ${formattedTime}`;
}

setupTargetUi();
void loadSettings();

settingsHeader?.addEventListener("click", () => {
  const isExpanding = settingsSection?.classList.contains("collapsed");
  settingsSection?.classList.toggle("collapsed");
  if (isExpanding) {
    document.body.classList.remove("log-expanded");
    statusFooter?.classList.remove("expanded");
  }
});

statusHeader?.addEventListener("click", () => {
  const isExpandingLog = !document.body.classList.contains("log-expanded");
  document.body.classList.toggle("log-expanded");
  statusFooter?.classList.toggle("expanded");
  if (isExpandingLog && settingsSection) {
    settingsSection.classList.add("collapsed");
  }
});

// Password toggle helper
togglePassphraseButton?.addEventListener("click", () => {
  if (!passphraseInput) return;
  const isPassword = passphraseInput.type === "password";
  passphraseInput.type = isPassword ? "text" : "password";
  togglePassphraseButton.title = isPassword ? "Hide passphrase" : "Show passphrase";
});

saveButton?.addEventListener("click", () => {
  isExplicitlySaved = true;
  void saveSettingsFromForm({ silent: false }).catch(() => undefined);
});

// Auto-save on typing/change so unsaved input is never lost when popup closes
const autoSaveInputs = [supabaseUrlInput, supabaseAnonKeyInput, syncIdInput, passphraseInput];
for (const input of autoSaveInputs) {
  input?.addEventListener("input", () => {
    isExplicitlySaved = false;
    void saveSettingsFromForm({ silent: true }).catch(() => undefined);
  });
}
rememberPassphraseInput?.addEventListener("change", () => {
  void saveSettingsFromForm({ silent: true }).catch(() => undefined);
});
autoSyncEnabledInput?.addEventListener("change", () => {
  const isEnabled = Boolean(autoSyncEnabledInput.checked);
  void saveSettingsFromForm({ silent: true })
    .then(() => {
      addLog(`Daily startup auto-sync ${isEnabled ? "enabled" : "disabled"}.`, "info");
    })
    .catch(() => undefined);
});

async function saveSettingsFromForm({ silent }: { silent: boolean }): Promise<void> {
  if (currentMode !== "online") {
    return;
  }

  const passphrase = passphraseInput?.value ?? "";
  const supabaseUrl = supabaseUrlInput?.value.trim() ?? "";
  const supabaseAnonKey = supabaseAnonKeyInput?.value.trim() ?? "";
  const syncId = syncIdInput?.value.trim() ?? "";
  const rememberPassphrase = Boolean(rememberPassphraseInput?.checked);
  const autoSyncEnabled = Boolean(autoSyncEnabledInput?.checked);

  try {
    await sendMessage({
      type: "save-settings",
      settingsScope: "online",
      supabaseUrl,
      supabaseAnonKey,
      syncId,
      passphrase,
      rememberPassphrase,
      autoSyncEnabled,
      syncMode: "online"
    });

    const isFullyConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey) && Boolean(syncId) && Boolean(passphrase);

    if (settingsStatusBadge) {
      if (isFullyConfigured && isExplicitlySaved) {
        settingsStatusBadge.textContent = rememberPassphrase ? "Passphrase Remembered ✓" : "Passphrase Set (Session)";
        settingsStatusBadge.className = "badge-status configured";
      } else {
        settingsStatusBadge.textContent = "Save Pass First";
        settingsStatusBadge.className = "badge-status setup";
      }
    }
    if (!silent) {
      if (isFullyConfigured) {
        addLog(rememberPassphrase ? "Passphrase remembered for future sessions." : "Passphrase saved for current session.", "success");
        settingsSection?.classList.add("collapsed");
      } else {
        addLog("Partial online settings saved.", "success");
      }
    }
  } catch (error) {
    if (!silent) {
      addLog(String(error instanceof Error ? error.message : error), "error");
    }
  }
}

themeToggleButton?.addEventListener("click", toggleTheme);

modeOnlineButton?.addEventListener("click", () => {
  setMode("online");
  if (modeOnboardingOverlay) modeOnboardingOverlay.hidden = true;
  renderSites([]);
  void sendMessage({ type: "save-settings", settingsScope: "global", syncMode: "online" })
    .then(() => loadSettings())
    .catch(() => {});
});

modeOfflineButton?.addEventListener("click", () => {
  setMode("offline");
  if (modeOnboardingOverlay) modeOnboardingOverlay.hidden = true;
  void sendMessage({ type: "save-settings", settingsScope: "global", syncMode: "offline" })
    .then(() => loadSettings())
    .catch(() => undefined);
});

onboardOfflineBtn?.addEventListener("click", () => {
  setMode("offline");
  if (modeOnboardingOverlay) modeOnboardingOverlay.hidden = true;
  void sendMessage({ type: "save-settings", settingsScope: "global", syncMode: "offline" })
    .then(() => loadSettings())
    .catch(() => undefined);
});

openOfflinePageButton?.addEventListener("click", () => {
  openOfflinePage();
});

onboardOnlineBtn?.addEventListener("click", () => {
  setMode("online");
  if (modeOnboardingOverlay) modeOnboardingOverlay.hidden = true;
  renderSites([]);
  void sendMessage({ type: "save-settings", settingsScope: "global", syncMode: "online" })
    .then(() => loadSettings())
    .catch(() => {});
  addLog("Switched to Online Mode.", "info");
});

copySyncIdButton?.addEventListener("click", () => {
  const syncId = syncIdInput?.value.trim();
  if (!syncId) {
    addLog("No Sync ID to copy.", "error");
    return;
  }

  const origText = copySyncIdButton.querySelector("span")?.textContent ?? "Copy";

  const showSuccessFeedback = () => {
    const span = copySyncIdButton.querySelector("span");
    if (span) span.textContent = "Copied!";
    copySyncIdButton.classList.add("btn-success");
    setTimeout(() => {
      if (span) span.textContent = origText;
      copySyncIdButton.classList.remove("btn-success");
    }, 2000);
  };

  void navigator.clipboard
    .writeText(syncId)
    .then(() => {
      showSuccessFeedback();
      addLog("Sync ID copied. Paste it in Firefox.", "success");
    })
    .catch(() => {
      syncIdInput?.select();
      addLog("Sync ID selected. Copy it manually.", "warn");
    });
});

loadSitesButton?.addEventListener("click", () => {
  addLog("Loading server sites...");
  void saveSettingsFromForm({ silent: true })
    .then(() => sendMessage({ type: "get-remote-sites" }))
    .then((response) => {
      renderSites(response as RemoteSiteOption[]);
      addLog("Sites loaded.", "success");
    })
    .catch((error) => addLog(String(error.message ?? error), "error"));
});

deleteRemoteDataButton?.addEventListener("click", () => {
  const syncId = syncIdInput?.value.trim();
  if (!syncId) {
    addLog("No Sync ID selected.", "error");
    return;
  }

  if (!window.confirm(`Delete encrypted server data for Sync ID ${syncId}?`)) {
    addLog("Delete cancelled.", "warn");
    return;
  }

  addLog("Deleting server data...");
  void sendMessage({ type: "delete-remote-data" })
    .then((response) => {
      const result = response as { deleted?: boolean; wiped?: boolean; missing?: boolean };
      updateLastSyncedDisplay(undefined);
      if (result.deleted) {
        addLog("Server row deleted for this Sync ID.", "success");
        return;
      }
      if (result.wiped) {
        addLog("DELETE blocked, so encrypted cookie payload was wiped instead.", "warn");
        return;
      }
      if (result.missing) {
        addLog("No server data found for this Sync ID.", "warn");
        return;
      }
      addLog("No server row was deleted. Check Supabase DELETE policy.", "warn");
    })
    .catch((error) => addLog(String(error.message ?? error), "error"));
});

clearAllCookiesButton?.addEventListener("click", () => {
  if (!window.confirm("Are you sure you want to clear ALL local cookies in this browser?")) {
    addLog("Clear all cancelled.", "warn");
    return;
  }

  addLog("Clearing all local cookies...");
  void sendMessage({ type: "clear-all-local-cookies" })
    .then((response) => {
      const result = response as { removedCount: number };
      selectedDomains.clear();
      for (const site of loadedSites) {
        site.imported = false;
      }
      addLog(`Cleared ${result.removedCount} local cookies.`, "success");
      renderVisibleSites();
    })
    .catch((error) => addLog(String(error.message ?? error), "error"));
});

siteSearchInput?.addEventListener("input", () => {
  renderVisibleSites();
});

importButton?.addEventListener("click", () => {
  const selectedDomains = selectedSiteDomains();
  if (selectedDomains.length === 0) {
    addLog("Select at least one site.", "warn");
    return;
  }

  addLog(`Importing ${selectedDomains.length} site(s)...`);
  void saveSettingsFromForm({ silent: true })
    .then(() => sendMessage({ type: "import-domains", domains: selectedDomains }))
    .then((response) => {
      const res = response as { updatedAt?: number };
      addLog(formatResult(response), "success");
      updateImportVisibility();
      updateLastSyncedDisplay(res?.updatedAt ?? Date.now());
    })
    .catch((error) => addLog(String(error.message ?? error), "error"));
});

selectAllSitesInput?.addEventListener("change", () => {
  const checkboxes = Array.from(sitesContainer?.querySelectorAll<HTMLInputElement>("input[type='checkbox']") ?? []);
  const shouldSelect = Boolean(selectAllSitesInput.checked);
  for (const checkbox of checkboxes) {
    checkbox.checked = shouldSelect;
    if (shouldSelect) {
      selectedDomains.add(checkbox.value);
    } else {
      selectedDomains.delete(checkbox.value);
    }
  }
  updateSelectAllState();
  updateImportVisibility();
});

expandSitesButton?.addEventListener("click", () => {
  document.body.classList.toggle("sites-expanded");
  updateExpandSitesButton();
});

for (const button of Array.from(actionButtons)) {
  button.addEventListener("click", () => {
    const direction = button.dataset.direction as SyncDirection;
    addLog("Working...");
    void sendMessage({ type: "sync", direction })
      .then((response) => {
        addLog(formatResult(response), "success");
        if (direction === "push") {
          updateLastSyncedDisplay(Date.now());
        }
      })
      .catch((error) => addLog(String(error.message ?? error), "error"));
  });
}

function sendMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    extensionApi.runtime.sendMessage(message, (response?: { ok?: boolean; result?: unknown; error?: string }) => {
      const lastError = extensionApi.runtime?.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error ?? "Extension request failed."));
        return;
      }

      resolve(response.result);
    });
  });
}

function formatResult(response: unknown): string {
  const result = response as { uploaded?: boolean; downloaded?: boolean; cookieCount?: number; deletedCount?: number };
  const deleted = result.deletedCount ? `, ${result.deletedCount} deletions` : "";
  if (result.uploaded) {
    return `Uploaded ${result.cookieCount ?? 0} cookies${deleted}.`;
  }
  if (result.downloaded) {
    return `Downloaded ${result.cookieCount ?? 0} cookies${deleted}.`;
  }
  return "Nothing to sync.";
}

function addLog(message: string, level: "info" | "success" | "warn" | "error" = "info"): void {
  if (status) {
    const row = document.createElement("div");
    row.className = `log-line ${level}`;
    
    const timeSpan = document.createElement("span");
    timeSpan.style.fontSize = "10px";
    timeSpan.style.opacity = "0.6";
    const now = new Date();
    timeSpan.textContent = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;

    const textSpan = document.createElement("span");
    textSpan.textContent = message;

    row.append(timeSpan, textSpan);
    status.prepend(row);
  }
}

async function loadSettings(): Promise<void> {
  try {
    const settings = (await sendMessage({ type: "get-settings" })) as ModeSettingsView;
    setTheme(settings.themePreference ?? "dark");
    if (settings.syncMode) {
      setMode(settings.syncMode);
      if (modeOnboardingOverlay) {
        modeOnboardingOverlay.hidden = true;
      }
    } else {
      setMode("online");
      if (modeOnboardingOverlay) {
        modeOnboardingOverlay.hidden = false;
      }
    }
    if (supabaseUrlInput) {
      supabaseUrlInput.value = settings.supabaseUrl ?? DEFAULT_SUPABASE_URL;
    }
    if (supabaseAnonKeyInput) {
      supabaseAnonKeyInput.value = settings.supabaseAnonKey ?? DEFAULT_SUPABASE_ANON_KEY;
    }
    if (syncIdInput) {
      syncIdInput.value = settings.syncId ?? "";
    }
    if (rememberPassphraseInput) {
      rememberPassphraseInput.checked = Boolean(settings.rememberPassphrase);
    }
    if (autoSyncEnabledInput) {
      autoSyncEnabledInput.checked = Boolean(settings.autoSyncEnabled);
    }
    if (passphraseInput) {
      passphraseInput.value = settings.syncPassphrase ?? "";
    }

    setMode(settings.syncMode ?? "online");
    if (modeOnboardingOverlay) {
      modeOnboardingOverlay.hidden = settings.syncMode !== undefined;
    }

    const isOffline = (settings.syncMode ?? "online") === "offline";
    const settingsWithAuth = settings as ModeSettingsView;
    const hasSyncId = Boolean(settings.syncId);
    const hasPassphrase = Boolean(settingsWithAuth.hasPassphrase || settings.syncPassphrase || passphraseInput?.value.trim());
    const isConfigured = hasSyncId && hasPassphrase;
    isExplicitlySaved = Boolean(settings.rememberPassphrase && settings.syncPassphrase);

    if (settingsSection && !isOffline) {
      if (isConfigured && isExplicitlySaved) {
        settingsSection.classList.add("collapsed");
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = settings.rememberPassphrase ? "Passphrase Remembered ✓" : "Passphrase Set (Session)";
          settingsStatusBadge.className = "badge-status configured";
        }
      } else {
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = "Save Pass First";
          settingsStatusBadge.className = "badge-status setup";
        }
      }
    }

    updateLastSyncedDisplay(settings.lastSyncedAt);
    updateModePanels();
  } catch (error) {
    addLog(String(error instanceof Error ? error.message : error), "error");
  }
}

function setupTargetUi(): void {
  if (title) {
    title.textContent = "CookieSync";
  }

  if (syncIdLabel) {
    syncIdLabel.textContent = __BROWSER_TARGET__ === "chromium" ? "Sync ID (Copy to Gecko)" : "Sync ID (From Chromium)";
  }

  if (syncIdInput) {
    syncIdInput.readOnly = __BROWSER_TARGET__ === "chromium";
    syncIdInput.placeholder = __BROWSER_TARGET__ === "chromium"
      ? "Auto-generated Sync ID..."
      : "Paste Sync ID from Chromium here...";
  }

  if (copySyncIdButton) {
    copySyncIdButton.hidden = __BROWSER_TARGET__ !== "chromium";
  }

  if (uploadButton) {
    uploadButton.hidden = __BROWSER_TARGET__ !== "chromium";
  }

  if (deleteRemoteDataButton) {
    deleteRemoteDataButton.hidden = __BROWSER_TARGET__ !== "chromium";
  }

  if (importButton) {
    importButton.hidden = __BROWSER_TARGET__ !== "gecko";
  }

  if (clearAllCookiesButton) {
    clearAllCookiesButton.hidden = __BROWSER_TARGET__ !== "gecko";
  }

  if (saveButton) {
    saveButton.hidden = false;
  }

  if (sitePicker) {
    sitePicker.hidden = __BROWSER_TARGET__ !== "gecko";
  }

  updateModePanels();

  if (targetBadgeIcon) {
    targetBadgeIcon.innerHTML = `<img src="icon.png" width="22" height="22" style="object-fit: contain; display: block;" alt="Cookie Sync" />`;
  }

  document.body.dataset.target = __BROWSER_TARGET__;
  updateImportVisibility();
}

function renderSites(sites: RemoteSiteOption[]): void {
  loadedSites = sites;
  selectedDomains = new Set(sites.filter((site) => site.imported).map((site) => site.domain));
  if (siteSearchInput) {
    siteSearchInput.value = "";
  }
  renderVisibleSites();
}

function renderVisibleSites(): void {
  if (!sitesContainer) {
    return;
  }

  const query = siteSearchInput?.value.trim().toLowerCase() ?? "";
  const visibleSites = query ? loadedSites.filter((site) => site.domain.toLowerCase().includes(query)) : loadedSites;
  const hasLoadedSites = loadedSites.length > 0;
  const hasVisibleSites = visibleSites.length > 0;

  document.body.classList.toggle("sites-loaded", __BROWSER_TARGET__ === "gecko" && hasLoadedSites);

  if (siteSearchInput) {
    siteSearchInput.hidden = !hasLoadedSites;
  }
  if (selectAllWrap) {
    selectAllWrap.hidden = !hasVisibleSites;
  }
  if (expandSitesButton) {
    expandSitesButton.hidden = !hasLoadedSites;
    updateExpandSitesButton();
  }
  if (selectAllSitesInput && !hasVisibleSites) {
    selectAllSitesInput.checked = false;
    selectAllSitesInput.indeterminate = false;
  }

  if (!hasLoadedSites) {
    sitesContainer.textContent = "There isn't any server data for this Sync ID yet.";
    updateImportVisibility();
    return;
  }

  if (!hasVisibleSites) {
    sitesContainer.textContent = "No matching sites.";
    updateImportVisibility();
    return;
  }

  sitesContainer.textContent = "";
  for (const site of visibleSites) {
    const label = document.createElement("label");
    label.className = "site-option";

    const left = document.createElement("div");
    left.className = "site-option-left";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = site.domain;
    checkbox.checked = selectedDomains.has(site.domain);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedDomains.add(site.domain);
      } else {
        selectedDomains.delete(site.domain);
      }
      updateSelectAllState();
      updateImportVisibility();
    });

    const customCheck = document.createElement("span");
    customCheck.className = "check-custom";

    const domainSpan = document.createElement("span");
    domainSpan.className = "site-domain-text";
    domainSpan.textContent = site.domain;

    left.append(checkbox, customCheck, domainSpan);

    const right = document.createElement("div");
    right.className = "site-option-right";

    if (site.imported) {
      const importedBadge = document.createElement("span");
      importedBadge.className = "badge-imported";
      importedBadge.title = "Previously imported into Firefox";
      importedBadge.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Imported</span>
      `;
      right.append(importedBadge);
    }

    const badge = document.createElement("span");
    badge.className = "cookie-badge";
    badge.textContent = `${site.cookieCount} cookies`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-delete-site";
    deleteBtn.title = `Clear local cookies for ${site.domain}`;
    deleteBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addLog(`Clearing cookies for ${site.domain}...`);
      void sendMessage({ type: "clear-domain-cookies", domain: site.domain })
        .then((response) => {
          const res = response as { domain: string; removedCount: number };
          site.imported = false;
          selectedDomains.delete(site.domain);
          checkbox.checked = false;
          addLog(`Cleared ${res.removedCount} local cookies for ${res.domain}.`, "success");
          renderVisibleSites();
        })
        .catch((error) => addLog(String(error.message ?? error), "error"));
    });

    right.append(badge, deleteBtn);

    label.append(left, right);
    sitesContainer.append(label);
  }
  updateSelectAllState();
  updateImportVisibility();
}

function updateSelectAllState(): void {
  if (!selectAllSitesInput || !sitesContainer) {
    return;
  }

  const checkboxes = Array.from(sitesContainer.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
  const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  selectAllSitesInput.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
  selectAllSitesInput.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function updateImportVisibility(): void {
  if (!importButton) {
    return;
  }

  const selectedCount = selectedSiteDomains().length;
  importButton.hidden = __BROWSER_TARGET__ !== "gecko";
  importButton.disabled = __BROWSER_TARGET__ === "gecko" && selectedCount === 0;

  const span = importButton.querySelector("span");
  if (span) {
    span.textContent = selectedCount > 0
      ? `2. Import ${selectedCount} site${selectedCount > 1 ? "s" : ""}`
      : "2. Import selected";
  }
}

function selectedSiteDomains(): string[] {
  return Array.from(selectedDomains).sort();
}
