import express from "express";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import {
  expectObject,
  parseBoolean,
  parsePositiveInt,
  parseTrimmedString,
  parseUrl
} from "../lib/validation.js";

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function getOptionalTrimmedField(body, key, label, maxLength) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  if (body[key] === null) {
    return null;
  }
  return parseTrimmedString(body[key], label, { maxLength });
}

function getOptionalPositiveIntField(body, key, label, options = {}) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  return parsePositiveInt(body[key], label, { ...options, allowNull: true });
}

function getOptionalBooleanField(body, key, label, options = {}) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  return parseBoolean(body[key], label, { ...options, allowUndefined: true });
}

function getOptionalUrlField(body, key, label) {
  if (!hasOwn(body, key)) {
    return undefined;
  }
  if (body[key] === null || body[key] === "") {
    return null;
  }
  return parseUrl(body[key], label);
}

export function createFeedRouter({ feedService, config }) {
  const router = express.Router();
  const parseFeedId = (value) => parsePositiveInt(value, "订阅源 ID");
  const feedWriteLimiter = createRateLimiter({
    name: "feed-write",
    windowMs: config.rateLimitFeedWriteWindowMs,
    max: config.rateLimitFeedWriteMax,
    code: "feed_rate_limited",
    message: "订阅源操作过于频繁，请稍后再试"
  });

  router.get("/", route(async (req, res) => {
    const skipImmediateTranslations = req.query.skipImmediateTranslations === undefined
      ? false
      : parseBoolean(req.query.skipImmediateTranslations, "跳过即时翻译");
    res.json(await feedService.listFeeds(req.auth.user.id, { skipImmediateTranslations }));
  }));

  router.post("/", feedWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = await feedService.addFeed(req.auth.user.id, {
      title: parseTrimmedString(body.title, "订阅源标题", { maxLength: 200 }),
      url: parseUrl(body.url, "Feed URL"),
      isPublic: body.isPublic === false ? false : true
    });
    res.status(201).json(result);
  }));

  router.post("/import", feedWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = await feedService.importFeeds(
      req.auth.user.id,
      parseTrimmedString(body.content, "订阅源内容", { required: true, maxLength: 2 * 1024 * 1024 })
    );
    res.status(201).json(result);
  }));

  router.get("/export", (req, res) => {
    const format = String(req.query?.format || "opml").toLowerCase() === "json" ? "json" : "opml";
    const content = feedService.exportFeeds(req.auth.user.id, format);
    const extension = format === "json" ? "json" : "opml";
    const contentType = format === "json" ? "application/json; charset=utf-8" : "text/x-opml; charset=utf-8";
    res.setHeader("content-type", contentType);
    res.setHeader("content-disposition", `attachment; filename="z7rss-feeds.${extension}"`);
    res.send(content);
  });

  router.post("/:feedId/rename", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(
      feedService.updateFeedTitleForUser(
        req.auth.user.id,
        parseFeedId(req.params.feedId),
        parseTrimmedString(body.title, "订阅源标题", { maxLength: 200 })
      )
    );
  }));

  router.post("/:feedId/preferences", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const payload = {};
    const baseFields = {
      customTitle: getOptionalTrimmedField(body, "customTitle", "订阅源标题", 200),
      category: getOptionalTrimmedField(body, "category", "分类", 40),
      isArchived: getOptionalBooleanField(body, "isArchived", "归档状态"),
      isCollapsed: getOptionalBooleanField(body, "isCollapsed", "折叠状态"),
      isPublic: getOptionalBooleanField(body, "isPublic", "公开到广场"),
      targetLanguage: getOptionalTrimmedField(body, "targetLanguage", "目标语言", 32),
      autoTranslate: getOptionalBooleanField(body, "autoTranslate", "自动翻译", { allowNull: true }),
      displayTranslated: getOptionalBooleanField(body, "displayTranslated", "显示译文", { allowNull: true }),
      translationMode: getOptionalTrimmedField(body, "translationMode", "翻译范围", 16)
    };

    for (const [key, value] of Object.entries(baseFields)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }

    const optionalFetchFields = {
      fetchRequestProfile: getOptionalTrimmedField(body, "fetchRequestProfile", "抓取请求模式", 16),
      fetchFeedFormat: getOptionalTrimmedField(body, "fetchFeedFormat", "抓取返回格式", 16),
      fetchTimeoutMs: getOptionalPositiveIntField(body, "fetchTimeoutMs", "抓取超时", { min: 1000, max: 120000 }),
      fetchFeedUrl: getOptionalUrlField(body, "fetchFeedUrl", "备用 Feed 地址"),
      fetchLoginUrl: getOptionalTrimmedField(body, "fetchLoginUrl", "登录地址", 1000),
      fetchUsername: getOptionalTrimmedField(body, "fetchUsername", "登录账号", 320),
      fetchPassword: getOptionalTrimmedField(body, "fetchPassword", "登录密码", 4000),
      fetchUsernameField: getOptionalTrimmedField(body, "fetchUsernameField", "账号字段名", 120),
      fetchPasswordField: getOptionalTrimmedField(body, "fetchPasswordField", "密码字段名", 120),
      fetchCookie: getOptionalTrimmedField(body, "fetchCookie", "Cookie", 20000),
      fetchArticleSelector: getOptionalTrimmedField(body, "fetchArticleSelector", "正文选择器", 500),
      fetchPageSelector: getOptionalTrimmedField(body, "fetchPageSelector", "网页选择器", 500),
      fetchJsonItemsPath: getOptionalTrimmedField(body, "fetchJsonItemsPath", "JSON 列表路径", 240),
      fetchJsonTitlePath: getOptionalTrimmedField(body, "fetchJsonTitlePath", "JSON 标题路径", 240),
      fetchJsonLinkPath: getOptionalTrimmedField(body, "fetchJsonLinkPath", "JSON 链接路径", 240),
      fetchJsonDatePath: getOptionalTrimmedField(body, "fetchJsonDatePath", "JSON 日期路径", 240),
      fetchJsonSummaryPath: getOptionalTrimmedField(body, "fetchJsonSummaryPath", "JSON 摘要路径", 240),
      fetchJsonContentPath: getOptionalTrimmedField(body, "fetchJsonContentPath", "JSON 正文路径", 240)
    };

    for (const [key, value] of Object.entries(optionalFetchFields)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }

    res.json(
      feedService.updateFeedPreferencesForUser(req.auth.user.id, parseFeedId(req.params.feedId), payload)
    );
  }));

  router.delete("/:feedId", (req, res) => {
    feedService.removeFeed(req.auth.user.id, parseFeedId(req.params.feedId));
    res.status(204).end();
  });

  router.post("/:feedId/refresh", feedWriteLimiter, route(async (req, res) => {
    const result = await feedService.refreshFeedForUser(req.auth.user.id, parseFeedId(req.params.feedId));
    res.json(result);
  }));

  router.post("/refresh-all", feedWriteLimiter, route(async (req, res) => {
    res.status(202).json(feedService.startRefreshAllForUser(req.auth.user.id));
  }));

  router.get("/refresh-all/:jobId", route(async (req, res) => {
    res.json(feedService.getRefreshAllForUserJob(req.auth.user.id, req.params.jobId));
  }));

  return router;
}
