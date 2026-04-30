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

function migrateApiSecrets(store, secretBox) {
  const secretKeys = new Set(["api_key", "password", "cookie"]);
  for (const setting of store.listSettings()) {
    if (secretKeys.has(setting.key) && setting.value && !secretBox.isEncrypted(setting.value)) {
      store.setSetting(setting.category, setting.key, secretBox.encrypt(setting.value));
    }
  }

  for (const user of store.listUsers()) {
    for (const setting of store.listUserSettings(user.id)) {
      if (secretKeys.has(setting.key) && setting.value && !secretBox.isEncrypted(setting.value)) {
        store.setUserSetting(user.id, setting.category, setting.key, secretBox.encrypt(setting.value));
      }
    }
  }
}

export function createRuntime(env = process.env) {
  const config = createConfig(env);
  const db = createDb(config.dbPath);
  const store = createStore(db);
  const ai = createAiClient();
  const secretBox = createSecretBox(config.appSecret);
  const translator = createTranslator({ ai });

  migrateApiSecrets(store, secretBox);

  const accountService = createAccountService({ store, config, secretBox });
  const authService = createAuthService({ store, config });
  const aiConfigService = createAiConfigService({ store, accountService, ai });
  const feedService = createFeedService({ store, accountService, config, translator, secretBox, ai });
  const mailService = createMailService({ store, secretBox });
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
    refreshService,
    maintenanceService
  });
  const itemService = createItemService({ feedService, translator, accountService, store, ai });
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
    aiConfigService
  });

  async function shutdown() {
    refreshService.stopSchedule();
    maintenanceService.stopSchedule();
    digestService.stopSchedule();
    await Promise.allSettled([
      refreshService.waitForIdle(),
      maintenanceService.waitForIdle(),
      digestService.waitForIdle()
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
      maintenanceService
    },
    shutdown
  };
}
