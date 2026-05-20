import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createSecretBox } from "../src/lib/secrets.js";
import { createAccountService } from "../src/services/account-service.js";
import { createAdminService } from "../src/services/admin-service.js";

function createSecretHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-admin-secret-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);
  const store = createStore(db);
  const config = { billingProvider: "demo", aiEnabled: true, dbPath };
  const secretBox = createSecretBox("test-secret");
  const accountService = createAccountService({ store, config, secretBox });
  const adminService = createAdminService({
    store,
    accountService,
    config,
    secretBox,
    feedService: null
  });

  return { db, store, secretBox, adminService };
}

test("admin dashboard masks provider pool API keys while reveal returns one requested key", () => {
  const { db, store, secretBox, adminService } = createSecretHarness();

  try {
    const admin = store.createUser({
      email: "admin@example.test",
      passwordHash: "hash",
      displayName: "Admin",
      isAdmin: 1,
      status: "active"
    });
    store.setSetting("ai_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([{
      id: "ai-1",
      name: "Primary AI",
      baseUrl: "https://ai.example.test/v1",
      apiKey: "sk-ai-secret",
      model: "test-model",
      enabled: true,
      priority: 1
    }])));
    store.setSetting("translation_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([{
      id: "deeplx-1",
      name: "DeepLX",
      provider: "deeplx",
      baseUrl: "https://deeplx.example.test",
      apiKey: "tx-secret",
      enabled: true,
      priority: 1
    }])));
    store.setSetting("mail", "password", secretBox.encrypt("smtp-secret"));

    const dashboard = adminService.getDashboard();
    assert.equal(dashboard.settings.ai_provider_pool.configs[0].api_key_configured, true);
    assert.equal(dashboard.settings.ai_provider_pool.configs[0].apiKey, undefined);
    assert.equal(dashboard.settings.translation_provider_pool.configs[0].api_key_configured, true);
    assert.equal(dashboard.settings.translation_provider_pool.configs[0].apiKey, undefined);
    assert.equal(dashboard.settings.mail.password_configured, true);
    assert.equal(dashboard.settings.mail.password, undefined);

    const aiSecret = adminService.revealProviderSecret("ai", "ai-1", {
      actor: { id: admin.id, email: admin.email, displayName: admin.display_name },
      requestIp: "127.0.0.1"
    });
    assert.equal(aiSecret.apiKey, "sk-ai-secret");

    const translationSecret = adminService.revealProviderSecret("translation", "deeplx-1");
    assert.equal(translationSecret.apiKey, "tx-secret");

    const mailSecret = adminService.revealSettingSecret("mail", "password");
    assert.equal(mailSecret.value, "smtp-secret");

    const audits = store.listAuditLogs(10).filter((entry) => entry.action === "admin.settings.secret_revealed");
    assert.equal(audits.length, 3);
    assert.deepEqual(new Set(audits.map((entry) => entry.target_id)), new Set(["ai:ai-1", "translation:deeplx-1", "mail.password"]));
    audits.forEach((entry) => {
      assert.doesNotMatch(entry.details_json, /sk-ai-secret|tx-secret|smtp-secret/);
    });
  } finally {
    db.close();
  }
});
