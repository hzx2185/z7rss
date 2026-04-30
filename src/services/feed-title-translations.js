import { cleanCategory, getFeedFreshness, inferFeedCategory } from "./feed-metadata.js";

const FEED_TITLE_SYNC_BATCH_SIZE = 48;
const FEED_TITLE_SYNC_CONCURRENCY = 3;
const FEED_TITLE_BACKGROUND_CONCURRENCY = 2;

function normalizeTranslationSourceText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFeedTitleSource(feed) {
  return normalizeTranslationSourceText(feed?.custom_title || feed?.title || "");
}

function isChineseTargetLanguage(targetLanguage) {
  return /^zh(?:-|$)/i.test(String(targetLanguage || "").trim());
}

function looksLikeChineseText(value = "") {
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

function shouldSkipFeedTitleTranslation(translationSettings, feed) {
  if (!isChineseTargetLanguage(translationSettings?.targetLanguage)) {
    return false;
  }
  return looksLikeChineseText(getFeedTitleSource(feed));
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

export function createFeedTitleTranslations({
  accountService,
  getFeedFetchSettings,
  maskFeedFetchSettings,
  store,
  translator
}) {
  const pendingFeedTitleTranslations = new Set();

  function resolveStoredFeedTitleTranslation(feed, translationSettings) {
    const expectedLanguage = String(translationSettings?.targetLanguage || "").trim();
    const translatedTitle = String(feed?.translated_title || "").trim();
    const translatedLanguage = String(feed?.translated_language || "").trim();
    const translatedSourceTitle = String(feed?.translated_source_title || "").trim();
    const currentSourceTitle = getFeedTitleSource(feed);

    if (!translatedTitle) {
      return {
        title: "",
        language: "",
        sourceTitle: ""
      };
    }

    if (translatedSourceTitle && currentSourceTitle && translatedSourceTitle !== currentSourceTitle) {
      return {
        title: "",
        language: "",
        sourceTitle: ""
      };
    }

    if (expectedLanguage && translatedLanguage && translatedLanguage !== expectedLanguage) {
      return {
        title: "",
        language: "",
        sourceTitle: ""
      };
    }

    return {
      title: translatedTitle,
      language: translatedLanguage || expectedLanguage,
      sourceTitle: translatedSourceTitle || currentSourceTitle
    };
  }

  function serializeUserFeed(userId, feed, translationSettings = null, feedFetchSettings = null) {
    if (!feed) return null;
    const translation = translationSettings || accountService.getEffectiveFeedTranslationSettings(userId, feed);
    const fetchSettings = maskFeedFetchSettings(feedFetchSettings || getFeedFetchSettings(userId, feed.feed_id));
    const storedTranslation = resolveStoredFeedTitleTranslation(feed, translation);
    const suggestedCategory = inferFeedCategory(feed) || cleanCategory(feed.auto_category);
    const effectiveCategory = cleanCategory(feed.category) || suggestedCategory || "未分类";
    const freshness = getFeedFreshness(feed.last_fetched_at);
    const hasError = Boolean(String(feed.last_error || "").trim());
    return {
      ...feed,
      translated_title: storedTranslation.title,
      translated_language: storedTranslation.language,
      translated_source_title: storedTranslation.sourceTitle,
      has_translation: storedTranslation.title ? 1 : 0,
      category: effectiveCategory,
      category_manual: cleanCategory(feed.category) || "",
      category_suggested: suggestedCategory || "",
      is_archived: Boolean(feed.is_archived),
      is_collapsed: Boolean(feed.is_collapsed),
      is_public: Boolean(feed.is_public),
      has_error: hasError,
      last_fetched_days: freshness.lastFetchedDays,
      is_stale: freshness.isStale,
      freshness_label: hasError ? "读取异常" : freshness.freshnessLabel,
      fetch: fetchSettings,
      fetch_request_profile: fetchSettings.request_profile,
      fetch_feed_format: fetchSettings.feed_format,
      fetch_timeout_ms: fetchSettings.timeout_ms,
      fetch_feed_url: fetchSettings.feed_url,
      fetch_login_url: fetchSettings.login_url,
      fetch_username: fetchSettings.username,
      fetch_username_field: fetchSettings.username_field,
      fetch_password_field: fetchSettings.password_field,
      fetch_password_configured: fetchSettings.password_configured,
      fetch_cookie_configured: fetchSettings.cookie_configured,
      fetch_article_selector: fetchSettings.article_selector,
      fetch_page_selector: fetchSettings.page_selector,
      fetch_json_items_path: fetchSettings.json_items_path,
      fetch_json_title_path: fetchSettings.json_title_path,
      fetch_json_link_path: fetchSettings.json_link_path,
      fetch_json_date_path: fetchSettings.json_date_path,
      fetch_json_summary_path: fetchSettings.json_summary_path,
      fetch_json_content_path: fetchSettings.json_content_path,
      has_custom_fetch: fetchSettings.has_custom_fetch,
      translation: {
        provider: translation.provider,
        targetLanguage: translation.targetLanguage,
        targetLabel: translation.targetLabel,
        autoTranslate: translation.autoTranslate,
        displayTranslated: translation.displayTranslated,
        translationMode: translation.translationMode,
        translationModeLabel: translation.translationModeLabel,
        targetLanguageInherited: !feed.translation_target_language,
        autoTranslateInherited: feed.auto_translate === null || feed.auto_translate === undefined,
        displayTranslatedInherited: feed.display_translated === null || feed.display_translated === undefined,
        translationModeInherited: !feed.translation_mode
      }
    };
  }

  function hasSatisfiedFeedTitleTranslation(feed, translationSettings) {
    return Boolean(resolveStoredFeedTitleTranslation(feed, translationSettings).title);
  }

  function canTranslateFeedTitle(accountInfo, translationSettings) {
    return Boolean(
      translator?.translate &&
        accountInfo?.features?.translation &&
        translationSettings?.providerConfigured &&
        (translationSettings?.displayTranslated || translationSettings?.autoTranslate)
    );
  }

  function buildFeedTranslationKey(userId, feedId, translationSettings) {
    return [
      Number(userId || 0),
      Number(feedId || 0),
      String(translationSettings?.targetLanguage || "").trim()
    ].join(":");
  }

  async function translateFeedTitleForUser(user, feed, translationSettings) {
    const sourceTitle = getFeedTitleSource(feed);
    if (!sourceTitle) {
      return {
        feed: serializeUserFeed(user.id, feed, translationSettings),
        translatedTitle: "",
        skipped: true
      };
    }

    if (shouldSkipFeedTitleTranslation(translationSettings, feed)) {
      return {
        feed: serializeUserFeed(user.id, feed, translationSettings),
        translatedTitle: "",
        skipped: true
      };
    }

    const runtimeConfig = accountService.getEffectiveTranslationRuntime(user.id, {
      provider: translationSettings?.provider,
      targetLanguage: translationSettings?.targetLanguage
    });
    const translatedTitle = await translator.translate(runtimeConfig, sourceTitle);
    const stored = store.setUserFeedTranslation(
      user.id,
      feed.feed_id,
      translatedTitle,
      translationSettings.targetLanguage,
      sourceTitle
    );

    return {
      feed: serializeUserFeed(user.id, stored || feed, translationSettings),
      translatedTitle,
      skipped: false
    };
  }

  async function ensureImmediateFeedTitleTranslations(user, rawFeeds, accountInfo) {
    if (!user || !accountInfo || !Array.isArray(rawFeeds) || !rawFeeds.length) {
      return rawFeeds;
    }

    const translatedByIndex = new Map();
    const candidates = [];
    const immediateLimit = rawFeeds.length <= 120 ? rawFeeds.length : FEED_TITLE_SYNC_BATCH_SIZE;
    const prioritizedFeeds = rawFeeds
      .map((feed, index) => ({ feed, index }))
      .sort((left, right) => {
        const leftUnread = Number(left.feed?.unread_count || 0);
        const rightUnread = Number(right.feed?.unread_count || 0);
        if (leftUnread !== rightUnread) return rightUnread - leftUnread;
        return left.index - right.index;
      });

    for (const entry of prioritizedFeeds) {
      if (candidates.length >= immediateLimit) {
        break;
      }

      const effectiveTranslation = accountService.getEffectiveFeedTranslationSettings(user.id, entry.feed);
      if (!effectiveTranslation.displayTranslated || !canTranslateFeedTitle(accountInfo, effectiveTranslation)) {
        continue;
      }
      if (hasSatisfiedFeedTitleTranslation(entry.feed, effectiveTranslation)) {
        continue;
      }
      if (shouldSkipFeedTitleTranslation(effectiveTranslation, entry.feed)) {
        continue;
      }

      candidates.push({
        index: entry.index,
        feed: entry.feed,
        translationSettings: effectiveTranslation
      });
    }

    if (!candidates.length) {
      return rawFeeds;
    }

    await mapWithConcurrency(candidates, FEED_TITLE_SYNC_CONCURRENCY, async (task) => {
      try {
        const result = await translateFeedTitleForUser(user, task.feed, task.translationSettings);
        if (result?.feed) {
          translatedByIndex.set(task.index, result.feed);
        }
      } catch (_error) {
        // Feed title translation is best-effort and should not block feed list rendering.
      }
    });

    return rawFeeds.map((feed, index) => translatedByIndex.get(index) || feed);
  }

  function scheduleFeedTitleTranslations(user, rawFeeds, accountInfo) {
    if (!user || !accountInfo || !Array.isArray(rawFeeds) || !rawFeeds.length) return;

    const tasks = [];
    for (const feed of rawFeeds) {
      const effectiveTranslation = accountService.getEffectiveFeedTranslationSettings(user.id, feed);
      if (!canTranslateFeedTitle(accountInfo, effectiveTranslation)) {
        continue;
      }
      if (hasSatisfiedFeedTitleTranslation(feed, effectiveTranslation)) {
        continue;
      }
      if (shouldSkipFeedTitleTranslation(effectiveTranslation, feed)) {
        continue;
      }

      const key = buildFeedTranslationKey(user.id, feed.feed_id, effectiveTranslation);
      if (pendingFeedTitleTranslations.has(key)) {
        continue;
      }

      pendingFeedTitleTranslations.add(key);
      tasks.push({
        key,
        feed,
        translationSettings: effectiveTranslation
      });
    }

    if (!tasks.length) return;

    void mapWithConcurrency(tasks, FEED_TITLE_BACKGROUND_CONCURRENCY, async (task) => {
      try {
        await translateFeedTitleForUser(user, task.feed, task.translationSettings);
      } catch (_error) {
        // Best-effort background translation.
      } finally {
        pendingFeedTitleTranslations.delete(task.key);
      }
    }).catch(() => {
      tasks.forEach((task) => pendingFeedTitleTranslations.delete(task.key));
    });
  }

  return {
    ensureImmediateFeedTitleTranslations,
    scheduleFeedTitleTranslations,
    serializeUserFeed
  };
}
