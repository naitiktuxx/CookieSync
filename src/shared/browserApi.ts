type CallbackApi = typeof chrome;

declare const browser: typeof chrome | undefined;

function getApi(): CallbackApi {
  return (typeof chrome !== "undefined" ? chrome : typeof browser !== "undefined" ? browser : {}) as CallbackApi;
}

function toPromise<T>(invoke: (api: CallbackApi, done: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const api = getApi();
      invoke(api, (value) => {
        const lastError = api.runtime?.lastError;
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

export const extensionApi = new Proxy({} as CallbackApi, {
  get(_target, prop: keyof CallbackApi) {
    return getApi()[prop];
  }
});

export async function getStorage<T extends Record<string, unknown>>(keys?: string[]): Promise<T> {
  return toPromise<T>((api, done) => api.storage.local.get(keys ?? null, done));
}

export async function setStorage(values: Record<string, unknown>): Promise<void> {
  await toPromise<void>((api, done) => api.storage.local.set(values, done));
}

export async function getAllCookies(details: chrome.cookies.GetAllDetails = {}): Promise<chrome.cookies.Cookie[]> {
  return toPromise<chrome.cookies.Cookie[]>((api, done) => api.cookies.getAll(details, done));
}

export async function setCookie(details: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie | null> {
  return toPromise<chrome.cookies.Cookie | null>((api, done) => api.cookies.set(details, done));
}

export async function removeCookie(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.CookieDetails | undefined> {
  return toPromise<chrome.cookies.CookieDetails | undefined>((api, done) => api.cookies.remove(details, done));
}

const inMemorySessionStorage = new Map<string, unknown>();

export async function getSessionStorage<T extends Record<string, unknown>>(keys?: string[]): Promise<T> {
  const api = getApi();
  if (api.storage?.session) {
    try {
      return await toPromise<T>((apiRef, done) => apiRef.storage.session.get(keys ?? null, done));
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
  const api = getApi();
  if (api.storage?.session) {
    try {
      await toPromise<void>((apiRef, done) => apiRef.storage.session.set(values, done));
    } catch {
      // Fallback to in-memory store
    }
  }
}

export async function removeSessionStorage(keys: string[]): Promise<void> {
  for (const k of keys) {
    inMemorySessionStorage.delete(k);
  }
  const api = getApi();
  if (api.storage?.session) {
    try {
      await toPromise<void>((apiRef, done) => apiRef.storage.session.remove(keys, done));
    } catch {
      // Fallback to in-memory store
    }
  }
}

