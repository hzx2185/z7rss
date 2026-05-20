import assert from "node:assert/strict";
import test from "node:test";
import { createSecretBox } from "../src/lib/secrets.js";

test("secret box can read legacy fallback secrets without using them for new writes", () => {
  const legacyBox = createSecretBox("legacy-secret");
  const currentBox = createSecretBox("current-secret", {
    fallbackSecrets: ["legacy-secret"]
  });

  const legacyCiphertext = legacyBox.encrypt("stored-api-key");
  assert.equal(currentBox.decrypt(legacyCiphertext), "stored-api-key");
  assert.equal(currentBox.needsRotation(legacyCiphertext), true);

  const currentCiphertext = currentBox.encrypt("stored-api-key");
  assert.equal(currentBox.decrypt(currentCiphertext), "stored-api-key");
  assert.equal(currentBox.needsRotation(currentCiphertext), false);
});

test("secret box still marks unreadable ciphertext as unavailable", () => {
  const box = createSecretBox("current-secret", {
    fallbackSecrets: ["legacy-secret"]
  });
  const otherCiphertext = createSecretBox("other-secret").encrypt("stored-api-key");

  assert.equal(box.decrypt(otherCiphertext), "");
  assert.equal(box.needsRotation(otherCiphertext), false);
});
