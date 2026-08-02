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
});
