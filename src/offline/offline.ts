import { extensionApi } from "../shared/browserApi";
import type { BrowserTarget, ModeSettingsView, RemoteSiteOption } from "../shared/types";

declare const __BROWSER_TARGET__: BrowserTarget;

const passphraseInput = document.querySelector<HTMLInputElement>("#passphrase");
const togglePassphraseButton = document.querySelector<HTMLButtonElement>("#toggle-passphrase");
const rememberPassphraseInput = document.querySelector<HTMLInputElement>("#remember-passphrase");
const saveButton = document.querySelector<HTMLButtonElement>("#save-settings");
const selectAllSitesInput = document.querySelector<HTMLInputElement>("#select-all-sites");
const selectAllWrap = document.querySelector<HTMLLabelElement>("#select-all-wrap");
const expandSitesButton = document.querySelector<HTMLButtonElement>("#expand-sites");
const siteSearchInput = document.querySelector<HTMLInputElement>("#site-search");
const status = document.querySelector<HTMLDivElement>("#status");
const exportCokzButton = document.querySelector<HTMLButtonElement>("#export-cokz-now");
const loadCokzFileButton = document.querySelector<HTMLButtonElement>("#load-cokz-file");
const cokzFileInput = document.querySelector<HTMLInputElement>("#cokz-file-input");
const importButton = document.querySelector<HTMLButtonElement>("#import-now");
const clearAllCookiesButton = document.querySelector<HTMLButtonElement>("#clear-all-cookies");
const sitesContainer = document.querySelector<HTMLDivElement>("#sites");
const targetBadgeIcon = document.querySelector<HTMLDivElement>("#target-badge-icon");
const settingsSection = document.querySelector<HTMLElement>("#settings-section");
const settingsHeader = document.querySelector<HTMLDivElement>("#settings-header");
const settingsStatusBadge = document.querySelector<HTMLSpanElement>("#settings-status-badge");
const lastSyncedText = document.querySelector<HTMLElement>("#last-synced-text");
const statusFooter = document.querySelector<HTMLElement>("#status-footer");
const statusHeader = document.querySelector<HTMLElement>("#status-header");
const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle");

const EXPAND_ICON_SVG = `<svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const COMPACT_ICON_SVG = `<svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;

let loadedSites: RemoteSiteOption[] = [];
let selectedDomains = new Set<string>();
let currentTheme: "dark" | "catppuccin" = "dark";
let isExplicitlySaved = false;

function updateExpandSitesButton(): void {
  if (!expandSitesButton) return;
  const isExpanded = document.body.classList.contains("sites-expanded");
  const titleText = isExpanded ? "Compact list" : "Expand list";
  expandSitesButton.title = titleText;
  expandSitesButton.setAttribute("aria-label", titleText);
  expandSitesButton.innerHTML = isExpanded ? COMPACT_ICON_SVG : EXPAND_ICON_SVG;
}

function setTheme(theme: "dark" | "catppuccin"): void {
  currentTheme = theme;
  document.body.dataset.theme = theme;
  if (themeToggleButton) {
    const isDark = theme === "dark";
    themeToggleButton.title = isDark ? "Switch to Catppuccin theme" : "Switch to Dark theme";
    themeToggleButton.setAttribute("aria-label", isDark ? "Switch to Catppuccin theme" : "Switch to Dark theme");
  }
}

function toggleTheme(): void {
  const newTheme = currentTheme === "dark" ? "catppuccin" : "dark";
  setTheme(newTheme);
  void sendMessage({ type: "save-settings", themePreference: newTheme })
    .catch((error) => console.warn("Failed to save theme preference:", error));
}

function updateSettingsBadge(hasPassphrase: boolean): void {
  if (!settingsStatusBadge) return;
  const isRemembered = Boolean(rememberPassphraseInput?.checked);
  if (hasPassphrase) {
    if (isRemembered && isExplicitlySaved) {
      settingsStatusBadge.textContent = "Passphrase Saved ✓";
    } else {
      settingsStatusBadge.textContent = "Passphrase Set ✓";
    }
    settingsStatusBadge.className = "badge-status configured";
  } else {
    settingsStatusBadge.textContent = "Passphrase Required";
    settingsStatusBadge.className = "badge-status setup";
  }
}

function updateLastSyncedDisplay(timestamp?: number): void {
  if (!lastSyncedText) return;
  if (!timestamp) {
    lastSyncedText.textContent = "Never";
    return;
  }
  const date = new Date(timestamp);
  lastSyncedText.textContent = `${date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function setupTargetUi(): void {
  document.body.dataset.target = __BROWSER_TARGET__;
  if (targetBadgeIcon) {
    targetBadgeIcon.innerHTML = `<img src="icon.png" width="22" height="22" style="object-fit: contain; display: block;" alt="Cookie Sync" />`;
  }
  updateImportVisibility();
}

setupTargetUi();
void sendMessage({ type: "register-offline-tab" }).catch(() => {});
void loadSettings();

const cleanupOfflineSession = () => {
  void sendMessage({ type: "clear-offline-session" }).catch(() => {});
};
window.addEventListener("pagehide", cleanupOfflineSession);
window.addEventListener("beforeunload", cleanupOfflineSession);

settingsHeader?.addEventListener("click", () => {
  settingsSection?.classList.toggle("collapsed");
});

statusHeader?.addEventListener("click", () => {
  document.body.classList.toggle("log-expanded");
  statusFooter?.classList.toggle("expanded");
});

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

for (const input of [passphraseInput]) {
  input?.addEventListener("input", () => {
    isExplicitlySaved = false;
    void saveSettingsFromForm({ silent: true }).catch(() => undefined);
  });
}

rememberPassphraseInput?.addEventListener("change", () => {
  void saveSettingsFromForm({ silent: true }).catch(() => undefined);
});

themeToggleButton?.addEventListener("click", toggleTheme);

async function saveSettingsFromForm({ silent }: { silent: boolean }): Promise<void> {
  const passphrase = passphraseInput?.value ?? "";
  const rememberPassphrase = Boolean(rememberPassphraseInput?.checked);

  try {
    await sendMessage({
      type: "save-settings",
      settingsScope: "offline",
      passphrase,
      rememberPassphrase,
      syncMode: "offline"
    });
    updateSettingsBadge(Boolean(passphrase));
    if (!silent) {
      addLog(Boolean(passphrase) ? "Passphrase saved." : "Partial settings saved.", "success");
      if (passphrase) {
        settingsSection?.classList.add("collapsed");
      }
    }
  } catch (error) {
    if (!silent) {
      addLog(String(error instanceof Error ? error.message : error), "error");
    }
  }
}

exportCokzButton?.addEventListener("click", () => {
  addLog("Exporting encrypted .cokz file...");
  void saveSettingsFromForm({ silent: true })
    .then(() => sendMessage({ type: "export-offline-cokz" }))
    .then((response) => {
      const res = response as { filename: string; content: string };
      const blob = new Blob([res.content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog(`Exported encrypted file: ${res.filename}`, "success");
    })
    .catch((error) => addLog(String(error instanceof Error ? error.message : error), "error"));
});

loadCokzFileButton?.addEventListener("click", () => {
  const passphrase = passphraseInput?.value.trim();
  if (!passphrase) {
    addLog("Enter your Sync Passphrase first.", "error");
    passphraseInput?.focus();
    return;
  }
  cokzFileInput?.click();
});

cokzFileInput?.addEventListener("change", () => {
  const file = cokzFileInput.files?.[0];
  if (!file) return;

  addLog(`Reading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = (e) => {
    const fileContent = e.target?.result as string;
    if (!fileContent) {
      addLog("Failed to read file.", "error");
      return;
    }

    void saveSettingsFromForm({ silent: true })
      .then(() => sendMessage({ type: "parse-offline-cokz", fileContent }))
      .then((response) => {
        const res = response as { sites: RemoteSiteOption[] };
        if (!res.sites || res.sites.length === 0) {
          addLog("No active cookies found in this .cokz file.", "warn");
          renderSites([]);
          return;
        }
        renderSites(res.sites);
        addLog(`Loaded ${res.sites.length} site(s) from .cokz file.`, "success");
      })
      .catch((error) => addLog(String(error instanceof Error ? error.message : error), "error"));
  };
  reader.readAsText(file);
  cokzFileInput.value = "";
});

importButton?.addEventListener("click", () => {
  const domains = selectedSiteDomains();
  if (domains.length === 0) {
    addLog("Select at least one site.", "warn");
    return;
  }

  addLog(`Importing ${domains.length} site(s) from .cokz file...`);
  void saveSettingsFromForm({ silent: true })
    .then(() => sendMessage({ type: "import-offline-domains", domains }))
    .then((response) => {
      const res = response as { updatedAt?: number; cookieCount?: number };
      addLog(`Imported ${res.cookieCount ?? 0} cookies.`, "success");
      updateImportVisibility();
      updateLastSyncedDisplay(res?.updatedAt ?? Date.now());
      return sendMessage({ type: "get-offline-sites" });
    })
    .then((offlineSites) => {
      if (Array.isArray(offlineSites) && offlineSites.length > 0) {
        renderSites(offlineSites as RemoteSiteOption[]);
      }
    })
    .catch((error) => addLog(String(error instanceof Error ? error.message : error), "error"));
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
    .catch((error) => addLog(String(error instanceof Error ? error.message : error), "error"));
});

siteSearchInput?.addEventListener("input", () => {
  renderVisibleSites();
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

function addLog(message: string, level: "info" | "success" | "warn" | "error" = "info"): void {
  if (status) {
    const row = document.createElement("div");
    row.className = `log-line ${level}`;
    const timeSpan = document.createElement("span");
    timeSpan.style.fontSize = "10px";
    timeSpan.style.opacity = "0.6";
    const now = new Date();
    timeSpan.textContent = `[${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}]`;
    const textSpan = document.createElement("span");
    textSpan.textContent = message;
    row.append(timeSpan, textSpan);
    status.prepend(row);
  }
}

async function loadSettings(): Promise<void> {
  try {
    await sendMessage({ type: "clear-offline-session" }).catch(() => {});
    const settings = (await sendMessage({ type: "get-settings" })) as ModeSettingsView;
    setTheme(settings.themePreference ?? "dark");

    if (settings.syncMode !== "offline") {
      await sendMessage({ type: "save-settings", settingsScope: "global", syncMode: "offline" });
    }

    if (passphraseInput) {
      passphraseInput.value = settings.syncPassphrase ?? "";
    }
    if (rememberPassphraseInput) {
      rememberPassphraseInput.checked = Boolean(settings.rememberPassphrase);
    }

    isExplicitlySaved = Boolean(settings.rememberPassphrase && settings.syncPassphrase);

    const settingsWithAuth = settings as ModeSettingsView;
    const hasPassphrase = Boolean(settingsWithAuth.hasPassphrase || settings.syncPassphrase || passphraseInput?.value.trim());
    updateSettingsBadge(hasPassphrase);

    if (settingsSection) {
      if (hasPassphrase) {
        settingsSection.classList.add("collapsed");
      }
    }

    updateLastSyncedDisplay(settings.lastSyncedAt);

    try {
      const response = await sendMessage({ type: "get-offline-sites" });
      const sites = response as RemoteSiteOption[];
      renderSites(Array.isArray(sites) ? sites : []);
    } catch {
      renderSites([]);
    }

    addLog("Offline sync interface ready. Load a .cokz file to begin.", "info");
  } catch (error) {
    addLog(String(error instanceof Error ? error.message : error), "error");
  }
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
  if (!sitesContainer) return;

  const query = siteSearchInput?.value.trim().toLowerCase() ?? "";
  const visibleSites = query ? loadedSites.filter((site) => site.domain.toLowerCase().includes(query)) : loadedSites;
  const hasLoadedSites = loadedSites.length > 0;
  const hasVisibleSites = visibleSites.length > 0;

  document.body.classList.toggle("sites-loaded", __BROWSER_TARGET__ === "gecko" && hasLoadedSites);

  if (siteSearchInput) siteSearchInput.hidden = !hasLoadedSites;
  if (selectAllWrap) selectAllWrap.hidden = !hasVisibleSites;
  if (expandSitesButton) {
    expandSitesButton.hidden = !hasLoadedSites;
    updateExpandSitesButton();
  }
  if (selectAllSitesInput && !hasVisibleSites) {
    selectAllSitesInput.checked = false;
    selectAllSitesInput.indeterminate = false;
  }

  if (!hasLoadedSites) {
    sitesContainer.textContent = "No .cokz file loaded yet. Click '1. Load .cokz file' below to select your encrypted file.";
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
      importedBadge.title = "Previously imported";
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
        .catch((error) => addLog(String(error instanceof Error ? error.message : error), "error"));
    });

    right.append(badge, deleteBtn);
    label.append(left, right);
    sitesContainer.append(label);
  }
  updateSelectAllState();
  updateImportVisibility();
}

function updateSelectAllState(): void {
  if (!selectAllSitesInput || !sitesContainer) return;
  const checkboxes = Array.from(sitesContainer.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
  const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  selectAllSitesInput.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
  selectAllSitesInput.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function updateImportVisibility(): void {
  if (!importButton) return;
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
