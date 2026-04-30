import assert from "node:assert/strict";
import test from "node:test";
import { createItemService } from "../src/services/item-service.js";

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitForCondition(predicate, { timeoutMs = 250, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.ok(predicate(), "condition was not met before timeout");
}

test("getItemPreview returns immediately while auto translation continues in background", async () => {
  const translationGate = createDeferred();
  const translationCalls = [];
  const runtimeConfigs = [];
  const translationWrites = [];
  const previewItem = {
    id: 101,
    title: "Hello world",
    summary: "Summary text",
    link: "https://example.com/articles/101",
    is_read: 0,
    is_favorited: 0
  };
  const user = { id: 1 };

  const itemService = createItemService({
    feedService: {
      async getItemPreview(userId, itemId) {
        assert.equal(userId, 1);
        assert.equal(itemId, 101);
        return { ...previewItem };
      },
      async hydrateItemContent() {
        throw new Error("preview auto translation should not hydrate full content");
      }
    },
    translator: {
      async translate(runtimeConfig, text) {
        runtimeConfigs.push(runtimeConfig);
        translationCalls.push(String(text));
        await translationGate.promise;
        return `zh:${text}`;
      }
    },
    accountService: {
      getAccount(currentUser) {
        assert.equal(currentUser.id, 1);
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
      getEffectiveFeedTranslationSettings(userId) {
        assert.equal(userId, 1);
        return {
          provider: "google",
          providerConfigured: true,
          targetLanguage: "zh-CN",
          targetLabel: "简体中文",
          autoTranslate: true,
          autoTranslateSupported: true,
          displayTranslated: true,
          translationMode: "full",
          translationModeLabel: "标题和正文"
        };
      }
    },
    store: {
      getUserById(userId) {
        assert.equal(userId, 1);
        return user;
      },
      setUserItemTranslation(userId, itemId, translatedTitle, translatedText, translatedLanguage) {
        translationWrites.push({
          userId,
          itemId,
          translatedTitle,
          translatedText,
          translatedLanguage
        });
        return {
          ...previewItem,
          user_translated_title: translatedTitle,
          user_translated_text: translatedText,
          user_translated_language: translatedLanguage
        };
      }
    }
  });

  let settled = false;
  let previewResult = null;
  const previewPromise = itemService.getItemPreview(user, 101).then((result) => {
    settled = true;
    previewResult = result;
    return result;
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(settled, true);
  assert.equal(previewResult?.translated_title, "");
  assert.equal(previewResult?.translated_text, "");
  assert.equal(previewResult?.has_translation, 0);
  assert.deepEqual(translationWrites, []);
  assert.deepEqual(translationCalls, ["Hello world"]);

  translationGate.resolve();
  await previewPromise;
  await waitForCondition(() => translationWrites.length === 1);

  assert.deepEqual(translationCalls, ["Hello world", "Summary text"]);
  assert.deepEqual(runtimeConfigs, [
    {
      provider: "google",
      targetLanguage: "zh-CN"
    },
    {
      provider: "google",
      targetLanguage: "zh-CN"
    }
  ]);
  assert.deepEqual(translationWrites, [
    {
      userId: 1,
      itemId: 101,
      translatedTitle: "zh:Hello world",
      translatedText: "zh:Summary text",
      translatedLanguage: "zh-CN"
    }
  ]);
});

test("auto translation skips articles that already look Chinese when target language is Chinese", async () => {
  const translationCalls = [];
  const translationWrites = [];
  const previewItem = {
    id: 102,
    title: "华人接送机要给小费吗",
    summary: "<p>本挂逼住新泽西，在小红书上找了华人 jfk 接送机 150 一次。</p>",
    link: "https://example.com/articles/102",
    is_read: 0,
    is_favorited: 0
  };
  const user = { id: 1 };

  const itemService = createItemService({
    feedService: {
      async getItemPreview(userId, itemId) {
        assert.equal(userId, 1);
        assert.equal(itemId, 102);
        return { ...previewItem };
      },
      async hydrateItemContent() {
        throw new Error("chinese auto translation should not hydrate content");
      }
    },
    translator: {
      async translate(_runtimeConfig, text) {
        translationCalls.push(String(text));
        return `zh:${text}`;
      }
    },
    accountService: {
      getAccount(currentUser) {
        assert.equal(currentUser.id, 1);
        return {
          features: {
            translation: true,
            summary: true
          }
        };
      },
      getEffectiveTranslationRuntime() {
        return {
          provider: "google",
          targetLanguage: "zh-CN"
        };
      },
      getEffectiveFeedTranslationSettings(userId) {
        assert.equal(userId, 1);
        return {
          provider: "google",
          providerConfigured: true,
          targetLanguage: "zh-CN",
          targetLabel: "简体中文",
          autoTranslate: true,
          autoTranslateSupported: true,
          displayTranslated: true,
          translationMode: "full",
          translationModeLabel: "标题和正文"
        };
      }
    },
    store: {
      getUserById(userId) {
        assert.equal(userId, 1);
        return user;
      },
      setUserItemTranslation(userId, itemId, translatedTitle, translatedText, translatedLanguage) {
        translationWrites.push({
          userId,
          itemId,
          translatedTitle,
          translatedText,
          translatedLanguage
        });
        return null;
      }
    },
    ai: {
      async summarize() {
        throw new Error("summary should not run in translation test");
      }
    }
  });

  const preview = await itemService.getItemPreview(user, 102);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(preview.has_translation, 0);
  assert.deepEqual(translationCalls, []);
  assert.deepEqual(translationWrites, []);
});

test("manual translation skips articles that already look Chinese when target language is Chinese", async () => {
  const translationCalls = [];
  const storedTranslations = [];
  const sourceItem = {
    id: 103,
    title: "最近几年心目中最精彩的美剧",
    summary: "<p>大家心目中近几年出品的美剧里面，哪部最精彩？</p>",
    link: "https://example.com/articles/103",
    is_read: 0,
    is_favorited: 0
  };

  const itemService = createItemService({
    feedService: {
      async getItemPreview() {
        throw new Error("preview should not be called in manual translation test");
      },
      async hydrateItemContent(userId, itemId) {
        assert.equal(userId, 3);
        assert.equal(itemId, 103);
        return { ...sourceItem, content_text: "大家心目中近几年出品的美剧里面，哪部最精彩？" };
      }
    },
    translator: {
      async translate(_runtimeConfig, text) {
        translationCalls.push(String(text));
        return `zh:${text}`;
      }
    },
    accountService: {
      getAccount(currentUser) {
        assert.equal(currentUser.id, 3);
        return {
          features: {
            translation: true,
            summary: true
          }
        };
      },
      getEffectiveTranslationRuntime(userId, options = {}) {
        assert.equal(userId, 3);
        return {
          provider: options.provider || "google",
          targetLanguage: options.targetLanguage || "zh-CN"
        };
      },
      getEffectiveFeedTranslationSettings(userId) {
        assert.equal(userId, 3);
        return {
          provider: "google",
          providerConfigured: true,
          targetLanguage: "zh-CN",
          targetLabel: "简体中文",
          autoTranslate: false,
          autoTranslateSupported: true,
          displayTranslated: true,
          translationMode: "full",
          translationModeLabel: "标题和正文"
        };
      }
    },
    store: {
      getUserItem(userId, itemId) {
        assert.equal(userId, 3);
        assert.equal(itemId, 103);
        return { ...sourceItem };
      },
      setUserItemTranslation(userId, itemId, translatedTitle, translatedText, translatedLanguage) {
        storedTranslations.push({
          userId,
          itemId,
          translatedTitle,
          translatedText,
          translatedLanguage
        });
        return null;
      }
    },
    ai: {
      async summarize() {
        throw new Error("summary should not run in translation test");
      }
    }
  });

  const result = await itemService.translateItem({ id: 3 }, 103);

  assert.deepEqual(translationCalls, []);
  assert.deepEqual(storedTranslations, []);
  assert.equal(result.skipped, true);
  assert.equal(result.message, "当前文章已是中文，无需翻译");
  assert.equal(result.translatedTitle, "");
  assert.equal(result.translatedText, "");
});

test("listItems returns translated titles immediately when auto translate and display translated are enabled", async () => {
  const translationCalls = [];
  const translationWrites = [];
  const user = { id: 1 };
  const rawItems = [
    {
      id: 201,
      feed_id: 9,
      title: "OpenAI releases new model",
      summary: "Fast summary",
      link: "https://example.com/articles/201",
      feed_translation_target_language: "zh-CN",
      feed_auto_translate: 1,
      feed_display_translated: 1,
      feed_translation_mode: "title"
    }
  ];

  const itemService = createItemService({
    feedService: {
      countItems(userId, feedId, options = {}) {
        assert.equal(userId, 1);
        assert.equal(feedId, 9);
        assert.equal(options.favoritesOnly, false);
        return 1;
      },
      listItems(userId, feedId, limit, options = {}) {
        assert.equal(userId, 1);
        assert.equal(feedId, 9);
        assert.equal(limit, 20);
        assert.equal(options.offset, 0);
        return rawItems.map((item) => ({ ...item }));
      }
    },
    translator: {
      async translate(runtimeConfig, text) {
        translationCalls.push({ runtimeConfig, text });
        return `中:${text}`;
      }
    },
    accountService: {
      getAccount(currentUser) {
        assert.equal(currentUser.id, 1);
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
          autoTranslate: overrides.auto_translate ?? true,
          autoTranslateSupported: true,
          displayTranslated: overrides.display_translated ?? true,
          translationMode: overrides.translation_mode || "title",
          translationModeLabel: "仅标题"
        };
      }
    },
    store: {
      getUserById(userId) {
        assert.equal(userId, 1);
        return user;
      },
      setUserItemTranslation(userId, itemId, translatedTitle, translatedText, translatedLanguage) {
        translationWrites.push({ userId, itemId, translatedTitle, translatedText, translatedLanguage });
        return {
          ...rawItems[0],
          user_translated_title: translatedTitle,
          user_translated_text: translatedText,
          user_translated_language: translatedLanguage
        };
      }
    }
  });

  const result = await itemService.listItems(1, 9, 20, { page: 1, filter: "all" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].translated_title, "中:OpenAI releases new model");
  assert.equal(result.items[0].has_translation, 1);
  assert.deepEqual(translationWrites, [
    {
      userId: 1,
      itemId: 201,
      translatedTitle: "中:OpenAI releases new model",
      translatedText: "",
      translatedLanguage: "zh-CN"
    }
  ]);
  assert.deepEqual(translationCalls, [
    {
      runtimeConfig: {
        provider: "google",
        targetLanguage: "zh-CN"
      },
      text: "OpenAI releases new model"
    }
  ]);
});

test("listItems exposes translated feed titles when the stored source title still matches", async () => {
  const rawItems = [
    {
      id: 211,
      feed_id: 12,
      title: "Original article",
      summary: "Summary text",
      link: "https://example.com/articles/211",
      feed_title: "Последние новости на сайте korrespondent.net",
      feed_user_translated_title: "korrespondent 网站最新新闻",
      feed_user_translated_language: "zh-CN",
      feed_user_translated_source_title: "Последние новости на сайте korrespondent.net",
      feed_translation_target_language: "zh-CN",
      feed_auto_translate: 0,
      feed_display_translated: 1,
      feed_translation_mode: "full"
    }
  ];

  const itemService = createItemService({
    feedService: {
      countItems() {
        return 1;
      },
      listItems() {
        return rawItems.map((item) => ({ ...item }));
      }
    },
    translator: {
      async translate() {
        throw new Error("feed title should use stored translation");
      }
    },
    accountService: {
      getAccount() {
        return {
          features: {
            translation: true,
            summary: true
          }
        };
      },
      getEffectiveTranslationRuntime() {
        return {
          provider: "google",
          targetLanguage: "zh-CN"
        };
      },
      getEffectiveFeedTranslationSettings(_userId, overrides = {}) {
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
    },
    store: {
      getUserById() {
        return { id: 1 };
      }
    }
  });

  const result = await itemService.listItems(1, 12, 20, { page: 1, filter: "all" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].feed_translated_title, "korrespondent 网站最新新闻");
  assert.equal(result.items[0].feed_translated_language, "zh-CN");
});

test("summarizeItem uses injected ai client and persists the summary", async () => {
  const hydratedItem = {
    id: 202,
    title: "Original title",
    summary: "Fallback summary",
    content_text: "Full article body"
  };
  const summaryWrites = [];
  const aiCalls = [];

  const itemService = createItemService({
    feedService: {
      async hydrateItemContent(userId, itemId) {
        assert.equal(userId, 7);
        assert.equal(itemId, 202);
        return { ...hydratedItem };
      }
    },
    translator: {
      async translate() {
        throw new Error("translate should not be called during summarize");
      }
    },
    accountService: {
      getAccount(currentUser) {
        assert.equal(currentUser.id, 7);
        return {
          features: {
            translation: true,
            summary: true
          }
        };
      },
      getEffectiveAiConfig(userId) {
        assert.equal(userId, 7);
        return {
          baseUrl: "https://ai.example.com/v1",
          apiKey: "secret",
          model: "gpt-test"
        };
      }
    },
    store: {
      updateSummary(itemId, aiSummary) {
        summaryWrites.push({ itemId, aiSummary });
      }
    },
    ai: {
      async summarize(runtimeConfig, text) {
        aiCalls.push({ runtimeConfig, text });
        return "summary output";
      }
    }
  });

  const result = await itemService.summarizeItem({ id: 7 }, 202);

  assert.deepEqual(aiCalls, [
    {
      runtimeConfig: {
        baseUrl: "https://ai.example.com/v1",
        apiKey: "secret",
        model: "gpt-test"
      },
      text: "Full article body"
    }
  ]);
  assert.deepEqual(summaryWrites, [
    {
      itemId: 202,
      aiSummary: "summary output"
    }
  ]);
  assert.deepEqual(result, { aiSummary: "summary output" });
});
