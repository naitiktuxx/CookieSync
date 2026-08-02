import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cookieMatchesAllowedDomains, normalizeDomain, parseDomainList } from "./domainAllowlist";

describe("domainAllowlist module", () => {
  describe("normalizeDomain", () => {
    it("should normalize basic domains correctly", () => {
      assert.equal(normalizeDomain("example.com"), "example.com");
      assert.equal(normalizeDomain("HTTPS://WWW.EXAMPLE.COM/path"), "www.example.com");
      assert.equal(normalizeDomain("*.sub.domain.org"), "sub.domain.org");
      assert.equal(normalizeDomain(".leadingdot.com"), "leadingdot.com");
    });

    it("should return undefined for empty or invalid inputs", () => {
      assert.equal(normalizeDomain(""), undefined);
      assert.equal(normalizeDomain("   "), undefined);
    });
  });

  describe("parseDomainList", () => {
    it("should parse comma and newline separated domain lists", () => {
      const input = "google.com, github.com\n  youtube.com, https://twitter.com/";
      const result = parseDomainList(input);
      assert.deepEqual(result, ["google.com", "github.com", "youtube.com", "twitter.com"]);
    });
  });

  describe("cookieMatchesAllowedDomains", () => {
    it("should match exact domains and subdomains", () => {
      const allowed = ["github.com"];
      assert.equal(cookieMatchesAllowedDomains("github.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains(".github.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("api.github.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("notgithub.com", allowed), false);
    });

    it("should return false when allowed domains list is empty", () => {
      assert.equal(cookieMatchesAllowedDomains("google.com", []), false);
    });

    it("should expand domain families (e.g., youtube.com includes google.com, googleusercontent.com, gstatic.com)", () => {
      const allowed = ["youtube.com"];
      assert.equal(cookieMatchesAllowedDomains("youtube.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("google.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("accounts.google.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("gstatic.com", allowed), true);
      assert.equal(cookieMatchesAllowedDomains("unrelated.com", allowed), false);
    });
  });
});
