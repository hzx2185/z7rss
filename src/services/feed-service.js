import { badGateway, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { fetchArticleContent, fetchFeed } from "./fetcher.js";
import {
  getReadableTextLength,
  hasUsableStoredArticleContent,
  hasUsableStoredPageContent,
  isLikelyInvalidArticleContent,
  isLikelyUnrelatedArticleContent
} from "./article-content.js";
import { broadFeedCategories, cleanCategory, getDomainFromUrl, getFeedFreshness, inferFeedCategory } from "./feed-metadata.js";
import { createFeedFetchSettings } from "./feed-fetch-settings.js";
import { buildOpml, normalizeImportUrl, parseImportPayload } from "./feed-import-export.js";
import { createFeedTitleTranslations } from "./feed-title-translations.js";

export function createFeedService({ store, accountService, config, translator = null, secretBox = null, ai = null }) {
  const userRefreshJobs = new Map();
  let nextUserRefreshJobId = 1;
  let refreshedItemTranslationScheduler = null;
  const secret = secretBox || {
    encrypt(value) {
      return String(value || "");
    },
    decrypt(value) {
      return String(value || "");
    },
    isEncrypted() {
      return false;
    }
  };
  const supportedTranslationTargets = accountService.getSupportedTranslationTargets();
  const supportedTranslationModes = accountService.getSupportedTranslationModes();

  async function translateRefreshedItems(userId, feedId, inserted = 0) {
    if (typeof refreshedItemTranslationScheduler !== "function") return null;
    const normalizedUserId = Number(userId || 0);
    const normalizedFeedId = Number(feedId || 0);
    if (!normalizedUserId || !normalizedFeedId) return null;
    const limit = Math.max(20, Math.min(80, Number(inserted || 0) || 20));
    return refreshedItemTranslationScheduler({
      userId: normalizedUserId,
      feedId: normalizedFeedId,
      limit
    });
  }

  async function translateRefreshedItemsForSubscribers(feedId, inserted = 0) {
    if (typeof refreshedItemTranslationScheduler !== "function") return { translatedCount: 0 };
    if (typeof store.listUsers !== "function" || typeof store.getUserFeed !== "function") {
      return { translatedCount: 0 };
    }

    let translatedCount = 0;
    for (const user of store.listUsers() || []) {
      if (String(user?.status || "active") !== "active") continue;
      const userId = Number(user?.id || 0);
      if (!userId || !store.getUserFeed(userId, feedId)) continue;
      const result = await translateRefreshedItems(userId, feedId, inserted);
      translatedCount += Number(result?.translatedCount || 0);
    }
    return { translatedCount };
  }

  function normalizeOptionalBoolean(value) {
    if (value === undefined || value === null || value === "" || value === "inherit") {
      return null;
    }
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function normalizeBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === "") {
      return Boolean(fallback);
    }
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function summarizeUserRefreshJob(job) {
    const results = Array.isArray(job?.results) ? job.results : [];
    return {
      jobId: job?.id || "",
      status: job?.status || "unknown",
      total: Number(job?.total || 0),
      processed: Number(job?.processed || 0),
      startedAt: job?.startedAt || null,
      finishedAt: job?.finishedAt || null,
      error: job?.error || "",
      results,
      successCount: results.filter((entry) => entry.ok).length,
      failedCount: results.filter((entry) => !entry.ok).length,
      insertedCount: results.reduce((sum, entry) => sum + Number(entry.inserted || 0), 0),
      fetchedCount: results.reduce((sum, entry) => sum + Number(entry.fetched || 0), 0),
      unreadCount: results.reduce((sum, entry) => sum + Number(entry.unreadCount || 0), 0)
    };
  }

  async function runUserRefreshJob(job) {
    try {
      const feeds = store.listUserFeeds(job.userId);
      job.total = feeds.length;
      let currentIndex = 0;
      const workerCount = Math.min(Math.max(1, Number(config.userRefreshConcurrency || 4)), feeds.length || 1);
      async function worker() {
        while (currentIndex < feeds.length) {
          const feed = feeds[currentIndex];
          currentIndex += 1;
          await refreshOne(feed);
        }
      }
      async function refreshOne(feed) {
        try {
          const result = await refreshFeed(feed.feed_id, { userId: job.userId });
          job.results.push({
            feedId: feed.feed_id,
            ok: true,
            inserted: result.inserted,
            fetched: result.fetched,
            unreadCount: result.unreadCount
          });
        } catch (error) {
          job.results.push({ feedId: feed.feed_id, ok: false, error: error.message });
        } finally {
          job.processed += 1;
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      job.status = "success";
    } catch (error) {
      job.status = "error";
      job.error = error.message;
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  }

  const feedFetchSettings = createFeedFetchSettings({ store, secret });
  const {
    buildFeedFetchSettingsIndex,
    buildRuntimeFeedFetchOptions,
    buildUpdatedFeedFetchSettings,
    getFeedFetchSettings,
    getSharedGlobalFeedFetchSettings,
    maskFeedFetchSettings,
    saveFeedFetchSettings
  } = feedFetchSettings;

  function hasOwn(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  const feedTitleTranslations = createFeedTitleTranslations({
    accountService,
    getFeedFetchSettings,
    maskFeedFetchSettings,
    store,
    translator
  });
  const {
    ensureImmediateFeedTitleTranslations,
    scheduleFeedTitleTranslations,
    serializeUserFeed
  } = feedTitleTranslations;

  function serializePublicFeedItem(item) {
    return {
      id: item.id,
      feed_id: item.feed_id,
      title: String(item.title || "").trim() || "未命名文章",
      link: String(item.link || "").trim(),
      summary: String(item.summary || "").trim(),
      content_text: String(item.content_text || "").trim(),
      author: String(item.author || "").trim(),
      published_at: item.published_at || null,
      created_at: item.created_at || null
    };
  }

  function matchesRule(rule, item) {
    const pattern = String(rule.pattern || "").toLowerCase();
    if (!pattern) return false;
    const haystacks = {
      title: String(item.title || "").toLowerCase(),
      summary: String(item.summary || "").toLowerCase(),
      link: String(item.link || "").toLowerCase()
    };
    return haystacks[rule.kind]?.includes(pattern) || false;
  }

  function filterItems(items) {
    const blockedDomains = new Set(
      store
        .listBlockedSites()
        .filter((entry) => entry.is_active)
        .map((entry) => String(entry.domain || "").toLowerCase())
    );
    const rules = store.listContentRules().filter((entry) => entry.is_active);

    return items.filter((item) => {
      const domain = getDomainFromUrl(item.link);
      if (domain && blockedDomains.has(domain)) {
        return false;
      }
      for (const rule of rules) {
        if (rule.action === "block" && matchesRule(rule, item)) {
          return false;
        }
      }
      return true;
    });
  }

  function hasStoredContent(item) {
    return hasUsableStoredArticleContent(item);
  }

  function hasStoredPageContent(item) {
    return hasUsableStoredPageContent(item);
  }

  function shouldKeepStoredContentAfterArticleFetchError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (code === "article_request_access_challenge") return true;
    if (code === "article_request_failed" && /\b(401|403|429|503)\b/.test(message)) return true;
    return /access challenge|403 forbidden|cloudflare/i.test(message);
  }

  function toItemPreview(item, extra = {}) {
    if (!item) return null;
    const { content_html: _contentHtml, content_text: _contentText, ...preview } = item;
    return {
      ...preview,
      content_loaded: hasStoredContent(item),
      ...extra
    };
  }

  function pruneFeedItems(feedId) {
    const cleanupSettings = typeof store.listSettings === "function"
      ? store.listSettings().reduce((acc, row) => {
          if (row.category === "database_cleanup") acc[row.key] = row.value;
          return acc;
        }, {})
      : {};
    const configuredMaxItems = String(cleanupSettings.max_items_total ?? cleanupSettings.max_items_per_feed ?? "").trim();
    const keepCount = configuredMaxItems === ""
      ? Math.max(0, Number(store.getFeedRetentionLimit(feedId) || 0))
      : Math.max(0, Number(configuredMaxItems) || 0);
    return store.pruneFeedItems(feedId, keepCount, {
      retentionRules: true,
      scope: "user_total",
      maxItemsTotal: configuredMaxItems === "" ? null : keepCount,
      maxAgeDays: Math.max(0, Number(cleanupSettings.max_age_days || 0) || 0),
      protectFavorites: cleanupSettings.protect_favorites === undefined
        ? true
        : ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_favorites).trim().toLowerCase()),
      protectUnread: ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_unread ?? "").trim().toLowerCase()),
      minKeepCount: Math.max(0, Number(cleanupSettings.min_keep_items || 0) || 0)
    });
  }

  function normalizeAiCategory(value, fallback = "未分类") {
    const raw = String(value || "").trim().replace(/[，。"'`]/g, "");
    return broadFeedCategories.includes(raw) ? raw : fallback;
  }

  async function classifyFeedWithAi(feed, items = [], userId = null) {
    const fallback = inferFeedCategory(feed, items);
    if (!ai || !config.aiEnabled) {
      return { category: fallback, source: "rules" };
    }
    const aiRuntimes = accountService.getEffectiveAiRuntimes(userId || 0);
    const errors = [];
    for (const runtime of aiRuntimes) {
      if (!runtime.baseUrl || !runtime.apiKey) continue;
      const sourceText = [
        `订阅源标题: ${feed.title || ""}`,
        `订阅源网址: ${feed.url || ""}`,
        `网站: ${feed.site_url || feed.siteUrl || ""}`,
        `介绍: ${feed.description || ""}`,
        "最近文章:",
        ...items.slice(0, 8).map((item, index) => `${index + 1}. ${item.title || ""} ${item.summary || ""}`.slice(0, 500))
      ].join("\n");
      try {
        const output = await ai.summarize(
          {
            ...runtime,
            summaryPrompt: [
              "你是 RSS 订阅源分类器。只能从以下大类选择一个输出，不要解释，不要输出其他文字。",
              broadFeedCategories.join(" / "),
              "如果不能确定，输出 未分类。"
            ].join("\n")
          },
          sourceText
        );
        return {
          category: normalizeAiCategory(output, fallback),
          source: "ai",
          raw: output
        };
      } catch (error) {
        errors.push(`${runtime.label || runtime.source}: ${error?.message || String(error)}`);
      }
    }
    return { category: fallback, source: "rules" };
  }

  async function reclassifyOne(feedId, options = {}) {
    const feed = store.getFeedById(feedId);
    if (!feed) {
      throw notFound("Feed not found");
    }
    const items = store.listRecentItemsForFeeds([feed.id], 10);
    let result;
    try {
      result = options.useAi ? await classifyFeedWithAi(feed, items, options.userId || null) : null;
    } catch (_error) {
      result = null;
    }
    const category = result?.category || inferFeedCategory(feed, items);
    const updatedFeed = store.updateFeedAutoCategory(feed.id, category);
    return {
      feed: updatedFeed,
      category,
      source: result?.source || "rules",
      raw: result?.raw || ""
    };
  }

  async function refreshFeed(feedId, options = {}) {
    const feed = store.getFeedById(feedId);
    if (!feed) {
      throw notFound("Feed not found");
    }

    const fetchSettings =
      Number.isInteger(Number(options.userId)) && Number(options.userId) > 0
        ? getFeedFetchSettings(Number(options.userId), feedId)
        : getSharedGlobalFeedFetchSettings(feedId);

    try {
      const result = await fetchFeed(fetchSettings?.feed_url || feed.url, {
        timeoutMs: config.crawlTimeoutMs,
        userAgent: config.userAgent,
        etag: feed.etag || "",
        lastModified: feed.last_modified || "",
        ...buildRuntimeFeedFetchOptions(fetchSettings || {})
      });
      if (result.notModified) {
        if (typeof store.touchFeedFetched === "function") {
          store.touchFeedFetched({
            id: feed.id,
            etag: result.etag || feed.etag || null,
            lastModified: result.lastModified || feed.last_modified || null
          });
        } else {
          store.updateFeedMeta({
            id: feed.id,
            title: feed.title,
            siteUrl: feed.site_url || "",
            description: feed.description || "",
            etag: result.etag || feed.etag || null,
            lastModified: result.lastModified || feed.last_modified || null
          });
        }
        const unreadCount =
          Number.isInteger(Number(options.userId)) && Number(options.userId) > 0 && typeof store.countUserItems === "function"
            ? store.countUserItems(Number(options.userId), feed.id, { readState: 0 })
            : null;
        return {
          feed: store.getFeedById(feed.id),
          inserted: 0,
          fetched: 0,
          unreadCount,
          removed: 0,
          translatedCount: 0,
          notModified: true
        };
      }
      store.updateFeedMeta({
        id: feed.id,
        title: result.meta.title || feed.title,
        siteUrl: result.meta.siteUrl || "",
        description: result.meta.description || "",
        etag: result.etag || feed.etag || null,
        lastModified: result.lastModified || feed.last_modified || null
      });
      const filteredItems = filterItems(result.items);
      const insertedResult = store.upsertItems(feed.id, filteredItems);
      const inserted = Number.isFinite(Number(insertedResult)) ? Number(insertedResult) : filteredItems.length;
      store.updateFeedAutoCategory(
        feed.id,
        inferFeedCategory(
          {
            ...feed,
            title: result.meta.title || feed.title,
            site_url: result.meta.siteUrl || feed.site_url || "",
            description: result.meta.description || feed.description || ""
          },
          filteredItems
        )
      );
      const removed = pruneFeedItems(feed.id);
      await hydrateShortItems(feed.id, config.crawlTimeoutMs, config.userAgent, fetchSettings);
      const unreadCount =
        Number.isInteger(Number(options.userId)) && Number(options.userId) > 0 && typeof store.countUserItems === "function"
          ? store.countUserItems(Number(options.userId), feed.id, { readState: 0 })
          : null;
      let translatedCount = 0;
      if (Number.isInteger(Number(options.userId)) && Number(options.userId) > 0) {
        try {
          const translationResult = await translateRefreshedItems(Number(options.userId), feed.id, inserted);
          translatedCount = Number(translationResult?.translatedCount || 0);
        } catch (error) {
          console.warn(`Refresh translation failed for feed ${feed.id}: ${error.message}`);
        }
      } else {
        try {
          const translationResult = await translateRefreshedItemsForSubscribers(feed.id, inserted);
          translatedCount = Number(translationResult?.translatedCount || 0);
        } catch (error) {
          console.warn(`Refresh translation failed for feed ${feed.id}: ${error.message}`);
        }
      }
      return { feed: store.getFeedById(feed.id), inserted, fetched: filteredItems.length, unreadCount, removed, translatedCount };
    } catch (error) {
      store.updateFeedError(feed.id, error.message);
      throw error;
    }
  }

  async function hydrateShortItems(feedId, crawlTimeoutMs, userAgent, fetchSettings = null) {
    try {
      const shortItems = store.listFeedItemsShortContent(feedId, 400, 10);
      if (!shortItems.length) return;
      const runtimeOptions = buildRuntimeFeedFetchOptions(fetchSettings || {});
      for (const item of shortItems) {
        try {
          const article = await fetchArticleContent(item.original_url || item.link, {
            timeoutMs: crawlTimeoutMs,
            userAgent,
            ...runtimeOptions
          });
          if (
            isLikelyInvalidArticleContent({
              articleUrl: item.original_url || item.link,
              text: article.text,
              html: article.html,
              author: item.author,
              summary: item.summary
            }) ||
            isLikelyUnrelatedArticleContent({
              sourceTitle: item.title,
              sourceSummary: item.summary || item.content_text,
              text: article.text,
              html: article.html
            })
          ) {
            continue;
          }
          const oldTextLength = getReadableTextLength(item.content_text || item.content_html || "");
          const newTextLength = getReadableTextLength(article.text || article.html || "");
          if (newTextLength <= oldTextLength) {
            continue;
          }
          store.updateItemContent(item.id, article.html, article.text, article.originalUrl, article.title);
          if (oldTextLength > 0 && newTextLength > oldTextLength * 2) {
            store.clearItemTranslations(item.id);
          }
        } catch (_error) {
          // Skip failed hydrations silently during feed refresh
        }
      }
    } catch (_error) {
      // hydrateShortItems should never break the refresh flow
    }
  }

  async function hydrateItemContent(userId, itemId) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    if (hasStoredContent(item) && (item.crawled_at || getReadableTextLength(item.content_text || item.content_html || "") > 400)) {
      return store.getUserItem(userId, itemId);
    }

    const fetchSettings = getFeedFetchSettings(userId, item.feed_id);
    let article;
    try {
      article = await fetchArticleContent(item.original_url || item.link, {
        timeoutMs: config.crawlTimeoutMs,
        userAgent: config.userAgent,
        ...buildRuntimeFeedFetchOptions(fetchSettings)
      });
    } catch (error) {
      if (hasStoredContent(item) && shouldKeepStoredContentAfterArticleFetchError(error)) {
        return store.getUserItem(userId, itemId) || item;
      }
      throw error;
    }
    if (
      isLikelyInvalidArticleContent({
        articleUrl: item.original_url || item.link,
        text: article.text,
        html: article.html,
        author: item.author,
        summary: item.summary
      })
    ) {
      throw badGateway("Article request returned incomplete content instead of the article body", {
        code: "article_request_incomplete_content"
      });
    }
    if (
      isLikelyUnrelatedArticleContent({
        sourceTitle: item.title,
        sourceSummary: item.summary || item.content_text,
        text: article.text,
        html: article.html
      })
    ) {
      if (hasStoredContent(item)) {
        return store.getUserItem(userId, itemId);
      }
      throw badGateway("Article request returned content unrelated to the feed item", {
        code: "article_request_unrelated_content"
      });
    }
    store.updateItemContent(item.id, article.html, article.text, article.originalUrl, article.title);
    const oldTextLength = getReadableTextLength(item.content_text || item.content_html || "");
    const newTextLength = getReadableTextLength(article.text || article.html || "");
    if (oldTextLength > 0 && newTextLength > oldTextLength * 2) {
      store.clearItemTranslations(item.id);
    }
    return store.getUserItem(userId, itemId);
  }

  async function hydrateItemPageContent(userId, itemId) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    if (hasStoredPageContent(item) && getReadableTextLength(item.page_text || item.page_html || "") > 400) {
      return store.getUserItem(userId, itemId);
    }

    const fetchSettings = getFeedFetchSettings(userId, item.feed_id);
    const page = await fetchArticleContent(item.original_url || item.link, {
      timeoutMs: config.crawlTimeoutMs,
      userAgent: config.userAgent,
      mode: "page",
      ...buildRuntimeFeedFetchOptions(fetchSettings)
    });
    if (
      isLikelyInvalidArticleContent({
        articleUrl: item.original_url || item.link,
        text: page.text,
        html: page.html,
        author: item.author,
        summary: item.summary
      })
    ) {
      throw badGateway("Article request returned incomplete content instead of the article body", {
        code: "article_request_incomplete_content"
      });
    }
    store.updateItemPageContent(item.id, page.html, page.text, page.originalUrl, page.title);
    return store.getUserItem(userId, itemId);
  }

  function setReadState(userId, itemId, isRead) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    return toItemPreview(
      store.setUserItemReadState(userId, itemId, Boolean(isRead), isRead ? new Date().toISOString() : null)
    );
  }

  async function getItemPreview(userId, itemId) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    const marked = store.setUserItemReadState(userId, itemId, true, new Date().toISOString());
    return toItemPreview(marked || item);
  }

  async function getItemContent(userId, itemId) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    store.setUserItemReadState(userId, itemId, true, new Date().toISOString());
    try {
      const hydrated = await hydrateItemContent(userId, itemId);
      return {
        ...hydrated,
        content_loaded: hasStoredContent(hydrated)
      };
    } catch (error) {
      const latest = store.getUserItem(userId, itemId) || item;
      return {
        ...latest,
        content_loaded: hasStoredContent(latest),
        fetch_error: error.message
      };
    }
  }

  async function getItemPageContent(userId, itemId) {
    const item = store.getUserItem(userId, itemId);
    if (!item) {
      throw notFound("Item not found");
    }

    store.setUserItemReadState(userId, itemId, true, new Date().toISOString());
    try {
      const hydrated = await hydrateItemPageContent(userId, itemId);
      return {
        ...hydrated,
        page_loaded: hasStoredPageContent(hydrated)
      };
    } catch (error) {
      const latest = store.getUserItem(userId, itemId) || item;
      return {
        ...latest,
        page_loaded: hasStoredPageContent(latest),
        page_fetch_error: error.message
      };
    }
  }

  return {
    setItemTitleTranslationScheduler(scheduler) {
      refreshedItemTranslationScheduler = typeof scheduler === "function" ? scheduler : null;
    },
    async listFeeds(userId, options = {}) {
      const rawFeeds = store.listUserFeeds(userId);
      const user = rawFeeds.length ? store.getUserById(userId) : null;
      const account = user ? accountService.getAccount(user) : null;
      const baseTranslation = user && typeof accountService.getEffectiveTranslationSettings === "function"
        ? accountService.getEffectiveTranslationSettings(userId)
        : null;
      const providerStatus = baseTranslation && typeof accountService.getTranslationProviderStatus === "function"
        ? accountService.getTranslationProviderStatus(userId, baseTranslation.provider)
        : null;
      const displayFeeds = user && !options.skipImmediateTranslations
        ? await ensureImmediateFeedTitleTranslations(user, rawFeeds, account)
        : rawFeeds;
      const feedFetchSettingsIndex = buildFeedFetchSettingsIndex(userId);
      if (user && displayFeeds.length) {
        if (options.skipImmediateTranslations) {
          setTimeout(() => {
            try {
              scheduleFeedTitleTranslations(user, displayFeeds, account);
            } catch (_error) {
              // Fast boot should never be held hostage by background translation setup.
            }
          }, 0);
        } else {
          scheduleFeedTitleTranslations(user, displayFeeds, account);
        }
      }
      return displayFeeds.map((feed) =>
        serializeUserFeed(
          userId,
          feed,
          baseTranslation
            ? accountService.getEffectiveFeedTranslationSettings(userId, feed, { baseTranslation, providerStatus })
            : null,
          feedFetchSettingsIndex.get(Number(feed.feed_id)) || null
        )
      );
    },
    listPublicFeedPlaza(viewerUserId = null, options = {}) {
      const limit = Math.max(1, Math.min(120, Number(options.limit) || 24));
      const itemLimit = Math.max(1, Math.min(10, Number(options.itemLimit) || 3));
      const feeds = store.listPublicFeeds(limit);
      const feedIds = feeds.map((feed) => Number(feed.id)).filter((feedId) => feedId > 0);
      const viewerFeedIds = viewerUserId ? new Set(store.listUserFeedIdsByFeedIds(viewerUserId, feedIds)) : new Set();
      const itemsByFeedId = new Map();

      for (const item of store.listRecentItemsForFeeds(feedIds, itemLimit)) {
        const normalizedFeedId = Number(item.feed_id);
        if (!itemsByFeedId.has(normalizedFeedId)) {
          itemsByFeedId.set(normalizedFeedId, []);
        }
        itemsByFeedId.get(normalizedFeedId).push(serializePublicFeedItem(item));
      }

      return feeds.map((feed) => {
        const suggestedCategory = inferFeedCategory(feed) || cleanCategory(feed.auto_category) || "未分类";
        const freshness = getFeedFreshness(feed.last_fetched_at);
        const hasError = Boolean(String(feed.last_error || "").trim());
        return {
          id: Number(feed.id),
          title: String(feed.title || "").trim() || String(feed.url || "").trim() || `#${feed.id}`,
          url: String(feed.url || "").trim(),
          site_url: String(feed.site_url || "").trim(),
          description: String(feed.description || "").trim(),
          category: suggestedCategory,
          auto_category: suggestedCategory,
          sharer_count: Number(feed.sharer_count || 0),
          item_count: Number(feed.item_count || 0),
          viewer_subscribed: viewerFeedIds.has(Number(feed.id)),
          has_error: hasError,
          last_fetched_at: feed.last_fetched_at || null,
          freshness_label: hasError ? "读取异常" : freshness.freshnessLabel,
          items: itemsByFeedId.get(Number(feed.id)) || []
        };
      });
    },
    listItems(userId, feedId, limit, options = {}) {
      return store.listUserItems(userId, feedId, limit, options);
    },
    countItems(userId, feedId, options = {}) {
      return store.countUserItems(userId, feedId, options);
    },
    async addFeed(userId, { title, url, isPublic }) {
      if (!url) {
        throw badRequest("Feed URL is required", { code: "feed_url_required" });
      }
      const domain = getDomainFromUrl(url);
      const siteBlocked = store
        .listBlockedSites()
        .some((entry) => entry.is_active && String(entry.domain || "").toLowerCase() === domain);
      if (siteBlocked) {
        throw forbidden("该网站已被系统屏蔽", { code: "feed_site_blocked" });
      }

      const account = accountService.getAccount({ id: userId });
      if (account.usage.feedCount >= account.usage.feedLimit) {
        throw forbidden(`当前套餐最多支持 ${account.usage.feedLimit} 个订阅源`, {
          code: "feed_limit_reached"
        });
      }

      const canonicalFeed = store.getOrCreateFeed({
        title: title || url,
        url,
        siteUrl: "",
        description: ""
      });
      if (!String(canonicalFeed.auto_category || "").trim()) {
        store.updateFeedAutoCategory(canonicalFeed.id, inferFeedCategory(canonicalFeed));
      }

      try {
        store.linkUserFeed(userId, canonicalFeed.id, title || "");
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw conflict("你已经订阅过这个源", { code: "feed_already_subscribed" });
        }
        throw error;
      }

      if (isPublic !== undefined && isPublic !== null) {
        store.updateUserFeedPreferences(userId, canonicalFeed.id, { is_public: isPublic ? 1 : 0 });
      }

      let warning = null;
      try {
        await refreshFeed(canonicalFeed.id);
      } catch (error) {
        warning = error.message;
      }

      return {
        feed: serializeUserFeed(userId, store.getUserFeed(userId, canonicalFeed.id)),
        warning
      };
    },
    async importFeeds(userId, input) {
      const candidates = parseImportPayload(input);
      const uniqueFeeds = [];
      const seen = new Set();

      for (const entry of candidates) {
        const normalizedUrl = normalizeImportUrl(entry.url);
        if (!normalizedUrl) continue;
        if (seen.has(normalizedUrl)) continue;
        seen.add(normalizedUrl);
        uniqueFeeds.push({
          url: normalizedUrl,
          title: String(entry.title || "").trim()
        });
      }

      if (!uniqueFeeds.length) {
        throw badRequest("没有可导入的有效订阅源", { code: "import_entries_empty" });
      }

      const results = {
        total: uniqueFeeds.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        entries: []
      };

      for (const entry of uniqueFeeds) {
        try {
          const result = await this.addFeed(userId, entry);
          results.imported += 1;
          results.entries.push({
            url: entry.url,
            title: result.feed?.title || entry.title || entry.url,
            status: result.warning ? "warning" : "imported",
            warning: result.warning || null
          });
        } catch (error) {
          if (/订阅过/.test(error.message)) {
            results.skipped += 1;
            results.entries.push({
              url: entry.url,
              title: entry.title || entry.url,
              status: "skipped",
              warning: error.message
            });
            continue;
          }
          results.failed += 1;
          results.entries.push({
            url: entry.url,
            title: entry.title || entry.url,
            status: "failed",
            warning: error.message
          });
          if (/最多支持/.test(error.message)) {
            break;
          }
        }
      }

      return results;
    },
    exportFeeds(userId, format = "opml") {
      const feeds = store.listUserFeeds(userId);
      if (format === "json") {
        return JSON.stringify(
          feeds.map((feed) => ({
            title: feed.title,
            url: feed.url,
            site_url: feed.site_url,
            description: feed.description
          })),
          null,
          2
        );
      }
      return buildOpml(feeds, store.getUserById(userId)?.display_name || "Z7 RSS User");
    },
    async refreshFeedForUser(userId, feedId) {
      const userFeed = store.getUserFeed(userId, feedId);
      if (!userFeed) {
        throw notFound("Feed not found");
      }
      return refreshFeed(feedId, { userId });
    },
    async refreshGlobalFeed(feedId) {
      return refreshFeed(feedId);
    },
    updateFeedTitleForUser(userId, feedId, customTitle) {
      const userFeed = store.getUserFeed(userId, feedId);
      if (!userFeed) {
        throw notFound("Feed not found");
      }
      return serializeUserFeed(userId, store.updateUserFeedCustomTitle(userId, feedId, String(customTitle || "").trim()));
    },
    updateFeedPreferencesForUser(userId, feedId, payload = {}) {
      const userFeed = store.getUserFeed(userId, feedId);
      if (!userFeed) {
        throw notFound("Feed not found");
      }

      const customTitle = hasOwn(payload, "customTitle") || hasOwn(payload, "title")
        ? String(payload.customTitle || payload.title || "").trim()
        : String(userFeed.custom_title || "").trim();
      const hasTargetLanguage =
        hasOwn(payload, "targetLanguage") || hasOwn(payload, "target_language") || hasOwn(payload, "translationTargetLanguage");
      const rawTargetLanguage = String(
        hasTargetLanguage
          ? payload.targetLanguage ?? payload.target_language ?? payload.translationTargetLanguage ?? ""
          : userFeed.translation_target_language ?? ""
      ).trim();
      const targetLanguage = rawTargetLanguage || null;
      if (targetLanguage && !supportedTranslationTargets[targetLanguage]) {
        throw badRequest("目标语言无效", { code: "invalid_translation_target" });
      }
      const hasTranslationMode = hasOwn(payload, "translationMode") || hasOwn(payload, "translation_mode");
      const rawTranslationMode = String(
        hasTranslationMode ? payload.translationMode ?? payload.translation_mode ?? "" : userFeed.translation_mode ?? ""
      )
        .trim()
        .toLowerCase();
      const translationMode = rawTranslationMode || null;
      if (translationMode && !supportedTranslationModes[translationMode]) {
        throw badRequest("翻译范围无效", { code: "invalid_translation_mode" });
      }

      const currentFetchSettings = getFeedFetchSettings(userId, feedId);
      const fetchSettings = saveFeedFetchSettings(
        userId,
        feedId,
        buildUpdatedFeedFetchSettings(currentFetchSettings, payload)
      );
      const isPublic =
        hasOwn(payload, "isPublic") || hasOwn(payload, "is_public")
          ? normalizeBoolean(payload.isPublic ?? payload.is_public, userFeed.is_public)
          : Boolean(userFeed.is_public);

      return serializeUserFeed(
        userId,
        store.updateUserFeedPreferences(userId, feedId, {
          customTitle: customTitle || null,
          category: cleanCategory(hasOwn(payload, "category") ? payload.category : userFeed.category),
          isArchived: normalizeBoolean(hasOwn(payload, "isArchived") ? payload.isArchived : userFeed.is_archived, userFeed.is_archived),
          isCollapsed: normalizeBoolean(hasOwn(payload, "isCollapsed") ? payload.isCollapsed : userFeed.is_collapsed, userFeed.is_collapsed),
          translationTargetLanguage: targetLanguage,
          autoTranslate:
            hasOwn(payload, "autoTranslate") || hasOwn(payload, "auto_translate")
              ? normalizeOptionalBoolean(payload.autoTranslate ?? payload.auto_translate)
              : userFeed.auto_translate,
          displayTranslated:
            hasOwn(payload, "displayTranslated") || hasOwn(payload, "display_translated")
              ? normalizeOptionalBoolean(payload.displayTranslated ?? payload.display_translated)
              : userFeed.display_translated,
          translationMode,
          isPublic
        }),
        null,
        fetchSettings
      );
    },
    async refreshAllForUser(userId) {
      const feeds = store.listUserFeeds(userId);
      const results = [];
      for (const feed of feeds) {
        try {
          const result = await refreshFeed(feed.feed_id, { userId });
          results.push({ feedId: feed.feed_id, ok: true, inserted: result.inserted, fetched: result.fetched, unreadCount: result.unreadCount });
        } catch (error) {
          results.push({ feedId: feed.feed_id, ok: false, error: error.message });
        }
      }
      return results;
    },
    startRefreshAllForUser(userId) {
      const runningJob = Array.from(userRefreshJobs.values()).find(
        (job) => Number(job.userId) === Number(userId) && job.status === "running"
      );
      if (runningJob) {
        return summarizeUserRefreshJob(runningJob);
      }

      const job = {
        id: String(nextUserRefreshJobId++),
        userId,
        status: "running",
        total: 0,
        processed: 0,
        results: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: ""
      };
      userRefreshJobs.set(job.id, job);
      void runUserRefreshJob(job);
      return summarizeUserRefreshJob(job);
    },
    getRefreshAllForUserJob(userId, jobId) {
      const job = userRefreshJobs.get(String(jobId || ""));
      if (!job || Number(job.userId) !== Number(userId)) {
        throw notFound("刷新任务不存在", { code: "refresh_job_not_found" });
      }
      return summarizeUserRefreshJob(job);
    },
    removeFeed(userId, feedId) {
      store.unlinkUserFeed(userId, feedId);
      pruneFeedItems(feedId);
      store.deleteOrphanFeeds();
    },
    async reclassifyFeed(feedId, options = {}) {
      return reclassifyOne(feedId, options);
    },
    async reclassifyFeeds(options = {}) {
      const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
      const feeds = store.listAdminFeeds().slice(0, limit);
      const results = [];
      for (const feed of feeds) {
        results.push(await reclassifyOne(feed.id, options));
      }
      return {
        updatedCount: results.length,
        results
      };
    },
    getItemPreview,
    getItemContent,
    getItemPageContent,
    setReadState,
    pruneFeedsForUser(userId) {
      let itemsDeleted = 0;
      let feedsProcessed = 0;
      for (const feed of store.listUserFeeds(userId)) {
        itemsDeleted += pruneFeedItems(feed.feed_id);
        feedsProcessed += 1;
      }
      return { feedsProcessed, itemsDeleted };
    },
    hydrateItemContent,
    hydrateItemPageContent,
    pruneAllFeeds() {
      let itemsDeleted = 0;
      let feedsProcessed = 0;
      for (const feed of store.listGlobalFeeds()) {
        itemsDeleted += pruneFeedItems(feed.id);
        feedsProcessed += 1;
      }
      return { feedsProcessed, itemsDeleted };
    },
    async refreshAllGlobalFeeds() {
      const feeds = store.listRefreshableFeeds();
      for (const feed of feeds) {
        try {
          await this.refreshGlobalFeed(feed.id);
        } catch (error) {
          console.error(`Refresh failed for feed ${feed.id}:`, error.message);
        }
      }
    }
  };
}
