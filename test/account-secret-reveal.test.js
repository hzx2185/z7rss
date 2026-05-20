import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createSecretBox } from "../src/lib/secrets.js";
import { createAccountService } from "../src/services/account-service.js";

function createAccountHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-account-secret-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);
  const store = createStore(db);
  const config = { aiEnabled: true, dbPath };
  const secretBox = createSecretBox("test-secret");
  const accountService = createAccountService({ store, config, secretBox });
  return { db, store, secretBox, accountService };
}

test("account preferences mask user secrets while reveal returns the current user's requested key", () => {
  const { db, store, secretBox, accountService } = createAccountHarness();

  try {
    const user = store.createUser({
      email: "user@example.test",
      passwordHash: "hash",
      displayName: "User",
      isAdmin: 0,
      status: "active"
    });
    store.setUserSetting(user.id, "ai", "api_key", secretBox.encrypt("sk-user-ai"));
    store.setUserSetting(user.id, "translation_google", "api_key", secretBox.encrypt("google-user-key"));
    store.setUserSetting(user.id, "translation_bing", "api_key", secretBox.encrypt("bing-user-key"));
    store.setUserSetting(user.id, "translation_deeplx", "api_key", secretBox.encrypt("deeplx-user-key"));

    const preferences = accountService.getUserPreferences(user.id);
    assert.equal(preferences.ai.api_key_configured, true);
    assert.equal(preferences.ai.api_key, undefined);
    assert.equal(preferences.translation_google.api_key_configured, true);
    assert.equal(preferences.translation_google.api_key, undefined);
    assert.equal(preferences.translation_bing.api_key_configured, true);
    assert.equal(preferences.translation_bing.api_key, undefined);
    assert.equal(preferences.translation_deeplx.api_key_configured, true);
    assert.equal(preferences.translation_deeplx.api_key, undefined);

    assert.equal(accountService.revealUserSecret(user, "ai", "api_key").value, "sk-user-ai");
    assert.equal(accountService.revealUserSecret(user, "translation_google", "api_key").value, "google-user-key");
    assert.equal(accountService.revealUserSecret(user, "translation_bing", "api_key").value, "bing-user-key");
    assert.equal(accountService.revealUserSecret(user, "translation_deeplx", "api_key").value, "deeplx-user-key");
    assert.throws(
      () => accountService.revealUserSecret(user, "mail", "password"),
      (error) => error.code === "invalid_secret_setting"
    );
  } finally {
    db.close();
  }
});
