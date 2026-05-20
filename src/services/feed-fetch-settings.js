export function createFeedFetchSettings({ store, secret }) {
  const FEED_FETCH_CATEGORY_PREFIX = "feed_fetch:";
  const MAX_FEED_FETCH_TIMEOUT_MS = 120000;
  const feedFetchSecretKeys = new Set(["password", "cookie"]);
  const supportedFetchRequestProfiles = new Set(["auto", "browser", "bot"]);
  const supportedFeedFetchFormats = new Set(["auto", "rss", "atom", "json"]);

  function getFeedFetchCategory(feedId) {
    return `${FEED_FETCH_CATEGORY_PREFIX}${Number(feedId || 0)}`;
  }

  function normalizeFetchRequestProfile(value, fallback = "auto") {
    const candidate = String(value || "").trim().toLowerCase();
    return supportedFetchRequestProfiles.has(candidate) ? candidate : fallback;
  }

  function normalizeFeedFetchFormat(value, fallback = "auto") {
    const candidate = String(value || "").trim().toLowerCase();
    return supportedFeedFetchFormats.has(candidate) ? candidate : fallback;
  }

  function normalizeFeedFetchTimeout(value, fallback = null) {
    if (value === undefined || value === null || value === "") {
      return fallback === null ? null : normalizeFeedFetchTimeout(fallback, null);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1000) {
      return fallback === null ? null : normalizeFeedFetchTimeout(fallback, null);
    }
    return Math.min(MAX_FEED_FETCH_TIMEOUT_MS, Math.round(parsed));
  }

  function normalizeFetchSettingText(value) {
    return String(value || "").trim();
  }

  function decodeFeedFetchRows(rows = []) {
    return rows.reduce((acc, row) => {
      acc[row.key] = feedFetchSecretKeys.has(row.key) ? secret.decrypt(row.value) : row.value;
      return acc;
    }, {});
  }

  function normalizeFeedFetchSettings(raw = {}) {
    return {
      request_profile: normalizeFetchRequestProfile(raw.request_profile, "auto"),
      feed_format: normalizeFeedFetchFormat(raw.feed_format, "auto"),
      timeout_ms: normalizeFeedFetchTimeout(raw.timeout_ms, null),
      feed_url: normalizeFetchSettingText(raw.feed_url),
      login_url: normalizeFetchSettingText(raw.login_url),
      username: normalizeFetchSettingText(raw.username),
      password: normalizeFetchSettingText(raw.password),
      username_field: normalizeFetchSettingText(raw.username_field) || "username",
      password_field: normalizeFetchSettingText(raw.password_field) || "password",
      cookie: normalizeFetchSettingText(raw.cookie),
      article_selector: normalizeFetchSettingText(raw.article_selector),
      page_selector: normalizeFetchSettingText(raw.page_selector),
      html_start: normalizeFetchSettingText(raw.html_start),
      html_end: normalizeFetchSettingText(raw.html_end),
      json_items_path: normalizeFetchSettingText(raw.json_items_path),
      json_title_path: normalizeFetchSettingText(raw.json_title_path),
      json_link_path: normalizeFetchSettingText(raw.json_link_path),
      json_date_path: normalizeFetchSettingText(raw.json_date_path),
      json_summary_path: normalizeFetchSettingText(raw.json_summary_path),
      json_content_path: normalizeFetchSettingText(raw.json_content_path)
    };
  }

  function hasCustomFeedFetchSettings(settings = {}) {
    const normalized = normalizeFeedFetchSettings(settings);
    return Boolean(
        normalized.request_profile !== "auto" ||
        normalized.feed_format !== "auto" ||
        normalized.timeout_ms !== null ||
        normalized.feed_url ||
        normalized.login_url ||
        normalized.username ||
        normalized.password ||
        normalized.cookie ||
        normalized.article_selector ||
        normalized.page_selector ||
        normalized.html_start ||
        normalized.html_end ||
        normalized.json_items_path ||
        normalized.json_title_path ||
        normalized.json_link_path ||
        normalized.json_date_path ||
        normalized.json_summary_path ||
        normalized.json_content_path
    );
  }

  function maskFeedFetchSettings(settings = {}) {
    const normalized = normalizeFeedFetchSettings(settings);
    return {
      ...normalized,
      password: "",
      cookie: "",
      password_configured: Boolean(normalized.password),
      cookie_configured: Boolean(normalized.cookie),
      has_custom_fetch: hasCustomFeedFetchSettings(normalized)
    };
  }

  function getFeedFetchSettings(userId, feedId) {
    if (typeof store.listUserSettingsByCategory !== "function") {
      return normalizeFeedFetchSettings({});
    }
    return normalizeFeedFetchSettings(
      decodeFeedFetchRows(store.listUserSettingsByCategory(userId, getFeedFetchCategory(feedId)))
    );
  }

  function buildFeedFetchSettingsIndex(userId) {
    const index = new Map();
    if (typeof store.listUserSettings !== "function") {
      return index;
    }
    for (const row of store.listUserSettings(userId) || []) {
      if (!String(row.category || "").startsWith(FEED_FETCH_CATEGORY_PREFIX)) continue;
      const feedId = Number(String(row.category).slice(FEED_FETCH_CATEGORY_PREFIX.length));
      if (!Number.isInteger(feedId) || feedId <= 0) continue;
      if (!index.has(feedId)) {
        index.set(feedId, {});
      }
      index.get(feedId)[row.key] = feedFetchSecretKeys.has(row.key) ? secret.decrypt(row.value) : row.value;
    }
    for (const [feedId, settings] of index.entries()) {
      index.set(feedId, normalizeFeedFetchSettings(settings));
    }
    return index;
  }

  function toGlobalSafeFeedFetchSettings(settings = {}) {
    const normalized = normalizeFeedFetchSettings(settings);
    return normalizeFeedFetchSettings({
      request_profile: normalized.request_profile,
      feed_format: normalized.feed_format,
      timeout_ms: normalized.timeout_ms,
      feed_url: normalized.feed_url,
      article_selector: normalized.article_selector,
      page_selector: normalized.page_selector,
      html_start: normalized.html_start,
      html_end: normalized.html_end,
      json_items_path: normalized.json_items_path,
      json_title_path: normalized.json_title_path,
      json_link_path: normalized.json_link_path,
      json_date_path: normalized.json_date_path,
      json_summary_path: normalized.json_summary_path,
      json_content_path: normalized.json_content_path
    });
  }

  function getSharedGlobalFeedFetchSettings(feedId) {
    if (typeof store.listUsers !== "function" || typeof store.getUserFeed !== "function") {
      return null;
    }

    let shared = null;
    let matchedUserCount = 0;
    for (const user of store.listUsers() || []) {
      const userFeed = store.getUserFeed(user.id, feedId);
      if (!userFeed) {
        continue;
      }
      matchedUserCount += 1;
      const candidate = toGlobalSafeFeedFetchSettings(getFeedFetchSettings(user.id, feedId));
      if (!hasCustomFeedFetchSettings(candidate)) {
        if (shared) {
          return null;
        }
        continue;
      }
      if (!shared) {
        shared = candidate;
        continue;
      }
      if (JSON.stringify(shared) !== JSON.stringify(candidate)) {
        return null;
      }
    }

    return matchedUserCount > 0 ? shared : null;
  }

  function saveFeedFetchSettings(userId, feedId, payload = {}) {
    const category = getFeedFetchCategory(feedId);
    const normalized = normalizeFeedFetchSettings(payload);
    for (const [key, value] of Object.entries(normalized)) {
      const storedValue = value === null || value === undefined ? "" : value;
      store.setUserSetting(userId, category, key, feedFetchSecretKeys.has(key) ? secret.encrypt(storedValue) : storedValue);
    }
    return normalized;
  }

  function buildRuntimeFeedFetchOptions(settings = {}) {
    const normalized = normalizeFeedFetchSettings(settings);
    return {
      requestProfile: normalized.request_profile,
      feedFormat: normalized.feed_format,
      ...(normalized.timeout_ms ? { timeoutMs: normalized.timeout_ms } : {}),
      feedUrl: normalized.feed_url,
      loginUrl: normalized.login_url,
      username: normalized.username,
      password: normalized.password,
      usernameField: normalized.username_field,
      passwordField: normalized.password_field,
      cookie: normalized.cookie,
      articleSelector: normalized.article_selector,
      pageSelector: normalized.page_selector,
      htmlStart: normalized.html_start,
      htmlEnd: normalized.html_end,
      jsonItemsPath: normalized.json_items_path,
      jsonTitlePath: normalized.json_title_path,
      jsonLinkPath: normalized.json_link_path,
      jsonDatePath: normalized.json_date_path,
      jsonSummaryPath: normalized.json_summary_path,
      jsonContentPath: normalized.json_content_path
    };
  }

  function hasOwn(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  function getPayloadValue(payload, keys = []) {
    for (const key of keys) {
      if (hasOwn(payload, key)) {
        return payload[key];
      }
    }
    return undefined;
  }

  function buildUpdatedFeedFetchSettings(currentSettings = {}, payload = {}) {
    const normalized = normalizeFeedFetchSettings(currentSettings);
    const fields = [
      ["request_profile", ["fetchRequestProfile", "fetch_request_profile", "requestProfile"]],
      ["feed_format", ["fetchFeedFormat", "fetch_feed_format", "feedFormat"]],
      ["timeout_ms", ["fetchTimeoutMs", "fetch_timeout_ms", "timeoutMs"]],
      ["feed_url", ["fetchFeedUrl", "fetch_feed_url", "feedUrl"]],
      ["login_url", ["fetchLoginUrl", "fetch_login_url", "loginUrl"]],
      ["username", ["fetchUsername", "fetch_username", "username"]],
      ["password", ["fetchPassword", "fetch_password", "password"]],
      ["username_field", ["fetchUsernameField", "fetch_username_field", "usernameField"]],
      ["password_field", ["fetchPasswordField", "fetch_password_field", "passwordField"]],
      ["cookie", ["fetchCookie", "fetch_cookie", "cookie"]],
      ["article_selector", ["fetchArticleSelector", "fetch_article_selector", "articleSelector"]],
      ["page_selector", ["fetchPageSelector", "fetch_page_selector", "pageSelector"]],
      ["html_start", ["fetchHtmlStart", "fetch_html_start", "htmlStart"]],
      ["html_end", ["fetchHtmlEnd", "fetch_html_end", "htmlEnd"]],
      ["json_items_path", ["fetchJsonItemsPath", "fetch_json_items_path", "jsonItemsPath"]],
      ["json_title_path", ["fetchJsonTitlePath", "fetch_json_title_path", "jsonTitlePath"]],
      ["json_link_path", ["fetchJsonLinkPath", "fetch_json_link_path", "jsonLinkPath"]],
      ["json_date_path", ["fetchJsonDatePath", "fetch_json_date_path", "jsonDatePath"]],
      ["json_summary_path", ["fetchJsonSummaryPath", "fetch_json_summary_path", "jsonSummaryPath"]],
      ["json_content_path", ["fetchJsonContentPath", "fetch_json_content_path", "jsonContentPath"]]
    ];

    for (const [targetKey, sourceKeys] of fields) {
      const nextValue = getPayloadValue(payload, sourceKeys);
      if (nextValue !== undefined) {
        normalized[targetKey] = nextValue;
      }
    }

    return normalized;
  }


  return {
    buildFeedFetchSettingsIndex,
    buildRuntimeFeedFetchOptions,
    buildUpdatedFeedFetchSettings,
    getFeedFetchSettings,
    getSharedGlobalFeedFetchSettings,
    maskFeedFetchSettings,
    saveFeedFetchSettings
  };
}
