import { getAllCookies, removeCookie, setCookie } from "./browserApi";
import type { CookieRecord, SerializableCookie } from "./types";

export async function readCookieRecords(
  ledger: Record<string, CookieRecord> = {}
): Promise<{ records: CookieRecord[]; ledger: Record<string, CookieRecord> }> {
  const cookies = await getAllCookies({});
  const now = Date.now();
  const nextLedger: Record<string, CookieRecord> = { ...ledger };
  const activeKeys = new Set<string>();

  const activeRecords = cookies.map((cookie) => {
    const serializable = toSerializableCookie(cookie);
    const key = cookieKey(serializable);
    const existing = ledger[key];
    const updatedAt = existing && !existing.deleted ? existing.updatedAt : now;
    const record: CookieRecord = { ...serializable, updatedAt };
    activeKeys.add(key);
    nextLedger[key] = record;
    return record;
  });

  const deletedRecords = Object.values(nextLedger).filter((record) => record.deleted && !activeKeys.has(cookieKey(record)));
  return { records: [...activeRecords, ...deletedRecords], ledger: nextLedger };
}

export async function applyCookieRecords(records: CookieRecord[]): Promise<number> {
  let applied = 0;
  for (const record of records) {
    if (record.deleted) {
      continue;
    }

    try {
      await setCookie(toSetDetails(record));
      applied += 1;
    } catch (error) {
      console.warn("Skipping cookie import", record.domain, record.name, error);
    }
  }

  return applied;
}

export async function removeDomainCookies(domain: string): Promise<number> {
  const allCookies = await getAllCookies({});
  const normalizedTarget = domain.toLowerCase().replace(/^\./u, "");
  let removedCount = 0;

  for (const cookie of allCookies) {
    const cookieDomain = cookie.domain.toLowerCase().replace(/^\./u, "");
    if (cookieDomain === normalizedTarget || cookieDomain.endsWith(`.${normalizedTarget}`)) {
      try {
        const serializable = toSerializableCookie(cookie);
        const url = cookieUrl(serializable);
        const removed = await removeCookie({ url, name: cookie.name, storeId: cookie.storeId });
        if (removed !== null) {
          removedCount += 1;
        }
      } catch (error) {
        console.warn("Failed to remove cookie", cookie.domain, cookie.name, error);
      }
    }
  }

  return removedCount;
}

export async function clearAllLocalCookies(): Promise<number> {
  const cookies = await getAllCookies({});
  let removedCount = 0;

  for (const cookie of cookies) {
    try {
      const serializable = toSerializableCookie(cookie);
      const url = cookieUrl(serializable);
      const details: chrome.cookies.CookieDetails = {
        url,
        name: cookie.name,
        storeId: cookie.storeId
      };
      const removed = await removeCookie(details);
      if (removed !== null) {
        removedCount += 1;
      }
    } catch (error) {
      console.warn("Failed to remove cookie", cookie.domain, cookie.name, error);
    }
  }

  return removedCount;
}

export function cookieKey(cookie: SerializableCookie): string {
  return [cookie.domain, cookie.path, cookie.name, cookie.storeId ?? "default"].join("|");
}

export function cookieSiteDomain(cookie: Pick<SerializableCookie, "domain">): string {
  return cookie.domain.toLowerCase().replace(/^\./u, "");
}

export function toCookieRecord(cookie: chrome.cookies.Cookie, updatedAt = Date.now()): CookieRecord {
  return { ...toSerializableCookie(cookie), updatedAt };
}

export function toDeletedCookieRecord(cookie: chrome.cookies.Cookie, deletedAt = Date.now()): CookieRecord {
  return {
    ...toSerializableCookie(cookie),
    value: "",
    updatedAt: deletedAt,
    deleted: true,
    deletedAt
  };
}

function toSetDetails(cookie: SerializableCookie): chrome.cookies.SetDetails {
  const isHostCookie = cookie.name.startsWith("__Host-");
  const isSecureCookie = cookie.name.startsWith("__Secure-") || isHostCookie || cookie.secure;
  const protocol = isSecureCookie ? "https" : "http";
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const url = `${protocol}://${host}${cookie.path || "/"}`;

  const details: chrome.cookies.SetDetails = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: isHostCookie ? "/" : (cookie.path || "/"),
    secure: isSecureCookie,
    httpOnly: cookie.httpOnly,
    expirationDate: cookie.expirationDate
  };

  if (!isHostCookie && cookie.domain) {
    details.domain = cookie.domain;
  }

  if (cookie.sameSite && (cookie.sameSite as string) !== "unspecified") {
    details.sameSite = cookie.sameSite;
  }

  return details;
}

function cookieUrl(cookie: SerializableCookie): string {
  const isHostCookie = cookie.name.startsWith("__Host-");
  const isSecureCookie = cookie.name.startsWith("__Secure-") || isHostCookie || cookie.secure;
  const protocol = isSecureCookie ? "https" : "http";
  const host = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  return `${protocol}://${host}${cookie.path || "/"}`;
}

function toSerializableCookie(cookie: chrome.cookies.Cookie): SerializableCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId
  };
}
