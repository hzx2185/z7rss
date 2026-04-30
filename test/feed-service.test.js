import assert from "node:assert/strict";
import test from "node:test";
import { createFeedService } from "../src/services/feed-service.js";

function createAccountService() {
  return {
    getSupportedTranslationTargets() {
      return {
        "zh-CN": "简体中文"
      };
    },
    getSupportedTranslationModes() {
      return {
        full: "标题和正文",
        title: "仅标题"
      };
    },
    getAccount(user) {
      assert.equal(user.id, 1);
      return {
        features: {
          translation: true,
          summary: true
        }
      };
    },
    getEffectiveTranslationRuntime(userId, options = {}) {
      assert.equal(userId, 1);
      return {
        provider: options.provider || "google",
        targetLanguage: options.targetLanguage || "zh-CN"
      };
    },
    getEffectiveFeedTranslationSettings(userId, overrides = {}) {
      assert.equal(userId, 1);
      return {
        provider: "google",
        providerConfigured: true,
        targetLanguage: overrides.translation_target_language || "zh-CN",
        targetLabel: "简体中文",
        autoTranslate: overrides.auto_translate ?? false,
        autoTranslateSupported: true,
        displayTranslated: overrides.display_translated ?? true,
        translationMode: overrides.translation_mode || "full",
        translationModeLabel: "标题和正文"
      };
    }
  };
}

test("listFeeds returns translated feed titles immediately when display translated is enabled", async () => {
  const translationCalls = [];
  const translationWrites = [];
  const rawFeed = {
    id: 10,
    user_id: 1,
    feed_id: 10,
    title: "Последние новости на сайте korrespondent.net",
    custom_title: "",
    translated_title: "",
    translated_language: "",
    translated_source_title: "",
    translation_target_language: "zh-CN",
    auto_translate: 0,
    display_translated: 1,
    translation_mode: "full",
    category: null,
    is_archived: 0,
    is_collapsed: 0,
    auto_category: null,
    url: "http://k.img.com.ua/rss/ru/all_news2.0.xml",
    site_url: "https://korrespondent.net/",
    description: "",
    last_fetched_at: null,
    last_error: "",
    item_count: 0,
    unread_count: 3
  };

  const feedService = createFeedService({
    store: {
      listUserFeeds(userId) {
        assert.equal(userId, 1);
        return [{ ...rawFeed }];
      },
      getUserById(userId) {
        assert.equal(userId, 1);
        return { id: 1 };
      },
      setUserFeedTranslation(userId, feedId, translatedTitle, translatedLanguage, translatedSourceTitle) {
        translationWrites.push({
          userId,
          feedId,
          translatedTitle,
          translatedLanguage,
          translatedSourceTitle
        });
        return {
          ...rawFeed,
          translated_title: translatedTitle,
          translated_language: translatedLanguage,
          translated_source_title: translatedSourceTitle
        };
      }
    },
    accountService: createAccountService(),
    config: {},
    translator: {
      async translate(runtimeConfig, text) {
        translationCalls.push({ runtimeConfig, text });
        return `中:${text}`;
      }
    }
  });

  const feeds = await feedService.listFeeds(1);

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].title, rawFeed.title);
  assert.equal(feeds[0].translated_title, `中:${rawFeed.title}`);
  assert.equal(feeds[0].translated_language, "zh-CN");
  assert.equal(feeds[0].has_translation, 1);
  assert.deepEqual(translationWrites, [
    {
      userId: 1,
      feedId: 10,
      translatedTitle: `中:${rawFeed.title}`,
      translatedLanguage: "zh-CN",
      translatedSourceTitle: rawFeed.title
    }
  ]);
  assert.deepEqual(translationCalls, [
    {
      runtimeConfig: {
        provider: "google",
        targetLanguage: "zh-CN"
      },
      text: rawFeed.title
    }
  ]);
});

test("listFeeds skips translating feed titles that already look Chinese", async () => {
  const translationCalls = [];
  const translationWrites = [];
  const rawFeed = {
    id: 11,
    user_id: 1,
    feed_id: 11,
    title: "什么值得买",
    custom_title: "",
    translated_title: "",
    translated_language: "",
    translated_source_title: "",
    translation_target_language: "zh-CN",
    auto_translate: 0,
    display_translated: 1,
    translation_mode: "full",
    category: null,
    is_archived: 0,
    is_collapsed: 0,
    auto_category: null,
    url: "https://www.smzdm.com/feed",
    site_url: "https://www.smzdm.com/",
    description: "",
    last_fetched_at: null,
    last_error: "",
    item_count: 0,
    unread_count: 1
  };

  const feedService = createFeedService({
    store: {
      listUserFeeds() {
        return [{ ...rawFeed }];
      },
      getUserById() {
        return { id: 1 };
      },
      setUserFeedTranslation(userId, feedId, translatedTitle, translatedLanguage, translatedSourceTitle) {
        translationWrites.push({
          userId,
          feedId,
          translatedTitle,
          translatedLanguage,
          translatedSourceTitle
        });
        return null;
      }
    },
    accountService: createAccountService(),
    config: {},
    translator: {
      async translate(runtimeConfig, text) {
        translationCalls.push({ runtimeConfig, text });
        return `中:${text}`;
      }
    }
  });

  const feeds = await feedService.listFeeds(1);

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].translated_title, "");
  assert.equal(feeds[0].has_translation, 0);
  assert.deepEqual(translationCalls, []);
  assert.deepEqual(translationWrites, []);
});

test("updateFeedPreferencesForUser preserves existing fetch secrets when omitted", () => {
  const rawFeed = {
    id: 42,
    user_id: 1,
    feed_id: 42,
    title: "Protected Feed",
    custom_title: "",
    translated_title: "",
    translated_language: "",
    translated_source_title: "",
    translation_target_language: null,
    auto_translate: null,
    display_translated: null,
    translation_mode: null,
    category: null,
    is_archived: 0,
    is_collapsed: 0,
    auto_category: null,
    url: "https://example.com/protected.xml",
    site_url: "https://example.com/",
    description: "",
    last_fetched_at: null,
    last_error: "",
    item_count: 0,
    unread_count: 0
  };
  const settingRows = new Map([
    ["request_profile", "auto"],
    ["feed_format", "auto"],
    ["feed_url", "https://mirror.example.com/feed.xml"],
    ["password", "enc:keep-secret"],
    ["cookie", "enc:session=keep"],
    ["username_field", "username"],
    ["password_field", "password"],
    ["article_selector", ""],
    ["page_selector", ""],
    ["json_items_path", ""],
    ["json_title_path", ""],
    ["json_link_path", ""],
    ["json_date_path", ""],
    ["json_summary_path", ""],
    ["json_content_path", ""]
  ]);

  const feedService = createFeedService({
    store: {
      getUserFeed(userId, feedId) {
        assert.equal(userId, 1);
        assert.equal(feedId, 42);
        return { ...rawFeed };
      },
      listUserSettingsByCategory(userId, category) {
        assert.equal(userId, 1);
        assert.equal(category, "feed_fetch:42");
        return Array.from(settingRows.entries()).map(([key, value]) => ({ key, value }));
      },
      setUserSetting(userId, category, key, value) {
        assert.equal(userId, 1);
        assert.equal(category, "feed_fetch:42");
        settingRows.set(key, value);
        return { userId, category, key, value };
      },
      updateUserFeedPreferences(userId, feedId, payload) {
        assert.equal(userId, 1);
        assert.equal(feedId, 42);
        return {
          ...rawFeed,
          custom_title: payload.customTitle,
          category: payload.category,
          is_archived: payload.isArchived ? 1 : 0,
          is_collapsed: payload.isCollapsed ? 1 : 0,
          translation_target_language: payload.translationTargetLanguage,
          auto_translate: payload.autoTranslate,
          display_translated: payload.displayTranslated,
          translation_mode: payload.translationMode
        };
      }
    },
    accountService: createAccountService(),
    config: {},
    secretBox: {
      encrypt(value) {
        return `enc:${value}`;
      },
      decrypt(value) {
        return String(value || "").replace(/^enc:/, "");
      },
      isEncrypted(value) {
        return String(value || "").startsWith("enc:");
      }
    }
  });

  const updated = feedService.updateFeedPreferencesForUser(1, 42, {
    customTitle: "",
    category: null,
    isArchived: false,
    isCollapsed: false,
    targetLanguage: null,
    autoTranslate: null,
    displayTranslated: null,
    translationMode: null,
    fetchFeedUrl: "https://mirror.example.com/feed.xml",
    fetchRequestProfile: "browser",
    fetchTimeoutMs: 30000
  });

  assert.equal(settingRows.get("password"), "enc:keep-secret");
  assert.equal(settingRows.get("cookie"), "enc:session=keep");
  assert.equal(settingRows.get("feed_url"), "https://mirror.example.com/feed.xml");
  assert.equal(settingRows.get("request_profile"), "browser");
  assert.equal(settingRows.get("timeout_ms"), 30000);
  assert.equal(updated.fetch_password_configured, true);
  assert.equal(updated.fetch_cookie_configured, true);
  assert.equal(updated.fetch_feed_url, "https://mirror.example.com/feed.xml");
  assert.equal(updated.fetch_request_profile, "browser");
  assert.equal(updated.fetch_timeout_ms, 30000);
});

test("refreshGlobalFeed reuses shared non-secret fetch settings from subscribers", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: options.headers || {}
    });
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Science Quickly</title>
          <link>https://example.com/</link>
          <description>Example feed</description>
          <item>
            <title>Episode One</title>
            <link>https://example.com/posts/1</link>
            <guid>episode-1</guid>
            <description><![CDATA[<p>Hello</p>]]></description>
          </item>
        </channel>
      </rss>`,
      {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const rawFeed = {
    id: 58,
    title: "Science Quickly",
    url: "https://example.com/feed.xml",
    site_url: "https://example.com/",
    description: "",
    auto_category: null
  };
  const settingRows = new Map([
    ["request_profile", "browser"],
    ["feed_format", "auto"],
    ["timeout_ms", 30000],
    ["feed_url", "https://mirror.example.com/science.xml"],
    ["password", "enc:should-not-be-used"],
    ["cookie", "enc:secret=value"],
    ["username_field", "username"],
    ["password_field", "password"],
    ["article_selector", ""],
    ["page_selector", ""],
    ["json_items_path", ""],
    ["json_title_path", ""],
    ["json_link_path", ""],
    ["json_date_path", ""],
    ["json_summary_path", ""],
    ["json_content_path", ""]
  ]);
  const upserts = [];

  const feedService = createFeedService({
    store: {
      listUsers() {
        return [{ id: 4 }];
      },
      getUserFeed(userId, feedId) {
        assert.equal(userId, 4);
        assert.equal(feedId, 58);
        return {
          ...rawFeed,
          user_id: 4,
          feed_id: 58,
          custom_title: ""
        };
      },
      listUserSettingsByCategory(userId, category) {
        assert.equal(userId, 4);
        assert.equal(category, "feed_fetch:58");
        return Array.from(settingRows.entries()).map(([key, value]) => ({ key, value }));
      },
      getFeedById(feedId) {
        assert.equal(feedId, 58);
        return { ...rawFeed };
      },
      updateFeedMeta() {},
      listBlockedSites() {
        return [];
      },
      listContentRules() {
        return [];
      },
      upsertItems(feedId, items) {
        upserts.push({ feedId, items });
      },
      updateFeedAutoCategory() {},
      getFeedRetentionLimit() {
        return 0;
      },
      pruneFeedItems() {
        return 0;
      },
      updateFeedError() {}
    },
    accountService: createAccountService(),
    config: {
      crawlTimeoutMs: 15000,
      userAgent: "Z7RSSBot/0.1"
    },
    secretBox: {
      encrypt(value) {
        return `enc:${value}`;
      },
      decrypt(value) {
        return String(value || "").replace(/^enc:/, "");
      },
      isEncrypted(value) {
        return String(value || "").startsWith("enc:");
      }
    }
  });

  const result = await feedService.refreshGlobalFeed(58);

  assert.equal(result.inserted, 1);
  assert.equal(upserts.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mirror.example.com/science.xml");
  assert.match(String(requests[0].headers["user-agent"] || ""), /Mozilla\/5\.0/);
  assert.equal(requests[0].headers.cookie, undefined);
});

test("updateFeedPreferencesForUser stores fallback feed URLs even when timeout is unset", () => {
  const rawFeed = {
    id: 85,
    user_id: 1,
    feed_id: 85,
    title: "虎嗅网",
    custom_title: "",
    translated_title: "",
    translated_language: "",
    translated_source_title: "",
    translation_target_language: null,
    auto_translate: null,
    display_translated: null,
    translation_mode: null,
    category: null,
    is_archived: 0,
    is_collapsed: 0,
    auto_category: null,
    url: "https://www.huxiu.com/rss/0.xml",
    site_url: "https://www.huxiu.com/",
    description: "",
    last_fetched_at: null,
    last_error: "",
    item_count: 0,
    unread_count: 0
  };
  const settingRows = new Map([
    ["request_profile", "auto"],
    ["feed_format", "auto"],
    ["timeout_ms", ""],
    ["password", ""],
    ["cookie", ""],
    ["username_field", "username"],
    ["password_field", "password"],
    ["article_selector", ""],
    ["page_selector", ""],
    ["json_items_path", ""],
    ["json_title_path", ""],
    ["json_link_path", ""],
    ["json_date_path", ""],
    ["json_summary_path", ""],
    ["json_content_path", ""]
  ]);

  const feedService = createFeedService({
    store: {
      getUserFeed() {
        return { ...rawFeed };
      },
      listUserSettingsByCategory() {
        return Array.from(settingRows.entries()).map(([key, value]) => ({ key, value }));
      },
      setUserSetting(userId, category, key, value) {
        settingRows.set(key, value);
        return { userId, category, key, value };
      },
      updateUserFeedPreferences() {
        return { ...rawFeed };
      }
    },
    accountService: createAccountService(),
    config: {}
  });

  const updated = feedService.updateFeedPreferencesForUser(1, 85, {
    fetchFeedUrl: "https://rsshub.255556.xyz/huxiu/article"
  });

  assert.equal(settingRows.get("feed_url"), "https://rsshub.255556.xyz/huxiu/article");
  assert.equal(settingRows.get("timeout_ms"), "");
  assert.equal(updated.fetch_feed_url, "https://rsshub.255556.xyz/huxiu/article");
  assert.equal(updated.fetch_timeout_ms, null);
});
