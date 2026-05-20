import { badRequest, createError, forbidden, notFound } from "../lib/errors.js";
import { getTranslationProviderLabel, supportsServerTranslation } from "./translator.js";
import { hasUsableStoredArticleContent, hasUsableStoredPageContent } from "./article-content.js";
import { canConvertTraditionalToSimplified, convertTraditionalToSimplified } from "./chinese-conversion.js";

export function createItemService({ feedService, translator, accountService, store, ai }) {
  const AUTO_TRANSLATE_LIST_SYNC_BATCH_SIZE = 12;
  const AUTO_TRANSLATE_BACKGROUND_CONCURRENCY = 2;
  const ITEM_COUNTS_CACHE_TTL_MS = 2500;
  const DEFAULT_TRANSLATION_PROVIDER_FALLBACK_ORDER = ["deeplx", "bing", "ai", "google"];
  const itemCountsCache = new Map();

  function clearUserItemCountCache(userId) {
    const prefix = `${Number(userId || 0)}:`;
    for (const key of itemCountsCache.keys()) {
      if (key.startsWith(prefix)) {
        itemCountsCache.delete(key);
      }
    }
  }

  function normalizeTranslationSourceText(value, options = {}) {
    const raw = String(value || "");
    if (!options.preserveParagraphs) {
      return raw
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return raw
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|pre|figcaption)>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getTitleTranslationSource(item) {
    return normalizeTranslationSourceText(item?.title || "");
  }

  function getBodyTranslationSource(item) {
    const articleSource = normalizeTranslationSourceText(item?.content_text || item?.content_html || "", {
      preserveParagraphs: true
    });
    const pageSource = normalizeTranslationSourceText(item?.page_text || item?.page_html || "", {
      preserveParagraphs: true
    });
    if (pageSource && (!articleSource || (articleSource.length < 300 && pageSource.length > articleSource.length))) {
      return pageSource;
    }

    return articleSource || normalizeTranslationSourceText(item?.content_excerpt || item?.summary || item?.title || "", {
      preserveParagraphs: true
    });
  }

  function getSummarySourceText(item) {
    const articleSource = normalizeTranslationSourceText(
      item?.content_text || item?.content_html || item?.content_excerpt || item?.summary || item?.title || "",
      { preserveParagraphs: true }
    );
    const pageSource = normalizeTranslationSourceText(item?.page_text || item?.page_html || "", {
      preserveParagraphs: true
    });
    if (articleSource && pageSource && articleSource !== pageSource) {
      return `正文原文：\n${articleSource}\n\n网页原文：\n${pageSource}`;
    }
    return articleSource || pageSource;
  }

  function hasUsefulSummarySource(item) {
    if (!item) return false;
    if (hasUsableStoredArticleContent(item)) return true;
    if (hasUsableStoredPageContent(item)) return true;
    return getSummarySourceText(item).length >= 300;
  }

  function canHydratePageForSummary(item) {
    return Boolean(
      item &&
        typeof feedService.hydrateItemPageContent === "function" &&
        !hasUsableStoredPageContent(item) &&
        String(item.original_url || item.link || "").trim()
    );
  }

  function formatAiRuntimeError(runtime, error) {
    const label = runtime.label || runtime.source || "AI";
    return `${label}: ${error?.message || String(error)}`;
  }

  function createAiSummaryError(errors) {
    if (!errors.length) {
      return badRequest("AI 接口未配置，请先在后台或会员中心填写接口地址和 API Key", {
        code: "ai_provider_unconfigured"
      });
    }

    const first = errors[0].error;
    const status = Number(first?.status || 502);
    return createError(status, `AI 总结失败。详情：${errors.map(({ runtime, error }) => formatAiRuntimeError(runtime, error)).join(" | ")}`, {
      code: first?.code || (status >= 500 ? "ai_summary_failed" : "bad_request")
    });
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

  function shouldSkipTranslationForChineseSource(translationSettings, item, bodySource = "", options = {}) {
    if (!isChineseTargetLanguage(translationSettings?.targetLanguage)) {
      return false;
    }

    const titleSource = Object.prototype.hasOwnProperty.call(options, "titleSource")
      ? String(options.titleSource || "")
      : getTitleTranslationSource(item);
    const titleLooksChinese = !String(titleSource || "").trim() || looksLikeChineseText(titleSource);
    const bodyText = bodySource || getBodyTranslationSource(item);
    const needsBody = translationSettings?.translationMode === "full" && Boolean(String(bodyText || "").trim());
    const bodyLooksChinese = !needsBody || looksLikeChineseText(bodyText);
    const needsLocalConversion =
      canConvertTraditionalToSimplified(titleSource, translationSettings?.targetLanguage) ||
      (needsBody && canConvertTraditionalToSimplified(bodyText, translationSettings?.targetLanguage));
    if (needsLocalConversion) {
      return false;
    }
    return titleLooksChinese && bodyLooksChinese;
  }

  function shouldUseOriginalChineseField(translationSettings, value = "") {
    return (
      isChineseTargetLanguage(translationSettings?.targetLanguage) &&
      looksLikeChineseText(value) &&
      !canConvertTraditionalToSimplified(value, translationSettings?.targetLanguage)
    );
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

  function trimListText(value, limit) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= limit) return text;
    return text.slice(0, limit);
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
      translated_body_available: storedTranslation.text ? 1 : 0,
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

  function compactItemForListPayload(item) {
    if (!item) return item;
    const {
      translated_text: _translatedText,
      translated_body_available: _translatedBodyAvailable,
      content_text: _contentText,
      content_html: _contentHtml,
      page_text: _pageText,
      page_html: _pageHtml,
      ai_summary: _aiSummary,
      ...rest
    } = item;

    return {
      ...rest,
      summary: trimListText(rest.summary, 320),
      content_excerpt: trimListText(rest.content_excerpt, 240),
      translated_body_available: item.translated_body_available ? 1 : 0,
      translated_excerpt: trimListText(rest.translated_excerpt, 180)
    };
  }

  function hasSatisfiedTranslation(item, translationSettings) {
    const hasTitle = Boolean(String(item?.translated_title || "").trim());
    if (translationSettings.translationMode === "title") {
      return hasTitle;
    }
    return hasTitle && Boolean(String(item?.translated_text || "").trim());
  }

  async function translateTextWithProviderRuntime(userId, translationSettings, provider, text) {
    const sourceText = String(text || "").trim();
    if (!sourceText) return "";
    const runtimes = typeof accountService.getEffectiveTranslationRuntimes === "function"
      ? accountService.getEffectiveTranslationRuntimes(userId, {
          provider,
          targetLanguage: translationSettings?.targetLanguage
        })
      : [
          accountService.getEffectiveTranslationRuntime(userId, {
            provider,
            targetLanguage: translationSettings?.targetLanguage
          })
        ];
    let lastError = null;
    for (const runtimeConfig of runtimes) {
      try {
        return await translator.translate(runtimeConfig, sourceText);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function isTranslationProviderUsable(userId, provider) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (!supportsServerTranslation(normalizedProvider)) return false;
    const status = typeof accountService.getTranslationProviderStatus === "function"
      ? accountService.getTranslationProviderStatus(userId, normalizedProvider)
      : null;
    return status ? Boolean(status.configured && status.autoTranslateSupported) : true;
  }

  function getTranslationProviderCandidates(userId, translationSettings) {
    const primary = String(translationSettings?.provider || "").trim().toLowerCase();
    if (typeof accountService.getTranslationProviderStatus !== "function") {
      return primary ? [primary] : [];
    }
    const fallbackOrder = typeof accountService.getTranslationFallbackProviders === "function"
      ? accountService.getTranslationFallbackProviders()
      : DEFAULT_TRANSLATION_PROVIDER_FALLBACK_ORDER;
    const providers = [primary, ...fallbackOrder]
      .filter(Boolean)
      .filter((provider, index, all) => all.indexOf(provider) === index);
    const usable = providers.filter((provider) => isTranslationProviderUsable(userId, provider));
    return usable.length ? usable : providers.slice(0, 1);
  }

  async function translateNeededTextWithFallback(userId, translationSettings, needs = {}) {
    let lastError = null;
    for (const provider of getTranslationProviderCandidates(userId, translationSettings)) {
      try {
        const [translatedTitle, translatedText] = await Promise.all([
          needs.title
            ? translateTextWithProviderRuntime(userId, translationSettings, provider, needs.title)
            : Promise.resolve(needs.existingTitle || ""),
          needs.body
            ? translateTextWithProviderRuntime(userId, translationSettings, provider, needs.body)
            : Promise.resolve(needs.existingText || "")
        ]);
        return { translatedTitle, translatedText, provider };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function translateNeededTextLocally(translationSettings, needs = {}) {
    if (!/^zh-CN$/i.test(String(translationSettings?.targetLanguage || "").trim())) {
      return null;
    }

    function convertField(value = "") {
      const text = String(value || "");
      if (!text) return { text: "", converted: false, supported: true };
      if (canConvertTraditionalToSimplified(text, translationSettings.targetLanguage)) {
        return {
          text: convertTraditionalToSimplified(text),
          converted: true,
          supported: true
        };
      }
      if (looksLikeChineseText(text)) {
        return { text, converted: false, supported: true };
      }
      return { text: "", converted: false, supported: false };
    }

    const convertedTitle = convertField(needs.title);
    const convertedText = convertField(needs.body);
    if ((needs.title && !convertedTitle.supported) || (needs.body && !convertedText.supported)) {
      return null;
    }

    if (!convertedTitle.converted && !convertedText.converted) {
      return null;
    }

    return {
      translatedTitle: convertedTitle.text || needs.existingTitle || "",
      translatedText: convertedText.text || needs.existingText || "",
      provider: "local"
    };
  }

  function getNeededTranslationText(sourceItem, translationSettings, existingTranslation = null) {
    const currentTranslation = existingTranslation || resolveStoredTranslation(sourceItem, translationSettings);
    const titleSource = getTitleTranslationSource(sourceItem);
    const bodySource = translationSettings.translationMode === "full" ? getBodyTranslationSource(sourceItem) : "";
    const needsTitle = !currentTranslation.title;
    const needsBody = translationSettings.translationMode === "full" && !currentTranslation.text;
    const titleIsReusableChinese = needsTitle && shouldUseOriginalChineseField(translationSettings, titleSource);
    const bodyIsReusableChinese = needsBody && shouldUseOriginalChineseField(translationSettings, bodySource);

    return {
      titleSource,
      bodySource,
      needsTitle,
      needsBody,
      neededText: {
        title: needsTitle && !titleIsReusableChinese ? titleSource : "",
        body: needsBody && !bodyIsReusableChinese ? bodySource : "",
        existingTitle: currentTranslation.title || (titleIsReusableChinese ? titleSource : ""),
        existingText: currentTranslation.text || (bodyIsReusableChinese ? bodySource : "")
      }
    };
  }

  function canAutoTranslateItem(accountInfo, translationSettings) {
    return Boolean(
      translationSettings?.autoTranslate &&
        translationSettings?.autoTranslateSupported &&
        translationSettings?.providerConfigured &&
        accountInfo?.features?.translation
    );
  }

  function getAutomaticTranslationSettings(translationSettings) {
    return {
      ...translationSettings,
      translationMode: "title",
      translationModeLabel: "仅标题"
    };
  }

  async function translateItemForUser(user, item, translationSettings) {
    const account = accountService.getAccount(user);
    if (!account.features.translation) {
      throw forbidden("当前套餐不支持翻译功能", { code: "translation_unavailable" });
    }

    let sourceItem = item;
    let existingTranslation = resolveStoredTranslation(sourceItem, translationSettings);
    const hasExistingTitle = Boolean(existingTranslation.title);
    const hasExistingBody = Boolean(existingTranslation.text);
    if (translationSettings.translationMode === "title" ? hasExistingTitle : hasExistingTitle && hasExistingBody) {
      return {
        item: presentItemForUser(user.id, sourceItem, translationSettings),
        translatedTitle: existingTranslation.title,
        translatedText: existingTranslation.text,
        skipped: false,
        reused: true
      };
    }

    const {
      titleSource,
      bodySource,
      needsTitle,
      needsBody,
      neededText
    } = getNeededTranslationText(sourceItem, translationSettings, existingTranslation);

    if (!needsTitle && !needsBody) {
      return {
        item: presentItemForUser(user.id, sourceItem, translationSettings),
        translatedTitle: existingTranslation.title,
        translatedText: existingTranslation.text,
        skipped: false,
        reused: true
      };
    }

    const localTranslation = translateNeededTextLocally(translationSettings, neededText);
    if (!localTranslation && shouldSkipTranslationForChineseSource(translationSettings, sourceItem, bodySource, { titleSource })) {
      return {
        item: presentItemForUser(user.id, sourceItem, translationSettings),
        translatedTitle: existingTranslation.title,
        translatedText: existingTranslation.text,
        skipped: true
      };
    }

    const translated =
      localTranslation ||
      await translateNeededTextWithFallback(user.id, translationSettings, neededText);
    const translatedTitle = translated.translatedTitle;
    const translatedText = translated.translatedText;

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
      provider: translated.provider || translationSettings.provider,
      skipped: false
    };
  }

  async function translateItemForUserWithRetry(user, item, translationSettings, options = {}) {
    const retryAttempts = Math.max(1, Math.min(3, Number(options.retryAttempts || 1)));
    let lastError = null;

    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      try {
        return await translateItemForUser(user, item, translationSettings);
      } catch (error) {
        lastError = error;
        if (attempt < retryAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }

    throw lastError;
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

  async function ensureImmediateListTranslations(user, rawItems, accountInfo, options = {}) {
    if (!user || !accountInfo || !Array.isArray(rawItems) || !rawItems.length) {
      return rawItems;
    }

    const useAutomaticTitleOnly = options.useAutomaticTitleOnly !== false;
    const translatedByIndex = new Map();
    const candidates = [];

    for (const [index, item] of rawItems.entries()) {
      if (candidates.length >= AUTO_TRANSLATE_LIST_SYNC_BATCH_SIZE) {
        break;
      }

      const baseTranslation = getEffectiveItemTranslationSettings(user.id, item);
      const effectiveTranslation = useAutomaticTitleOnly
        ? getAutomaticTranslationSettings(baseTranslation)
        : baseTranslation;
      const presented = presentItemForUser(user.id, item, effectiveTranslation);
      if (!effectiveTranslation.displayTranslated || !accountInfo?.features?.translation) {
        continue;
      }
      if (hasSatisfiedTranslation(presented, effectiveTranslation)) {
        continue;
      }
      const existingTranslation = resolveStoredTranslation(item, effectiveTranslation);
      const { titleSource, bodySource, neededText } = getNeededTranslationText(
        item,
        effectiveTranslation,
        existingTranslation
      );
      const localTranslation = translateNeededTextLocally(effectiveTranslation, neededText);
      if (localTranslation && !effectiveTranslation.autoTranslate) {
        continue;
      }
      if (!localTranslation && !canAutoTranslateItem(accountInfo, effectiveTranslation)) {
        continue;
      }
      if (!localTranslation && shouldSkipTranslationForChineseSource(effectiveTranslation, item, bodySource, { titleSource })) {
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
        const result = await translateItemForUserWithRetry(
          user,
          task.item,
          task.translationSettings,
          {
            retryAttempts: options.retryAttempts || 1
          }
        );
        if (result?.item) {
          translatedByIndex.set(task.index, result.item);
        }
      } catch (_error) {
        // Keep list rendering resilient; failed items stay as original language.
      }
    });

    return rawItems.map((item, index) => translatedByIndex.get(index) || item);
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
      const includeTotal = options.includeTotal !== false;
      const total = includeTotal ? feedService.countItems(userId, feedId, queryOptions) : null;
      const pageCount = includeTotal ? Math.max(1, Math.ceil(total / pageSize)) : null;
      const requestedPage = Math.max(1, Number(options.page || 1));
      const page = includeTotal ? Math.min(pageCount, requestedPage) : requestedPage;
      const rawPageItems = feedService.listItems(userId, feedId, includeTotal ? pageSize : pageSize + 1, {
        ...queryOptions,
        offset: (page - 1) * pageSize
      });
      const hasMore = includeTotal ? page < pageCount : rawPageItems.length > pageSize;
      const rawItems = includeTotal ? rawPageItems : rawPageItems.slice(0, pageSize);

      const user = rawItems.length ? store.getUserById(userId) : null;
      const account = user ? accountService.getAccount(user) : null;
      const displayItems = user && account && !options.skipImmediateTranslations
        ? await ensureImmediateListTranslations(user, rawItems, account, {
            useAutomaticTitleOnly: false,
            retryAttempts: 1
          })
        : rawItems;
      const items = displayItems.map((item) => compactItemForListPayload(presentItemForUser(userId, item)));

      return {
        items,
        total,
        page,
        pageSize,
        pageCount: includeTotal ? pageCount : hasMore ? page + 1 : page,
        hasMore,
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

      const cacheKey = `${Number(userId || 0)}:${todaySince}`;
      const cached = itemCountsCache.get(cacheKey);
      if (cached && Date.now() - Number(cached.createdAt || 0) <= ITEM_COUNTS_CACHE_TTL_MS) {
        return cached.value;
      }
      const value = store.countUserItemBuckets(userId, { todaySince });
      itemCountsCache.set(cacheKey, { value, createdAt: Date.now() });
      if (itemCountsCache.size > 200) {
        itemCountsCache.delete(itemCountsCache.keys().next().value);
      }
      return value;
    },
    async translateRecentItemsForRefresh(userId, feedId, options = {}) {
      const user = store.getUserById(userId);
      if (!user) return { translatedCount: 0 };
      const account = accountService.getAccount(user);
      if (!account.features.translation) return { translatedCount: 0 };

      const limit = Math.max(1, Math.min(80, Number(options.limit || 24)));
      const rawItems = feedService.listItems(userId, feedId, limit, { offset: 0 });
      const translatedItems = await ensureImmediateListTranslations(user, rawItems, account, {
        useAutomaticTitleOnly: false,
        retryAttempts: 2
      });
      const translatedCount = translatedItems.filter((item) => String(item?.translated_title || "").trim()).length;
      return { translatedCount };
    },
    async getItemPreview(user, itemId) {
      clearUserItemCountCache(user.id);
      const preview = await feedService.getItemPreview(user.id, itemId);
      return presentItemForUser(user.id, preview);
    },
    async getItemContent(user, itemId, options = {}) {
      clearUserItemCountCache(user.id);
      const item = await feedService.getItemContent(user.id, itemId, options);
      return presentItemForUser(user.id, item);
    },
    async getItemPageContent(user, itemId) {
      clearUserItemCountCache(user.id);
      const item = await feedService.getItemPageContent(user.id, itemId);
      return presentItemForUser(user.id, item);
    },
    async setReadState(userId, itemId, isRead) {
      clearUserItemCountCache(userId);
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
        clearUserItemCountCache(userId);
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
      clearUserItemCountCache(userId);
      return { updatedCount };
    },
    async setFavoriteState(userId, itemId, isFavorited) {
      clearUserItemCountCache(userId);
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
    async translateItem(user, itemId, options = {}) {
      const item = store.getUserItem(user.id, itemId);
      if (!item) {
        throw notFound("Item not found");
      }

      const effectiveSettings = getEffectiveItemTranslationSettings(user.id, item);
      const translationMode = options.translationMode === "full" ? "full" : effectiveSettings.translationMode;
      const translationSettings = {
        ...effectiveSettings,
        translationMode,
        translationModeLabel: translationMode === "full" ? "标题和正文" : "仅标题"
      };
      const translated = await translateItemForUser(user, item, translationSettings);

      return {
        translatedTitle: translated.translatedTitle,
        translatedText: translated.translatedText,
        translatedLanguage: translationSettings.targetLanguage,
        targetLabel: translationSettings.targetLabel,
        translationMode: translationSettings.translationMode,
        provider: translated.provider || translationSettings.provider,
        providerLabel: getTranslationProviderLabel(translated.provider || translationSettings.provider),
        skipped: translated.skipped,
        message: translated.skipped ? "当前文章已是中文，无需翻译" : ""
      };
    },
    async summarizeItem(user, itemId) {
      const account = accountService.getAccount(user);
      if (!account.features.summary) {
        throw forbidden("当前套餐不支持 AI 总结", { code: "summary_unavailable" });
      }

      let item = typeof store.getUserItem === "function" ? store.getUserItem(user.id, itemId) : null;
      const existingSummary = String(item?.ai_summary || "").trim();
      if (existingSummary) {
        return { aiSummary: existingSummary, reused: true };
      }

      let hydrateError = null;
      if (!hasUsefulSummarySource(item)) {
        try {
          item = await feedService.hydrateItemContent(user.id, itemId);
        } catch (error) {
          hydrateError = error;
          item = typeof store.getUserItem === "function" ? store.getUserItem(user.id, itemId) : item;
        }
      }

      if (canHydratePageForSummary(item)) {
        try {
          item = await feedService.hydrateItemPageContent(user.id, itemId);
        } catch (_error) {
          item = typeof store.getUserItem === "function" ? store.getUserItem(user.id, itemId) : item;
        }
      }

      const content = getSummarySourceText(item);
      if (!content && hydrateError) {
        throw hydrateError;
      }
      const aiRuntimes = accountService.getEffectiveAiRuntimes(user.id);
      const errors = [];
      let output = "";
      for (const runtime of aiRuntimes) {
        try {
          output = await ai.summarize(runtime, content);
          store.updateSummary(item.id, output);
          return { aiSummary: output };
        } catch (error) {
          errors.push({ runtime, error });
        }
      }
      throw createAiSummaryError(errors);
    }
  };
}
