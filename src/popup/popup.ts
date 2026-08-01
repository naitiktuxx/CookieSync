import { extensionApi } from "../shared/browserApi";
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from "../shared/defaultConfig";
import type { BrowserTarget, RemoteSiteOption, StoredSettings, SyncDirection } from "../shared/types";

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

let loadedSites: RemoteSiteOption[] = [];
let selectedDomains = new Set<string>();

function updateLastSyncedDisplay(timestamp?: number): void {
  if (lastSyncedBox) {
    lastSyncedBox.hidden = __BROWSER_TARGET__ !== "brave";
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
  void saveSettingsFromForm({ silent: false }).catch(() => undefined);
});

// Auto-save on typing/change so unsaved input is never lost when popup closes
const autoSaveInputs = [supabaseUrlInput, supabaseAnonKeyInput, syncIdInput, passphraseInput];
for (const input of autoSaveInputs) {
  input?.addEventListener("input", () => {
    void saveSettingsFromForm({ silent: true }).catch(() => undefined);
  });
}
rememberPassphraseInput?.addEventListener("change", () => {
  void saveSettingsFromForm({ silent: true }).catch(() => undefined);
});
autoSyncEnabledInput?.addEventListener("change", () => {
  void saveSettingsFromForm({ silent: true }).catch(() => undefined);
});

async function saveSettingsFromForm({ silent }: { silent: boolean }): Promise<void> {
  const passphrase = passphraseInput?.value.trim() ?? "";
  const supabaseUrl = supabaseUrlInput?.value.trim() ?? "";
  const supabaseAnonKey = supabaseAnonKeyInput?.value.trim() ?? "";
  const syncId = syncIdInput?.value.trim() ?? "";
  const rememberPassphrase = Boolean(rememberPassphraseInput?.checked);
  const autoSyncEnabled = Boolean(autoSyncEnabledInput?.checked);

  try {
    await sendMessage({ type: "save-settings", supabaseUrl, supabaseAnonKey, syncId, passphrase, rememberPassphrase, autoSyncEnabled });
    
    const isFullyConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey) && Boolean(syncId) && Boolean(passphrase);

    if (settingsStatusBadge) {
      if (isFullyConfigured) {
        settingsStatusBadge.textContent = "Configured ✓";
        settingsStatusBadge.className = "badge-status configured";
      } else {
        settingsStatusBadge.textContent = "Setup Required";
        settingsStatusBadge.className = "badge-status setup";
      }
    }
    if (!silent) {
      addLog(isFullyConfigured ? (rememberPassphrase ? "Settings saved with passphrase." : "Settings saved without passphrase.") : "Partial settings saved.", "success");
      if (isFullyConfigured) {
        settingsSection?.classList.add("collapsed");
      }
    }
  } catch (error) {
    if (!silent) {
      addLog(String(error instanceof Error ? error.message : error), "error");
    }
  }
}

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
      addLog(formatResult(response), "success");
      updateImportVisibility();
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
  if (expandSitesButton) {
    expandSitesButton.textContent = document.body.classList.contains("sites-expanded") ? "Compact" : "Expand list";
  }
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
    const settings = (await sendMessage({ type: "get-settings" })) as StoredSettings;
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
    if (passphraseInput && settings.syncPassphrase) {
      passphraseInput.value = settings.syncPassphrase;
    }
    const settingsWithAuth = settings as StoredSettings & { hasPassphrase?: boolean };
    const hasSyncId = Boolean(settings.syncId);
    const hasPassphrase = Boolean(settingsWithAuth.hasPassphrase || settings.syncPassphrase || passphraseInput?.value.trim());
    const isConfigured = hasSyncId && hasPassphrase;

    if (settingsSection) {
      if (isConfigured) {
        settingsSection.classList.add("collapsed");
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = "Configured ✓";
          settingsStatusBadge.className = "badge-status configured";
        }
      } else {
        settingsSection.classList.remove("collapsed");
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = "Setup Required";
          settingsStatusBadge.className = "badge-status setup";
        }
      }
    }

    updateLastSyncedDisplay(settings.lastSyncedAt);
  } catch (error) {
    addLog(String(error instanceof Error ? error.message : error), "error");
  }
}

function setupTargetUi(): void {
  if (title) {
    title.textContent = __BROWSER_TARGET__ === "brave" ? "Brave Cookie Publisher" : "Firefox Cookie Consumer";
  }

  if (syncIdLabel) {
    syncIdLabel.textContent = __BROWSER_TARGET__ === "brave" ? "Sync ID (Copy to Firefox)" : "Sync ID (From Brave)";
  }

  if (syncIdInput) {
    syncIdInput.readOnly = __BROWSER_TARGET__ === "brave";
    syncIdInput.placeholder = __BROWSER_TARGET__ === "brave"
      ? "Auto-generated Sync ID..."
      : "Paste Sync ID from Brave here...";
  }

  if (copySyncIdButton) {
    copySyncIdButton.hidden = __BROWSER_TARGET__ !== "brave";
  }

  if (uploadButton) {
    uploadButton.hidden = __BROWSER_TARGET__ !== "brave";
  }

  if (deleteRemoteDataButton) {
    deleteRemoteDataButton.hidden = __BROWSER_TARGET__ !== "brave";
  }

  if (importButton) {
    importButton.hidden = __BROWSER_TARGET__ !== "firefox";
  }

  if (clearAllCookiesButton) {
    clearAllCookiesButton.hidden = __BROWSER_TARGET__ !== "firefox";
  }

  if (saveButton) {
    saveButton.hidden = false;
  }

  if (sitePicker) {
    sitePicker.hidden = __BROWSER_TARGET__ !== "firefox";
  }

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

  document.body.classList.toggle("sites-loaded", __BROWSER_TARGET__ === "firefox" && hasLoadedSites);

  if (siteSearchInput) {
    siteSearchInput.hidden = !hasLoadedSites;
  }
  if (selectAllWrap) {
    selectAllWrap.hidden = !hasVisibleSites;
  }
  if (expandSitesButton) {
    expandSitesButton.hidden = !hasLoadedSites;
    expandSitesButton.textContent = document.body.classList.contains("sites-expanded") ? "Compact" : "Expand list";
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
  importButton.hidden = __BROWSER_TARGET__ !== "firefox";
  importButton.disabled = __BROWSER_TARGET__ === "firefox" && selectedCount === 0;

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
