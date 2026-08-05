// Mock extension API for node testing environment
if (typeof globalThis.chrome === "undefined") {
  (globalThis as unknown as Record<string, unknown>).chrome = {};
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cookieKey, cookieSiteDomain, toCookieRecord, toDeletedCookieRecord } from "./cookies";
import type { SerializableCookie } from "./types";

describe("cookies module", () => {
  const sampleCookie: chrome.cookies.Cookie = {
    name: "session_id",
    value: "val123",
    domain: ".example.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    hostOnly: false,
    session: true,
    storeId: "0"
  };

  it("should generate a deterministic cookieKey", () => {
    const serializable: SerializableCookie = {
      name: "auth_token",
      value: "token123",
      domain: "github.com",
      path: "/login",
      secure: true,
      httpOnly: true,
      storeId: "default"
    };

    const key = cookieKey(serializable);
    assert.equal(key, "github.com|/login|auth_token|default");
  });

  it("should normalize cookieSiteDomain correctly", () => {
    assert.equal(cookieSiteDomain({ domain: ".sub.example.com" }), "sub.example.com");
    assert.equal(cookieSiteDomain({ domain: "example.com" }), "example.com");
  });

  it("should convert a chrome.cookies.Cookie to an active CookieRecord", () => {
    const now = 1700000000000;
    const record = toCookieRecord(sampleCookie, now);

    assert.equal(record.name, "session_id");
    assert.equal(record.value, "val123");
    assert.equal(record.domain, ".example.com");
    assert.equal(record.updatedAt, now);
    assert.equal(record.deleted, undefined);
  });

  it("should convert a chrome.cookies.Cookie to a deleted CookieRecord", () => {
    const deletedTime = 1700000050000;
    const record = toDeletedCookieRecord(sampleCookie, deletedTime);

    assert.equal(record.name, "session_id");
    assert.equal(record.value, "");
    assert.equal(record.deleted, true);
    assert.equal(record.deletedAt, deletedTime);
    assert.equal(record.updatedAt, deletedTime);
  });

  it("should preserve host-only vs domain cookie attributes when applying records", async () => {
    const setCalls: chrome.cookies.SetDetails[] = [];
    (globalThis as unknown as Record<string, unknown>).chrome = {
      cookies: {
        set: (details: chrome.cookies.SetDetails, cb: (res: unknown) => void) => {
          setCalls.push(details);
          cb(details);
        }
      }
    };

    const { applyCookieRecords } = await import("./cookies");
    await applyCookieRecords([
      {
        name: "host_cookie",
        value: "val1",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        updatedAt: 100
      },
      {
        name: "domain_cookie",
        value: "val2",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        updatedAt: 100
      }
    ]);

    assert.equal(setCalls.length, 2);
    assert.equal(setCalls[0].domain, undefined); // Host-only cookie must omit domain property
    assert.equal(setCalls[1].domain, ".example.com"); // Domain cookie must preserve leading dot domain
  });

  it("should strip default storeIds and force secure for sameSite=no_restriction when applying records", async () => {
    const setCalls: chrome.cookies.SetDetails[] = [];
    (globalThis as unknown as Record<string, unknown>).chrome = {
      cookies: {
        set: (details: chrome.cookies.SetDetails, cb: (res: unknown) => void) => {
          setCalls.push(details);
          cb(details);
        }
      }
    };

    const { applyCookieRecords } = await import("./cookies");
    await applyCookieRecords([
      {
        name: "chrome_default_store",
        value: "val1",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        storeId: "0",
        updatedAt: 100
      },
      {
        name: "firefox_default_store",
        value: "val2",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        storeId: "firefox-default",
        updatedAt: 100
      },
      {
        name: "samesite_none",
        value: "val3",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "no_restriction",
        updatedAt: 100
      }
    ]);

    assert.equal(setCalls.length, 3);
    assert.equal(setCalls[0].storeId, undefined);
    assert.equal(setCalls[1].storeId, undefined);
    assert.equal(setCalls[2].secure, true);
    assert.equal(setCalls[2].url.startsWith("https://"), true);
  });
});
