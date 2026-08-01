type CallbackApi = typeof chrome;

declare const browser: typeof chrome | undefined;

const rawApi = (typeof chrome !== "undefined" ? chrome : browser) as CallbackApi;

function toPromise<T>(invoke: (done: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      invoke((value) => {
        const lastError = rawApi.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(value);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export const extensionApi = rawApi;

export async function getStorage<T extends Record<string, unknown>>(keys?: string[]): Promise<T> {
  return toPromise<T>((done) => rawApi.storage.local.get(keys ?? null, done));
}

export async function setStorage(values: Record<string, unknown>): Promise<void> {
  await toPromise<void>((done) => rawApi.storage.local.set(values, done));
}

export async function getAllCookies(details: chrome.cookies.GetAllDetails = {}): Promise<chrome.cookies.Cookie[]> {
  return toPromise<chrome.cookies.Cookie[]>((done) => rawApi.cookies.getAll(details, done));
}

export async function setCookie(details: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie | null> {
  return toPromise<chrome.cookies.Cookie | null>((done) => rawApi.cookies.set(details, done));
}

export async function removeCookie(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.CookieDetails | undefined> {
  return toPromise<chrome.cookies.CookieDetails | undefined>((done) => rawApi.cookies.remove(details, done));
}

const inMemorySessionStorage = new Map<string, unknown>();

export async function getSessionStorage<T extends Record<string, unknown>>(keys?: string[]): Promise<T> {
  if (rawApi.storage?.session) {
    try {
      return await toPromise<T>((done) => rawApi.storage.session.get(keys ?? null, done));
    } catch {
      // Fallback to in-memory store
    }
  }

  const result: Record<string, unknown> = {};
  if (!keys) {
    for (const [k, v] of inMemorySessionStorage.entries()) {
      result[k] = v;
    }
  } else {
    for (const k of keys) {
      if (inMemorySessionStorage.has(k)) {
        result[k] = inMemorySessionStorage.get(k);
      }
    }
  }
  return result as T;
}

export async function setSessionStorage(values: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(values)) {
    inMemorySessionStorage.set(k, v);
  }
  if (rawApi.storage?.session) {
    try {
      await toPromise<void>((done) => rawApi.storage.session.set(values, done));
    } catch {
      // Fallback to in-memory store
    }
  }
}

export async function removeSessionStorage(keys: string[]): Promise<void> {
  for (const k of keys) {
    inMemorySessionStorage.delete(k);
  }
  if (rawApi.storage?.session) {
    try {
      await toPromise<void>((done) => rawApi.storage.session.remove(keys, done));
    } catch {
      // Fallback to in-memory store
    }
  }
}

