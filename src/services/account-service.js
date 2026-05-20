import { badRequest, forbidden } from "../lib/errors.js";
import {
  getProviderTargetCode,
  getTranslationProviderLabel,
  supportsServerTranslation
} from "./translator.js";

export function createAccountService({ store, config, secretBox }) {
  const allowedTranslationProviders = new Set(["google", "bing", "deeplx", "sogou", "ai"]);
  const entitledSubscriptionStatuses = new Set(["active", "trialing", "past_due"]);
  const translationTargets = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    en: "English",
    ja: "日本語",
    ko: "한국어"
  };
  const translationModes = {
    title: "仅标题",
    full: "标题和正文"
  };
  const defaultTranslationFallbackProviders = ["deeplx", "bing", "ai", "google"];
  const readerFeedUnreadFilters = new Set(["all", "unread", "read"]);
  const readerItemFilters = new Set(["all", "unread", "read", "favorite"]);

  function isSecretSettingKey(key) {
    return key === "api_key" || key === "password" || key === "configs_secret";
  }

  function markUnavailableSecret(output, category, key, rawValue, decryptedValue) {
    if (!output?.[category]) return;
    const hasRawValue = Boolean(String(rawValue || "").trim());
    const hasDecryptedValue = Boolean(String(decryptedValue || "").trim());
    if (key === "api_key") {
      output[category].api_key_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "password") {
      output[category].password_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "configs_secret") {
      output[category].configs_unavailable = hasRawValue && !hasDecryptedValue;
    }
  }

  function maskApiKey(output, category) {
    if (!output?.[category]) return;
    output[category].api_key_configured = Boolean(output[category].api_key || output[category].api_key_unavailable);
    delete output[category].api_key;
  }

  function maskPassword(output, category) {
    if (!output?.[category]) return;
    output[category].password_configured = Boolean(output[category].password || output[category].password_unavailable);
    delete output[category].password;
  }

  function withMaskedSecrets(settings) {
    const output = structuredClone(settings || {});
    maskApiKey(output, "ai");
    maskApiKey(output, "translation_google");
    maskApiKey(output, "translation_bing");
    maskApiKey(output, "translation_deeplx");
    maskPassword(output, "mail");
    return output;
  }

  function rowsToSettings(rows) {
    return rows.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = {};
      const isSecretKey = isSecretSettingKey(row.key);
      const value = isSecretKey ? secretBox.decrypt(row.value) : row.value;
      acc[row.category][row.key] = value;
      if (isSecretKey) markUnavailableSecret(acc, row.category, row.key, row.value, value);
      return acc;
    }, {});
  }

  function sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName || user.display_name,
      isAdmin: Boolean(user.isAdmin ?? user.is_admin),
      status: user.status
    };
  }

  function normalizeStoredBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function normalizeTranslationTarget(value, fallback = "zh-CN") {
    const candidate = String(value || "").trim();
    return translationTargets[candidate] ? candidate : fallback;
  }

  function normalizeOptionalBooleanOverride(value) {
    if (value === undefined || value === null || value === "") return null;
    return normalizeStoredBoolean(value, false);
  }

  function getTranslationTargetLabel(code) {
    return translationTargets[normalizeTranslationTarget(code)] || translationTargets["zh-CN"];
  }

  function normalizeTranslationMode(value, fallback = "title") {
    const candidate = String(value || "").trim().toLowerCase();
    return translationModes[candidate] ? candidate : fallback;
  }

  function normalizeReaderFeedUnreadFilter(value, fallback = "all") {
    const candidate = String(value || "").trim().toLowerCase();
    return readerFeedUnreadFilters.has(candidate) ? candidate : fallback;
  }

  function normalizeReaderItemFilter(value, fallback = "all") {
    const candidate = String(value || "").trim().toLowerCase();
    return readerItemFilters.has(candidate) ? candidate : fallback;
  }

  function getTranslationModeLabel(code) {
    return translationModes[normalizeTranslationMode(code)] || translationModes.title;
  }

  function normalizeTranslationFallbackProviders(value) {
    const rawProviders = Array.isArray(value)
      ? value
      : String(value || "")
          .split(/[,\s，、]+/u)
          .filter(Boolean);
    const providers = rawProviders
      .map((provider) => String(provider || "").trim().toLowerCase())
      .filter((provider) => ["google", "bing", "deeplx", "ai"].includes(provider))
      .filter((provider, index, all) => all.indexOf(provider) === index);
    return providers.length ? providers : defaultTranslationFallbackProviders;
  }

  function parseJsonSafe(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function getSystemTranslationProviderPool() {
    const settings = listSettingsMap();
    const configs = parseJsonSafe(settings.translation_provider_pool?.configs_secret, []);
    return (Array.isArray(configs) ? configs : [])
      .map((entry, index) => ({
        id: String(entry?.id || `${entry?.provider || "provider"}-${index + 1}`).trim(),
        name: String(entry?.name || "").trim(),
        provider: String(entry?.provider || "").trim().toLowerCase(),
        baseUrl: String(entry?.baseUrl ?? entry?.base_url ?? "").trim(),
        apiKey: String(entry?.apiKey ?? entry?.api_key ?? "").trim(),
        region: String(entry?.region || "").trim(),
        model: String(entry?.model || "").trim(),
        enabled: entry?.enabled !== false,
        priority: Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : index + 1
      }))
      .filter((entry) => ["google", "bing", "deeplx", "ai"].includes(entry.provider))
      .sort((left, right) => left.priority - right.priority);
  }

  function getSystemAiProviderPool() {
    const settings = listSettingsMap();
    const configs = parseJsonSafe(settings.ai_provider_pool?.configs_secret, []);
    return (Array.isArray(configs) ? configs : [])
      .map((entry, index) => ({
        id: String(entry?.id || `ai-${index + 1}`).trim(),
        name: String(entry?.name || "").trim(),
        baseUrl: String(entry?.baseUrl ?? entry?.base_url ?? "").trim(),
        apiKey: String(entry?.apiKey ?? entry?.api_key ?? "").trim(),
        model: String(entry?.model || "").trim(),
        translatePrompt: String(entry?.translatePrompt ?? entry?.translate_prompt ?? "").trim(),
        summaryPrompt: String(entry?.summaryPrompt ?? entry?.summary_prompt ?? "").trim(),
        maxInputChars: Number.isFinite(Number(entry?.maxInputChars ?? entry?.max_input_chars)) ? Number(entry?.maxInputChars ?? entry?.max_input_chars) : 0,
        enabled: entry?.enabled !== false,
        priority: Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : index + 1
      }))
      .filter((entry) => entry.baseUrl || entry.apiKey)
      .sort((left, right) => left.priority - right.priority);
  }

  function listSettingsMap() {
    return rowsToSettings(store.listSettings());
  }

  function listUserSettingsMap(userId) {
    return userId ? rowsToSettings(store.listUserSettings(userId)) : {};
  }

  function getUserSecretValue(userId, category, key) {
    const normalizedCategory = String(category || "").trim().toLowerCase();
    const normalizedKey = String(key || "").trim().toLowerCase();
    const allowedSecrets = new Set([
      "ai.api_key",
      "translation_google.api_key",
      "translation_bing.api_key",
      "translation_deeplx.api_key"
    ]);
    if (!allowedSecrets.has(`${normalizedCategory}.${normalizedKey}`)) {
      throw badRequest("密钥类型无效", { code: "invalid_secret_setting" });
    }

    const row = store.getUserSetting(userId, normalizedCategory, normalizedKey);
    return {
      category: normalizedCategory,
      key: normalizedKey,
      value: secretBox.decrypt(row?.value || "")
    };
  }

  function getStoredTranslationProviderConfig(settings, provider, scope = "system") {
    const map = settings || {};

    if (provider === "google") {
      const google = map.translation_google || {};
      return {
        provider,
        apiKey: String(google.api_key || "").trim(),
        baseUrl: "",
        region: "",
        scope: "system"
      };
    }

    if (provider === "bing") {
      const bing = map.translation_bing || {};
      return {
        provider,
        apiKey: String(bing.api_key || "").trim(),
        baseUrl: String(bing.base_url || "").trim(),
        region: String(bing.region || "").trim(),
        scope: "system"
      };
    }

    if (provider === "deeplx") {
      const deeplx = map.translation_deeplx || {};
      return {
        provider,
        apiKey: String(deeplx.api_key || "").trim(),
        baseUrl: String(deeplx.base_url || "").trim(),
        region: "",
        scope
      };
    }

    return {
      provider,
      apiKey: "",
      baseUrl: "",
      region: "",
      scope: "system"
    };
  }

  function getSystemTranslationProviderConfig(provider) {
    return getStoredTranslationProviderConfig(listSettingsMap(), provider, "system");
  }

  function getUserTranslationProviderConfig(userId, provider) {
    return getStoredTranslationProviderConfig(listUserSettingsMap(userId), provider, "user");
  }

  function hasTranslationProviderCredentials(providerConfig) {
    if (String(providerConfig?.provider || "").trim().toLowerCase() === "ai") {
      return Boolean(String(providerConfig?.baseUrl || "").trim() && String(providerConfig?.apiKey || "").trim());
    }
    if (String(providerConfig?.provider || "").trim().toLowerCase() === "deeplx") {
      return Boolean(String(providerConfig?.baseUrl || "").trim());
    }
    return Boolean(String(providerConfig?.apiKey || "").trim());
  }

  function hasTranslationProviderOverride(providerConfig) {
    return Boolean(
      String(providerConfig?.apiKey || "").trim() ||
        String(providerConfig?.baseUrl || "").trim() ||
        String(providerConfig?.region || "").trim()
    );
  }

  function resolveTranslationProviderConfig(userId, provider) {
    const userConfig = getUserTranslationProviderConfig(userId, provider);
    const systemConfig = getSystemTranslationProviderConfig(provider);
    const source =
      provider === "google" && !hasTranslationProviderOverride(userConfig) && !hasTranslationProviderOverride(systemConfig)
        ? "public"
        : hasTranslationProviderOverride(userConfig)
          ? "user"
          : hasTranslationProviderOverride(systemConfig)
            ? "system"
            : "none";

    return {
      provider,
      apiKey: userConfig.apiKey || systemConfig.apiKey || "",
      baseUrl: userConfig.baseUrl || systemConfig.baseUrl || "",
      region: userConfig.region || systemConfig.region || "",
      source,
      userConfigured: hasTranslationProviderCredentials(userConfig),
      systemConfigured: hasTranslationProviderCredentials(systemConfig)
    };
  }

  function getSystemTranslationProviderPoolConfigs(provider) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    return getSystemTranslationProviderPool()
      .filter((entry) => entry.enabled && entry.provider === normalizedProvider)
      .filter((entry) => hasTranslationProviderCredentials(entry));
  }

  function getTranslationProviderStatus(userId, provider) {
    const normalizedProvider = allowedTranslationProviders.has(String(provider || "").trim())
      ? String(provider || "").trim()
      : "google";

    if (normalizedProvider === "ai") {
      const aiConfig = listUserSettingsOrDefault(userId);
      return {
        provider: normalizedProvider,
        providerLabel: getTranslationProviderLabel(normalizedProvider),
        configured: Boolean(aiConfig.baseUrl && aiConfig.apiKey),
        autoTranslateSupported: true,
        scope: aiConfig.source,
        userConfigured: aiConfig.source === "user" && Boolean(aiConfig.baseUrl && aiConfig.apiKey),
        systemConfigured: aiConfig.source === "system" && Boolean(aiConfig.baseUrl && aiConfig.apiKey)
      };
    }

    const effectiveConfig = resolveTranslationProviderConfig(userId, normalizedProvider);
    const poolConfigs = getSystemTranslationProviderPoolConfigs(normalizedProvider);
    return {
      provider: normalizedProvider,
      providerLabel: getTranslationProviderLabel(normalizedProvider),
      configured:
        poolConfigs.length
          ? true
          : normalizedProvider === "sogou"
          ? false
          : normalizedProvider === "google"
            ? true
            : hasTranslationProviderCredentials(effectiveConfig),
      autoTranslateSupported: supportsServerTranslation(normalizedProvider),
      scope: effectiveConfig.source,
      userConfigured: effectiveConfig.userConfigured,
      systemConfigured: effectiveConfig.systemConfigured
    };
  }

  function resolveTranslationSettings(baseSettings, overrides = {}) {
    return {
      provider: baseSettings.provider,
      targetLanguage: normalizeTranslationTarget(
        overrides.targetLanguage ?? overrides.target_language ?? overrides.translation_target_language,
        baseSettings.targetLanguage
      ),
      autoTranslate:
        normalizeOptionalBooleanOverride(overrides.autoTranslate ?? overrides.auto_translate) ?? baseSettings.autoTranslate,
      displayTranslated:
        normalizeOptionalBooleanOverride(overrides.displayTranslated ?? overrides.display_translated) ??
        baseSettings.displayTranslated,
      translationMode: normalizeTranslationMode(
        overrides.translationMode ?? overrides.translation_mode,
        baseSettings.translationMode
      )
    };
  }

  function getEffectiveTranslationSettings(userId, overrides = null) {
    const systemTranslation = listSettingsMap().translation || {};
    const userTranslation = listUserSettingsMap(userId).translation || {};
    const systemProvider = allowedTranslationProviders.has(String(systemTranslation.provider || "").trim())
      ? String(systemTranslation.provider || "").trim()
      : "google";
    const provider = allowedTranslationProviders.has(String(userTranslation.provider || "").trim())
      ? String(userTranslation.provider || "").trim()
      : systemProvider;
    const targetLanguage = normalizeTranslationTarget(
      userTranslation.target_language,
      normalizeTranslationTarget(systemTranslation.target_language, "zh-CN")
    );
    const translationMode = normalizeTranslationMode(
      userTranslation.translation_mode,
      normalizeTranslationMode(systemTranslation.translation_mode, "title")
    );
    const hasUserAutoTranslate = Object.prototype.hasOwnProperty.call(userTranslation, "auto_translate");
    const hasUserDisplayTranslated = Object.prototype.hasOwnProperty.call(userTranslation, "display_translated");

    const globalSettings = {
      provider,
      targetLanguage,
      autoTranslate: hasUserAutoTranslate ? normalizeStoredBoolean(userTranslation.auto_translate, false) : false,
      displayTranslated: hasUserDisplayTranslated ? normalizeStoredBoolean(userTranslation.display_translated, true) : true,
      translationMode
    };

    return overrides ? resolveTranslationSettings(globalSettings, overrides) : globalSettings;
  }

  function parseTranslationModeForUpdate(value) {
    const candidate = String(value || "").trim().toLowerCase();
    if (!translationModes[candidate]) {
      throw badRequest("翻译范围无效", { code: "invalid_translation_mode" });
    }
    return candidate;
  }

  function listUserSettingsOrDefault(userId, options = {}) {
    const system = listSettingsMap().ai || {};
    const user = listUserSettingsMap(userId).ai || {};
    const targetLanguage = normalizeTranslationTarget(options.targetLanguage, "zh-CN");
    return {
      enabled: config.aiEnabled,
      provider: "ai",
      baseUrl: user.base_url || system.base_url || "",
      apiKey: user.api_key || system.api_key || "",
      model: user.model || system.model || "gpt-4.1-mini",
      translatePrompt:
        user.translate_prompt ||
        system.translate_prompt ||
        `Translate the article into ${getTranslationTargetLabel(targetLanguage)}. Preserve structure and proper nouns where appropriate.`,
      summaryPrompt: user.summary_prompt || system.summary_prompt || "",
      source: user.base_url || user.api_key || user.model || user.translate_prompt || user.summary_prompt ? "user" : "system",
      targetLanguage,
      targetLanguageCode: getProviderTargetCode("ai", targetLanguage)
    };
  }

  function getResolvedPlan(userId) {
    const subscription = store.getUserSubscription(userId);
    const fallbackPlan = store.getPlanByCode("free");
    if (!subscription) {
      return {
        subscription: null,
        plan: fallbackPlan
      };
    }

    if (!entitledSubscriptionStatuses.has(String(subscription.status || "").trim().toLowerCase())) {
      return {
        subscription,
        plan: fallbackPlan
      };
    }

    return {
      subscription,
        plan: {
          id: subscription.plan_id,
          code: subscription.plan_code,
          name: subscription.plan_name,
          description: subscription.plan_description,
        price_monthly_cents: subscription.price_monthly_cents,
        max_feeds: subscription.max_feeds,
          max_saved_items: subscription.max_saved_items,
          max_favorite_items: subscription.max_favorite_items,
          ai_translation_enabled: subscription.ai_translation_enabled,
          ai_summary_enabled: subscription.ai_summary_enabled,
          custom_ai_enabled: subscription.custom_ai_enabled,
          ai_digest_enabled: subscription.ai_digest_enabled,
          email_digest_enabled: subscription.email_digest_enabled,
          max_digest_rules: subscription.max_digest_rules,
          stripe_price_id: subscription.stripe_price_id
        }
      };
  }

  return {
    getTranslationTargetLabel,
    getSupportedTranslationTargets() {
      return { ...translationTargets };
    },
    getSupportedTranslationModes() {
      return { ...translationModes };
    },
    getEffectiveAiConfig(userId, options = {}) {
      return listUserSettingsOrDefault(userId, {
        targetLanguage: options.targetLanguage || null
      });
    },
    getEffectiveAiRuntimes(userId, options = {}) {
      const userAi = this.getEffectiveAiConfig(userId, options);
      const pool = getSystemAiProviderPool().filter((entry) => entry.enabled);
      const poolRuntimes = pool.map((entry) => ({
        provider: "ai",
        id: entry.id,
        baseUrl: entry.baseUrl,
        apiKey: entry.apiKey,
        model: entry.model || userAi.model,
        translatePrompt: entry.translatePrompt || userAi.translatePrompt,
        summaryPrompt: entry.summaryPrompt || userAi.summaryPrompt,
        maxInputChars: entry.maxInputChars || 0,
        targetLanguage: userAi.targetLanguage,
        targetLanguageCode: userAi.targetLanguageCode,
        source: "system_pool",
        label: entry.name || entry.id
      }));
      return [userAi, ...poolRuntimes].filter((entry) => entry.baseUrl && entry.apiKey);
    },
    getSystemAiProviderPool,
    getSystemTranslationProviderPool,
    getEffectiveTranslationRuntime(userId, options = {}) {
      const provider = allowedTranslationProviders.has(String(options.provider || "").trim())
        ? String(options.provider || "").trim()
        : getEffectiveTranslationSettings(userId).provider;
      const targetLanguage = normalizeTranslationTarget(
        options.targetLanguage,
        getEffectiveTranslationSettings(userId).targetLanguage
      );

      if (provider === "ai") {
        return this.getEffectiveAiConfig(userId, { targetLanguage });
      }

      const systemProvider = resolveTranslationProviderConfig(userId, provider);
      return {
        provider,
        targetLanguage,
        targetLanguageCode: getProviderTargetCode(provider, targetLanguage),
        apiKey: systemProvider.apiKey,
        baseUrl: systemProvider.baseUrl,
        region: systemProvider.region,
        source: systemProvider.source
      };
    },
    getEffectiveTranslationRuntimes(userId, options = {}) {
      const provider = allowedTranslationProviders.has(String(options.provider || "").trim())
        ? String(options.provider || "").trim()
        : getEffectiveTranslationSettings(userId).provider;
      const targetLanguage = normalizeTranslationTarget(
        options.targetLanguage,
        getEffectiveTranslationSettings(userId).targetLanguage
      );
      if (provider === "ai") {
        const userAi = this.getEffectiveAiConfig(userId, { targetLanguage });
        const poolAi = getSystemTranslationProviderPoolConfigs("ai").map((entry) => ({
          provider: "ai",
          targetLanguage,
          targetLanguageCode: getProviderTargetCode("ai", targetLanguage),
          id: entry.id,
          baseUrl: entry.baseUrl,
          apiKey: entry.apiKey,
          model: entry.model || userAi.model,
          translatePrompt: userAi.translatePrompt,
          summaryPrompt: userAi.summaryPrompt,
          source: "system_pool",
          label: entry.name || entry.id
        }));
        return [userAi, ...poolAi].filter((entry) => entry.baseUrl && entry.apiKey);
      }
      const primary = this.getEffectiveTranslationRuntime(userId, { provider, targetLanguage });
      const pool = getSystemTranslationProviderPoolConfigs(provider).map((entry) => ({
        provider,
        targetLanguage,
        targetLanguageCode: getProviderTargetCode(provider, targetLanguage),
        id: entry.id,
        apiKey: entry.apiKey,
        baseUrl: entry.baseUrl,
        region: entry.region,
        source: "system_pool",
        label: entry.name || entry.id
      }));
      return [primary, ...pool];
    },
    getEffectiveTranslationSettings,
    getTranslationFallbackProviders() {
      const systemTranslation = listSettingsMap().translation || {};
      return normalizeTranslationFallbackProviders(systemTranslation.fallback_providers);
    },
    getTranslationProviderStatus,
    getEffectiveFeedTranslationSettings(userId, feed = {}, options = {}) {
      const effective = options.baseTranslation
        ? resolveTranslationSettings(options.baseTranslation, feed)
        : getEffectiveTranslationSettings(userId, feed);
      const providerStatus =
        options.providerStatus?.provider === effective.provider
          ? options.providerStatus
          : getTranslationProviderStatus(userId, effective.provider);
      return {
        ...effective,
        providerLabel: providerStatus.providerLabel,
        providerConfigured: providerStatus.configured,
        autoTranslateSupported: providerStatus.autoTranslateSupported,
        targetLabel: getTranslationTargetLabel(effective.targetLanguage),
        translationModeLabel: getTranslationModeLabel(effective.translationMode)
      };
    },
    getUserPreferences(userId) {
      const settings = withMaskedSecrets(listUserSettingsMap(userId));
      Object.keys(settings).forEach((category) => {
        if (String(category || "").startsWith("feed_fetch:")) {
          delete settings[category];
        }
      });
      const translation = getEffectiveTranslationSettings(userId);
      const reader = settings.reader || {};
      settings.translation = {
        ...(settings.translation || {}),
        provider: translation.provider,
        target_language: translation.targetLanguage,
        auto_translate: translation.autoTranslate ? "1" : "0",
        display_translated: translation.displayTranslated ? "1" : "0",
        translation_mode: translation.translationMode
      };
      settings.reader = {
        ...reader,
        feed_unread_filter: normalizeReaderFeedUnreadFilter(reader.feed_unread_filter, "all"),
        item_filter: normalizeReaderItemFilter(reader.item_filter, "all"),
        feed_unread_filter_saved: Object.prototype.hasOwnProperty.call(reader, "feed_unread_filter"),
        item_filter_saved: Object.prototype.hasOwnProperty.call(reader, "item_filter")
      };
      return settings;
    },
    revealUserSecret(user, category, key) {
      if (!user?.id) {
        throw forbidden("请先登录", { code: "login_required" });
      }
      return getUserSecretValue(user.id, category, key);
    },
    updateUserAiSettings(user, payload) {
      const account = this.getAccount(user);
      if (!account.features.customAi) {
        throw forbidden("当前套餐不支持自定义 AI 接口", { code: "custom_ai_unavailable" });
      }

      const current = listUserSettingsMap(user.id).ai || {};
      const nextApiKey = String(payload.apiKey || "").trim();
      const aiSettings = {
        base_url: String(payload.baseUrl || ""),
        api_key: nextApiKey ? secretBox.encrypt(nextApiKey) : current.api_key ? secretBox.encrypt(current.api_key) : "",
        model: String(payload.model || ""),
        translate_prompt: String(payload.translatePrompt || ""),
        summary_prompt: String(payload.summaryPrompt || "")
      };

      for (const [key, value] of Object.entries(aiSettings)) {
        store.setUserSetting(user.id, "ai", key, value);
      }

      return this.getUserPreferences(user.id);
    },
    updateUserTranslationProviderSettings(user, provider, payload) {
      const normalizedProvider = String(provider || "").trim().toLowerCase();
      if (!["google", "bing", "deeplx"].includes(normalizedProvider)) {
        throw badRequest("翻译工具无效", { code: "invalid_translation_provider" });
      }

      const currentMap = listUserSettingsMap(user.id);
      if (normalizedProvider === "google") {
        const current = currentMap.translation_google || {};
        const nextApiKey = String(payload.apiKey || "").trim();
        store.setUserSetting(
          user.id,
          "translation_google",
          "api_key",
          nextApiKey ? secretBox.encrypt(nextApiKey) : current.api_key ? secretBox.encrypt(current.api_key) : ""
        );
        return this.getUserPreferences(user.id);
      }

      if (normalizedProvider === "bing") {
        const current = currentMap.translation_bing || {};
        const nextApiKey = String(payload.apiKey || "").trim();
        const bingSettings = {
          base_url: String(payload.baseUrl || ""),
          api_key: nextApiKey ? secretBox.encrypt(nextApiKey) : current.api_key ? secretBox.encrypt(current.api_key) : "",
          region: String(payload.region || "")
        };
        for (const [key, value] of Object.entries(bingSettings)) {
          store.setUserSetting(user.id, "translation_bing", key, value);
        }
        return this.getUserPreferences(user.id);
      }

      if (normalizedProvider === "deeplx") {
        const current = currentMap.translation_deeplx || {};
        const nextApiKey = String(payload.apiKey || "").trim();
        const deeplxSettings = {
          base_url: String(payload.baseUrl || ""),
          api_key: nextApiKey ? secretBox.encrypt(nextApiKey) : current.api_key ? secretBox.encrypt(current.api_key) : ""
        };
        for (const [key, value] of Object.entries(deeplxSettings)) {
          store.setUserSetting(user.id, "translation_deeplx", key, value);
        }
        return this.getUserPreferences(user.id);
      }
    },
    resetUserTranslationProviderSettings(user, provider) {
      const normalizedProvider = String(provider || "").trim().toLowerCase();
      if (!["google", "bing", "deeplx"].includes(normalizedProvider)) {
        throw badRequest("翻译工具无效", { code: "invalid_translation_provider" });
      }

      if (normalizedProvider === "google") {
        store.setUserSetting(user.id, "translation_google", "api_key", "");
        return this.getUserPreferences(user.id);
      }

      if (normalizedProvider === "bing") {
        store.setUserSetting(user.id, "translation_bing", "base_url", "");
        store.setUserSetting(user.id, "translation_bing", "api_key", "");
        store.setUserSetting(user.id, "translation_bing", "region", "");
        return this.getUserPreferences(user.id);
      }

      if (normalizedProvider === "deeplx") {
        store.setUserSetting(user.id, "translation_deeplx", "base_url", "");
        store.setUserSetting(user.id, "translation_deeplx", "api_key", "");
        return this.getUserPreferences(user.id);
      }
    },
    updateUserTranslationSettings(user, payload) {
      const provider = String(payload.provider || "").trim().toLowerCase();
      const targetLanguage = String(payload.targetLanguage || payload.target_language || "").trim();
      if (!allowedTranslationProviders.has(provider)) {
        throw badRequest("翻译工具无效", { code: "invalid_translation_provider" });
      }
      if (!translationTargets[targetLanguage]) {
        throw badRequest("目标语言无效", { code: "invalid_translation_target" });
      }
      if (payload.autoTranslate && !supportsServerTranslation(provider)) {
        throw badRequest("当前翻译工具暂不支持自动翻译", { code: "translation_auto_unsupported" });
      }
      const translationMode = parseTranslationModeForUpdate(payload.translationMode ?? payload.translation_mode ?? "title");

      const translationSettings = {
        provider,
        target_language: targetLanguage,
        auto_translate: payload.autoTranslate ? "1" : "0",
        display_translated: payload.displayTranslated === false ? "0" : "1",
        translation_mode: translationMode
      };

      for (const [key, value] of Object.entries(translationSettings)) {
        store.setUserSetting(user.id, "translation", key, String(value));
      }

      return this.getUserPreferences(user.id);
    },
    updateUserReaderSettings(user, payload) {
      const nextFeedUnreadFilter = normalizeReaderFeedUnreadFilter(payload.feedUnreadFilter, "");
      const nextItemFilter = normalizeReaderItemFilter(payload.itemFilter, "");

      if (!nextFeedUnreadFilter) {
        throw badRequest("订阅源默认筛选无效", { code: "invalid_reader_feed_unread_filter" });
      }
      if (!nextItemFilter) {
        throw badRequest("文章列表默认筛选无效", { code: "invalid_reader_item_filter" });
      }

      store.setUserSetting(user.id, "reader", "feed_unread_filter", nextFeedUnreadFilter);
      store.setUserSetting(user.id, "reader", "item_filter", nextItemFilter);
      return this.getUserPreferences(user.id);
    },
    getAccount(user) {
      const safeUser = sanitizeUser(user);
      const { plan, subscription } = getResolvedPlan(user.id);
      const feedCount = store.countUserFeeds(user.id);
      const savedItemCount = store.countUserItems(user.id, null);
      const favoriteCount = store.countUserFavorites(user.id);
      const aiConfig = this.getEffectiveAiConfig(user.id);
      const translation = getEffectiveTranslationSettings(user.id);
      const providerStatus = getTranslationProviderStatus(user.id, translation.provider);
      const translationProviders = Array.from(allowedTranslationProviders).reduce((acc, provider) => {
        const status = getTranslationProviderStatus(user.id, provider);
        acc[provider] = {
          provider: status.provider,
          providerLabel: status.providerLabel,
          configured: status.configured,
          source: status.scope,
          autoTranslateSupported: status.autoTranslateSupported,
          userConfigured: status.userConfigured,
          systemConfigured: status.systemConfigured
        };
        return acc;
      }, {});
      const translationProviderPool = getSystemTranslationProviderPool().map((entry) => ({
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        providerLabel: getTranslationProviderLabel(entry.provider),
        baseUrl: entry.baseUrl,
        region: entry.region,
        enabled: entry.enabled,
        priority: entry.priority,
        apiKeyConfigured: Boolean(entry.apiKey)
      }));

      return {
        user: safeUser,
        plan,
        subscription,
        usage: {
          feedCount,
          feedLimit: plan.max_feeds,
          savedItemCount,
          savedItemLimit: plan.max_saved_items,
          favoriteCount,
          favoriteLimit: plan.max_favorite_items,
          digestRules: store.countDigestRulesByUser?.(user.id) ?? 0,
          digestRuleLimit: plan.max_digest_rules || 0
        },
        features: {
          translation: Boolean(config.aiEnabled && plan.ai_translation_enabled),
          summary: Boolean(config.aiEnabled && plan.ai_summary_enabled),
          customAi: Boolean(config.aiEnabled && plan.custom_ai_enabled),
          digest: Boolean(config.aiEnabled && plan.ai_digest_enabled),
          emailDigest: Boolean(config.aiEnabled && plan.email_digest_enabled)
        },
        limits: {
          digestRules: plan.max_digest_rules || 0
        },
        permissions: {
          admin: Boolean(safeUser.isAdmin)
        },
        ai: {
          source: aiConfig.source,
          hasConfiguredProvider: Boolean(aiConfig.baseUrl && aiConfig.apiKey)
        },
        translation: {
          provider: translation.provider,
          providerLabel: providerStatus.providerLabel,
          providerSource: providerStatus.scope,
          targetLanguage: translation.targetLanguage,
          targetLabel: getTranslationTargetLabel(translation.targetLanguage),
          translationMode: translation.translationMode,
          translationModeLabel: getTranslationModeLabel(translation.translationMode),
          autoTranslate: translation.autoTranslate,
          displayTranslated: translation.displayTranslated,
          providerConfigured: providerStatus.configured,
          autoTranslateActive: Boolean(
            translation.autoTranslate &&
              providerStatus.autoTranslateSupported &&
              providerStatus.configured &&
              config.aiEnabled &&
              plan.ai_translation_enabled
          ),
          autoTranslateSupported: providerStatus.autoTranslateSupported
        },
        translationProviders,
        translationProviderPool
      };
    },
    getResolvedPlan
  };
}
