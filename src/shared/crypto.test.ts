import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decryptJson, deriveAuthHash, encryptJson } from "./crypto";

describe("crypto module", () => {
  const samplePassphrase = "SuperSecretPassphrase123!";
  const sampleData = {
    testKey: "testValue",
    cookies: [{ name: "session_id", value: "abc123xyz" }]
  };

  it("should encrypt and decrypt JSON data correctly", async () => {
    const encrypted = await encryptJson(sampleData, samplePassphrase);

    assert.equal(encrypted.schemaVersion, 1);
    assert.equal(encrypted.algorithm, "AES-GCM");
    assert.equal(encrypted.kdf, "PBKDF2-SHA-256");
    assert.equal(encrypted.iterations, 250_000);
    assert.equal(typeof encrypted.salt, "string");
    assert.equal(typeof encrypted.iv, "string");
    assert.equal(typeof encrypted.ciphertext, "string");

    const decrypted = await decryptJson<typeof sampleData>(encrypted, samplePassphrase);
    assert.deepEqual(decrypted, sampleData);
  });

  it("should fail decryption when given an incorrect passphrase", async () => {
    const encrypted = await encryptJson(sampleData, samplePassphrase);
    await assert.rejects(async () => {
      await decryptJson(encrypted, "WrongPassphrase!");
    });
  });

  it("should produce consistent deriveAuthHash for identical passphrase and syncId", async () => {
    const syncId = "test-sync-id-12345";
    const hash1 = await deriveAuthHash(samplePassphrase, syncId);
    const hash2 = await deriveAuthHash(samplePassphrase, syncId);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  it("should produce different deriveAuthHash for different syncIds or passphrases", async () => {
    const syncId1 = "sync-id-1";
    const syncId2 = "sync-id-2";

    const hash1 = await deriveAuthHash(samplePassphrase, syncId1);
    const hash2 = await deriveAuthHash(samplePassphrase, syncId2);
    const hash3 = await deriveAuthHash("DifferentPassphrase", syncId1);

    assert.notEqual(hash1, hash2);
    assert.notEqual(hash1, hash3);
  });
});
