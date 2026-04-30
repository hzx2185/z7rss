import { forbidden, notFound } from "../lib/errors.js";
import { getTranslationProviderLabel } from "./translator.js";
import { hasUsableStoredArticleContent, hasUsableStoredPageContent } from "./article-content.js";

export function createItemService({ feedService, translator, accountService, store, ai }) {
  const AUTO_TRANSLATE_LIST_BATCH_SIZE = 6;
  const AUTO_TRANSLATE_LIST_SYNC_BATCH_SIZE = 20;
  const AUTO_TRANSLATE_BACKGROUND_CONCURRENCY = 2;
  const pendingAutoTranslations = new Set();

  function normalizeTranslationSourceText(value) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTitleTranslationSource(item) {
    return normalizeTranslationSourceText(item?.title || "");
  }

  function getBodyTranslationSource(item) {
    return normalizeTranslationSourceText(item?.content_text || item?.summary || item?.title || "");
  }

  function isChineseTargetLanguage(targetLanguage) {
    return /^zh(?:-|$)/i.test(String(targetLanguage || "").trim());
  }

  function looksLikeChineseText(value) {
    const sample = normalizeTranslationSourceText(value);
    if (!sample) return false;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(sample)) {
      return false;
    }

    const hanCount = (sample.match(/\p{Script=Han}/gu) || []).length;
    if (!hanCount) return false;

    const latinCount = (sample.match(/[A-Za-z]/g) || []).length;
    return hanCount >= 6 || (hanCount >= 4 && hanCount >= latinCount);
  }

  function shouldSkipTranslationForChineseSource(translationSettings, item, bodySource = "") {
    if (!isChineseTargetLanguage(translationSettings?.targetLanguage)) {
      return false;
    }

    return looksLikeChineseText(getTitleTranslationSource(item)) || looksLikeChineseText(bodySource || getBodyTranslationSource(item));
  }

  function withContentState(item) {
    return {
      ...item,
      content_loaded: Object.prototype.hasOwnProperty.call(item || {}, "content_loaded")
        ? Boolean(item?.content_loaded)
        : hasUsableStoredArticleContent(item),
      page_loaded: Object.prototype.hasOwnProperty.call(item || {}, "page_loaded")
        ? Boolean(item?.page_loaded)
        : hasUsableStoredPageContent(item)
    };
  }

  function getTranslationExcerpt(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function getFeedTranslationOverrides(source = {}) {
    return {
      translation_target_language: source.feed_translation_target_language ?? source.translation_target_language ?? null,
      auto_translate: source.feed_auto_translate ?? source.auto_translate ?? null,
      display_translated: source.feed_display_translated ?? source.display_translated ?? null,
      translation_mode: source.feed_translation_mode ?? source.translation_mode ?? null
    };
  }

  function getEffectiveItemTranslationSettings(userId, item) {
    return accountService.getEffectiveFeedTranslationSettings(userId, getFeedTranslationOverrides(item));
  }

  function resolveStoredTranslation(item, translationSettings) {
    const expectedLanguage = String(translationSettings?.targetLanguage || "").trim();
    const userTranslatedTitle = String(item?.user_translated_title || "").trim();
    const userTranslatedText = String(item?.user_translated_text || "").trim();
    const userTranslatedLanguage = String(item?.user_translated_language || "").trim();
    if ((userTranslatedTitle || userTranslatedText) && userTranslatedLanguage === expectedLanguage) {
      return {
        title: userTranslatedTitle,
        text: userTranslatedText,
        language: userTranslatedLanguage
      };
    }

    const legacyTranslatedTitle = String(item?.legacy_translated_title || "").trim();
    const legacyTranslatedText = String(item?.legacy_translated_text || "").trim();
    const legacyTranslatedLanguage = String(item?.legacy_translated_language || "").trim();
    if ((legacyTranslatedTitle || legacyTranslatedText) && legacyTranslatedLanguage === expectedLanguage) {
      return {
        title: legacyTranslatedTitle,
        text: legacyTranslatedText,
        language: legacyTranslatedLanguage
      };
    }

    const directTranslatedTitle = String(item?.translated_title || "").trim();
    const directTranslatedText = String(item?.translated_text || "").trim();
    const directTranslatedLanguage = String(item?.translated_language || item?.translation_target_language || "").trim();
    if ((directTranslatedTitle || directTranslatedText) && (!expectedLanguage || !directTranslatedLanguage || directTranslatedLanguage === expectedLanguage)) {
      return {
        title: directTranslatedTitle,
        text: directTranslatedText,
        language: directTranslatedLanguage || expectedLanguage
      };
    }

    return {
      title: "",
      text: "",
      language: ""
    };
  }

  function resolveStoredFeedTranslation(item, translationSettings) {
    const expectedLanguage = String(translationSettings?.targetLanguage || "").trim();
    const feedTranslatedTitle = String(item?.feed_user_translated_title || "").trim();
    const feedTranslatedLanguage = String(item?.feed_user_translated_language || "").trim();
    const feedTranslatedSourceTitle = String(item?.feed_user_translated_source_title || "").trim();
    const currentFeedTitle = String(item?.feed_title || "").trim();

    if (!feedTranslatedTitle) {
      return {
        title: "",
        language: ""
      };
    }

    if (feedTranslatedSourceTitle && currentFeedTitle && feedTranslatedSourceTitle !== currentFeedTitle) {
      return {
        title: "",
        language: ""
      };
    }

    if (expectedLanguage && feedTranslatedLanguage && feedTranslatedLanguage !== expectedLanguage) {
      return {
        title: "",
        language: ""
      };
    }

    return {
      title: feedTranslatedTitle,
      language: feedTranslatedLanguage || expectedLanguage
    };
  }

  function presentItemForUser(userId, item, translationSettings = null) {
    if (!item) return null;

    const effectiveTranslation = translationSettings || getEffectiveItemTranslationSettings(userId, item);
    const storedTranslation = resolveStoredTranslation(item, effectiveTranslation);
    const storedFeedTranslation = resolveStoredFeedTranslation(item, effectiveTranslation);
    const {
      user_translated_title: _userTranslatedTitle,
      user_translated_text: _userTranslatedText,
      user_translated_language: _userTranslatedLanguage,
      legacy_translated_title: _legacyTranslatedTitle,
      legacy_translated_text: _legacyTranslatedText,
      legacy_translated_language: _legacyTranslatedLanguage,
      feed_user_translated_title: _feedUserTranslatedTitle,
      feed_user_translated_language: _feedUserTranslatedLanguage,
      feed_user_translated_source_title: _feedUserTranslatedSourceTitle,
      feed_translation_target_language: _feedTranslationTargetLanguage,
      feed_auto_translate: _feedAutoTranslate,
      feed_display_translated: _feedDisplayTranslated,
      feed_translation_mode: _feedTranslationMode,
      translated_title: _translatedTitle,
      translated_text: _translatedText,
      translated_language: _translatedLanguage,
      translated_excerpt: _translatedExcerpt,
      has_translation: _hasTranslation,
      translation_target_language: _translationTargetLanguage,
      translation_target_label: _translationTargetLabel,
      translation_display_translated: _translationDisplayTranslated,
      translation_auto_translate: _translationAutoTranslate,
      translation_mode: _translationMode,
      translation_mode_label: _translationModeLabel,
      ...rest
    } = item;

    return withContentState({
      ...rest,
      translated_title: storedTranslation.title,
      translated_text: storedTranslation.text,
      translated_language: storedTranslation.language,
      translated_excerpt: storedTranslation.text
        ? getTranslationExcerpt(storedTranslation.text)
        : storedTranslation.title
          ? getTranslationExcerpt(storedTranslation.title)
          : "",
      has_translation: storedTranslation.title || storedTranslation.text ? 1 : 0,
      feed_translated_title: storedFeedTranslation.title,
      feed_translated_language: storedFeedTranslation.language,
      original_url: String(rest.original_url || rest.link || "").trim(),
      translation_target_language: effectiveTranslation.targetLanguage,
      translation_target_label: effectiveTranslation.targetLabel,
      translation_display_translated: effectiveTranslation.displayTranslated,
      translation_auto_translate: effectiveTranslation.autoTranslate,
      translation_mode: effectiveTranslation.translationMode,
      translation_mode_label: effectiveTranslation.translationModeLabel
    });
  }

  function hasSatisfiedTranslation(item, translationSettings) {
    const hasTitle = Boolean(String(item?.translated_title || "").trim());
    if (translationSettings.translationMode === "title") {
      return hasTitle;
    }
    return hasTitle && Boolean(String(item?.translated_text || "").trim());
  }

  function buildAutoTranslationKey(userId, itemId, translationSettings) {
    return [
      Number(userId || 0),
      Number(itemId || 0),
      String(translationSettings?.targetLanguage || "").trim(),
      String(translationSettings?.translationMode || "").trim()
    ].join(":");
  }

  async function translateText(userId, translationSettings, text) {
    const sourceText = String(text || "").trim();
    if (!sourceText) return "";
    const runtimeConfig = accountService.getEffectiveTranslationRuntime(userId, {
      provider: translationSettings?.provider,
      targetLanguage: translationSettings?.targetLanguage
    });
    return translator.translate(runtimeConfig, sourceText);
  }

  function canAutoTranslateItem(accountInfo, translationSettings) {
    return Boolean(
      translationSettings?.autoTranslate &&
        translationSettings?.autoTranslateSupported &&
        translationSettings?.providerConfigured &&
        accountInfo?.features?.translation
    );
  }

  async function translateItemForUser(user, item, translationSettings, options = {}) {
    const account = accountService.getAccount(user);
    if (!account.features.translation) {
      throw forbidden("当前套餐不支持翻译功能", { code: "translation_unavailable" });
    }

    let sourceItem = item;
    if (options.hydrateContent && translationSettings.translationMode === "full") {
      sourceItem = await feedService.hydrateItemContent(user.id, item.id);
    }

    const titleSource = getTitleTranslationSource(sourceItem);
    const bodySource = translationSettings.translationMode === "full" ? getBodyTranslationSource(sourceItem) : "";

    if (shouldSkipTranslationForChineseSource(translationSettings, sourceItem, bodySource)) {
      return {
        item: presentItemForUser(user.id, sourceItem, translationSettings),
        translatedTitle: "",
        translatedText: "",
        skipped: true
      };
    }

    const translatedTitle = await translateText(user.id, translationSettings, titleSource);

    let translatedText = "";
    if (translationSettings.translationMode === "full") {
      translatedText = await translateText(user.id, translationSettings, bodySource);
    }

    const stored = store.setUserItemTranslation(
      user.id,
      item.id,
      translatedTitle,
      translatedText,
      translationSettings.targetLanguage
    );
    return {
      item: presentItemForUser(user.id, stored || sourceItem, translationSettings),
      translatedTitle,
      translatedText,
      skipped: false
    };
  }

  async function mapWithConcurrency(items, limit, mapper) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let currentIndex = 0;

    async function worker() {
      while (currentIndex < items.length) {
        const nextIndex = currentIndex;
        currentIndex += 1;
        results[nextIndex] = await mapper(items[nextIndex], nextIndex);
      }
    }

    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async function ensureImmediateListTranslations(user, rawItems, accountInfo) {
    if (!user || !accountInfo || !Array.isArray(rawItems) || !rawItems.length) {
      return rawItems;
    }

    const translatedByIndex = new Map();
    const candidates = [];

    for (const [index, item] of rawItems.entries()) {
      if (candidates.length >= AUTO_TRANSLATE_LIST_SYNC_BATCH_SIZE) {
        break;
      }

      const effectiveTranslation = getEffectiveItemTranslationSettings(user.id, item);
      const presented = presentItemForUser(user.id, item, effectiveTranslation);
      if (!effectiveTranslation.displayTranslated || !canAutoTranslateItem(accountInfo, effectiveTranslation)) {
        continue;
      }
      if (hasSatisfiedTranslation(presented, effectiveTranslation)) {
        continue;
      }
      if (shouldSkipTranslationForChineseSource(effectiveTranslation, item)) {
        continue;
      }

      candidates.push({
        index,
        item,
        translationSettings: effectiveTranslation
      });
    }

    if (!candidates.length) {
      return rawItems;
    }

    await mapWithConcurrency(candidates, AUTO_TRANSLATE_BACKGROUND_CONCURRENCY, async (task) => {
      try {
        const result = await translateItemForUser(user, task.item, task.translationSettings, {
          hydrateContent: false
        });
        if (result?.item) {
          translatedByIndex.set(task.index, result.item);
        }
      } catch (_error) {
        // Keep list rendering resilient; failed items stay as original language.
      }
    });

    return rawItems.map((item, index) => translatedByIndex.get(index) || item);
  }

  function scheduleAutoTranslations(user, items, translationSettings = null, account = null, options = {}) {
    if (!user) return;

    const accountInfo = account || accountService.getAccount(user);
    const candidates = (Array.isArray(items) ? items : [items]).filter(Boolean);
    const tasks = [];

    for (const item of candidates) {
      const effectiveTranslation = translationSettings || getEffectiveItemTranslationSettings(user.id, item);
      const presented = presentItemForUser(user.id, item, effectiveTranslation);

      if (!canAutoTranslateItem(accountInfo, effectiveTranslation)) {
        continue;
      }
      if (hasSatisfiedTranslation(presented, effectiveTranslation)) {
        continue;
      }
      if (shouldSkipTranslationForChineseSource(effectiveTranslation, item)) {
        continue;
      }

      const key = buildAutoTranslationKey(user.id, item.id, effectiveTranslation);
      if (pendingAutoTranslations.has(key)) {
        continue;
      }

      pendingAutoTranslations.add(key);
      tasks.push({
        key,
        item,
        translationSettings: effectiveTranslation
      });
    }

    if (!tasks.length) {
      return;
    }

    void mapWithConcurrency(tasks, AUTO_TRANSLATE_BACKGROUND_CONCURRENCY, async (task) => {
      try {
        await translateItemForUser(user, task.item, task.translationSettings, {
          hydrateContent: Boolean(options.hydrateContent)
        });
      } catch (_error) {
        // Auto translation is best-effort and should not block list rendering.
      } finally {
        pendingAutoTranslations.delete(task.key);
      }
    }).catch(() => {
      tasks.forEach((task) => pendingAutoTranslations.delete(task.key));
    });
  }

  return {
    async listItems(userId, feedId, limit, options = {}) {
      const pageSize = Math.max(20, Math.min(200, Number(limit || 20)));
      const filter = String(options.filter || "all");
      const queryOptions = {
        favoritesOnly: filter === "favorite",
        readState: filter === "read" ? 1 : filter === "unread" ? 0 : null,
        publishedSince: options.publishedSince ? String(options.publishedSince) : null
      };
      const total = feedService.countItems(userId, feedId, queryOptions);
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(pageCount, Math.max(1, Number(options.page || 1)));
      const rawItems = feedService.listItems(userId, feedId, pageSize, {
        ...queryOptions,
        offset: (page - 1) * pageSize
      });

      const user = rawItems.length ? store.getUserById(userId) : null;
      const account = user ? accountService.getAccount(user) : null;
      const displayItems = user ? await ensureImmediateListTranslations(user, rawItems, account) : rawItems;
      const items = displayItems.map((item) => presentItemForUser(userId, item));
      if (displayItems.length && user) {
          scheduleAutoTranslations(
            user,
            displayItems.slice(0, AUTO_TRANSLATE_LIST_BATCH_SIZE),
            null,
            account,
            { hydrateContent: false }
          );
      }

      return {
        items,
        total,
        page,
        pageSize,
        pageCount,
        filter
      };
    },
    getItemCounts(userId, options = {}) {
      const todaySince = options.todaySince
        ? String(options.todaySince)
        : (() => {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            return start.toISOString();
          })();

      return store.countUserItemBuckets(userId, { todaySince });
    },
    async getItemPreview(user, itemId) {
      const preview = await feedService.getItemPreview(user.id, itemId);
      const account = accountService.getAccount(user);
      scheduleAutoTranslations(user, preview, null, account, { hydrateContent: false });
      return presentItemForUser(user.id, preview);
    },
    async getItemContent(user, itemId) {
      const item = await feedService.getItemContent(user.id, itemId);
      const account = accountService.getAccount(user);
      scheduleAutoTranslations(user, item, null, account, { hydrateContent: true });
      return presentItemForUser(user.id, item);
    },
    async getItemPageContent(user, itemId) {
      const item = await feedService.getItemPageContent(user.id, itemId);
      return presentItemForUser(user.id, item);
    },
    async setReadState(userId, itemId, isRead) {
      const item = feedService.setReadState(userId, itemId, isRead);
      return presentItemForUser(userId, item);
    },
    async setReadStateBulk(userId, options = {}) {
      const isRead = Boolean(options.isRead ?? true);
      const lastOpenedAt = isRead ? new Date().toISOString() : null;
      const directIds = [...new Set((options.itemIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];

      if (directIds.length) {
        const ownedIds = directIds.filter((itemId) => Boolean(store.getUserItem(userId, itemId)));
        const updatedCount = store.setUserItemReadStateBulk(userId, ownedIds, isRead, lastOpenedAt);
        return { updatedCount };
      }

      const filter = String(options.filter || "all");
      const olderThanDays = Number(options.olderThanDays || 0);
      const queryOptions = {
        favoritesOnly: filter === "favorite",
        readState: filter === "read" ? 1 : filter === "unread" ? 0 : null,
        publishedSince: options.publishedSince ? String(options.publishedSince) : null,
        publishedBefore:
          olderThanDays > 0
            ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
            : null
      };
      const targetIds = store.listUserItemIds(
        userId,
        options.feedId ? Number(options.feedId) : null,
        queryOptions
      );
      const updatedCount = store.setUserItemReadStateBulk(userId, targetIds, isRead, lastOpenedAt);
      return { updatedCount };
    },
    async setFavoriteState(userId, itemId, isFavorited) {
      const user = store.getUserById(userId);
      const item = await feedService.getItemPreview(userId, itemId);
      if (!item) {
        throw notFound("Item not found");
      }

      if (isFavorited && !item.is_favorited) {
        const account = accountService.getAccount(user);
        if (account.usage.favoriteCount >= account.usage.favoriteLimit) {
          throw forbidden(`当前套餐最多收藏 ${account.usage.favoriteLimit} 篇文章`, {
            code: "favorite_limit_reached"
          });
        }
      }

      const updated = store.setUserItemFavoriteState(
        userId,
        itemId,
        Boolean(isFavorited),
        isFavorited ? new Date().toISOString() : null
      );
      return presentItemForUser(userId, updated);
    },
    async translateItem(user, itemId) {
      const item = store.getUserItem(user.id, itemId);
      if (!item) {
        throw notFound("Item not found");
      }

      const translationSettings = getEffectiveItemTranslationSettings(user.id, item);
      const translated = await translateItemForUser(user, item, translationSettings, {
        hydrateContent: translationSettings.translationMode === "full"
      });

      return {
        translatedTitle: translated.translatedTitle,
        translatedText: translated.translatedText,
        translatedLanguage: translationSettings.targetLanguage,
        targetLabel: translationSettings.targetLabel,
        translationMode: translationSettings.translationMode,
        provider: translationSettings.provider,
        providerLabel: getTranslationProviderLabel(translationSettings.provider),
        skipped: translated.skipped,
        message: translated.skipped ? "当前文章已是中文，无需翻译" : ""
      };
    },
    async summarizeItem(user, itemId) {
      const account = accountService.getAccount(user);
      if (!account.features.summary) {
        throw forbidden("当前套餐不支持 AI 总结", { code: "summary_unavailable" });
      }

      const item = await feedService.hydrateItemContent(user.id, itemId);
      const content = item.content_text || item.summary || item.title;
      const aiConfig = accountService.getEffectiveAiConfig(user.id);
      const output = await ai.summarize(aiConfig, content);
      store.updateSummary(item.id, output);
      return { aiSummary: output };
    }
  };
}
