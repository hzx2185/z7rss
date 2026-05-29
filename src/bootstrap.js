import { createApp } from "./app.js";
import { createConfig } from "./config.js";
import { createDb } from "./db.js";
import { createSecretBox } from "./lib/secrets.js";
import { createStore } from "./repositories/store.js";
import { createAccountService } from "./services/account-service.js";
import { createAiClient } from "./services/ai.js";
import { createAiConfigService } from "./services/ai-config-service.js";
import { createAdminService } from "./services/admin-service.js";
import { createAuthService } from "./services/auth-service.js";
import { createBillingService } from "./services/billing-service.js";
import { createFeedService } from "./services/feed-service.js";
import { createItemService } from "./services/item-service.js";
import { createDigestService } from "./services/digest-service.js";
import { createMailService } from "./services/mail-service.js";
import { createMaintenanceService } from "./services/maintenance-service.js";
import { createRefreshService } from "./services/refresh-service.js";
import { createTranslator } from "./services/translator.js";
import { createOpmlBackupService } from "./services/opml-backup-service.js";

function migrateApiSecrets(store, secretBox) {
  const secretKeys = new Set(["api_key", "password", "cookie", "configs_secret"]);
  for (const setting of store.listSettings()) {
    if (secretKeys.has(setting.key) && setting.value && !secretBox.isEncrypted(setting.value)) {
      store.setSetting(setting.category, setting.key, secretBox.encrypt(setting.value));
    } else if (secretKeys.has(setting.key) && secretBox.needsRotation?.(setting.value)) {
      store.setSetting(setting.category, setting.key, secretBox.encrypt(secretBox.decrypt(setting.value)));
    }
  }

  for (const user of store.listUsers()) {
    for (const setting of store.listUserSettings(user.id)) {
      if (secretKeys.has(setting.key) && setting.value && !secretBox.isEncrypted(setting.value)) {
        store.setUserSetting(user.id, setting.category, setting.key, secretBox.encrypt(setting.value));
      } else if (secretKeys.has(setting.key) && secretBox.needsRotation?.(setting.value)) {
        store.setUserSetting(user.id, setting.category, setting.key, secretBox.encrypt(secretBox.decrypt(setting.value)));
      }
    }
  }
}

function migrateAiConfigToPool(store, secretBox) {
  const settings = store.listSettings();
  const hasPool = settings.some((s) => s.category === "ai_provider_pool" && s.key === "configs_secret");
  if (hasPool) return;

  const aiSettings = {};
  for (const s of settings) {
    if (s.category === "ai") {
      aiSettings[s.key] = secretBox.isEncrypted(s.value) ? secretBox.decrypt(s.value) : s.value;
    }
  }

  const baseUrl = String(aiSettings.base_url || "").trim();
  const apiKey = String(aiSettings.api_key || "").trim();
  if (!baseUrl && !apiKey) return;

  const entry = {
    id: "ai-migrated-1",
    name: "默认 AI",
    baseUrl,
    apiKey,
    model: String(aiSettings.model || "").trim(),
    translatePrompt: String(aiSettings.translate_prompt || "").trim(),
    summaryPrompt: String(aiSettings.summary_prompt || "").trim(),
    priority: 1,
    enabled: true
  };

  const encrypted = secretBox.encrypt(JSON.stringify([entry]));
  store.setSetting("ai_provider_pool", "configs_secret", encrypted);
}

export function createRuntime(env = process.env) {
  const config = createConfig(env);
  const db = createDb(config.dbPath, {
    synchronous: config.databaseSynchronous,
    busyTimeoutMs: config.databaseBusyTimeoutMs,
    stripePriceProMonthly: config.stripePriceProMonthly,
    stripePriceTeamMonthly: config.stripePriceTeamMonthly
  });
  const store = createStore(db);
  const ai = createAiClient();
  const secretBox = createSecretBox(config.appSecret, {
    fallbackSecrets: config.legacyAppSecrets
  });
  const translator = createTranslator({ ai });

  migrateApiSecrets(store, secretBox);
  migrateAiConfigToPool(store, secretBox);

  const accountService = createAccountService({ store, config, secretBox });
  const authService = createAuthService({ store, config });
  const aiConfigService = createAiConfigService({ accountService, ai, translator });
  const feedService = createFeedService({ store, accountService, config, translator, secretBox, ai });
  const mailService = createMailService({ store, secretBox });
  const opmlBackupService = createOpmlBackupService({ store, feedService, mailService });
  const digestService = createDigestService({ store, accountService, ai, mailService, config });
  const refreshService = createRefreshService({ store, feedService, config });
  const maintenanceService = createMaintenanceService({ store, feedService, config });
  const billingService = createBillingService({ store, accountService, config, feedService });
  const adminService = createAdminService({
    store,
    accountService,
    config,
    secretBox,
    feedService,
    ai,
    refreshService,
    maintenanceService
  });
  const itemService = createItemService({ feedService, translator, accountService, store, ai });
  feedService.setItemTitleTranslationScheduler?.(({ userId, feedId, limit }) =>
    itemService.translateRecentItemsForRefresh(userId, feedId, { limit })
  );
  const app = createApp({
    config,
    store,
    authService,
    accountService,
    feedService,
    itemService,
    digestService,
    billingService,
    adminService,
    aiConfigService,
    mailService,
    opmlBackupService
  });

  async function shutdown() {
    refreshService.stopSchedule();
    maintenanceService.stopSchedule();
    digestService.stopSchedule();
    opmlBackupService.stopSchedule();
    await Promise.allSettled([
      refreshService.waitForIdle(),
      maintenanceService.waitForIdle(),
      digestService.waitForIdle(),
      opmlBackupService.waitForIdle()
    ]);
    store.close?.();
  }

  return {
    app,
    config,
    services: {
      feedService,
      digestService,
      refreshService,
      maintenanceService,
      opmlBackupService
    },
    shutdown
  };
}
