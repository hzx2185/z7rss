import assert from "node:assert/strict";
import test from "node:test";
import { createSecretBox } from "../src/lib/secrets.js";

test("secret box treats values encrypted with another app secret as unavailable", () => {
  const originalBox = createSecretBox("old-secret");
  const nextBox = createSecretBox("new-secret");
  const encrypted = originalBox.encrypt("private-value");

  assert.equal(nextBox.decrypt(encrypted), "");
});
