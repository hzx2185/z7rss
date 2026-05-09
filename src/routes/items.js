import express from "express";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import {
  expectObject,
  parseBoolean,
  parseEnum,
  parseIntegerArray,
  parseIsoDateTime,
  parsePositiveInt
} from "../lib/validation.js";

export function createItemRouter({ itemService, config }) {
  const router = express.Router();
  const parseItemId = (value) => parsePositiveInt(value, "文章 ID");
  const parseFilter = (value) =>
    parseEnum(value ?? "all", "筛选条件", ["all", "read", "unread", "favorite"]);
  const aiLimiter = createRateLimiter({
    name: "item-ai",
    windowMs: config.rateLimitAiWindowMs,
    max: config.rateLimitAiMax,
    code: "ai_rate_limited",
    message: "翻译或总结请求过于频繁，请稍后再试"
  });

  router.get("/", route(async (req, res) => {
    const feedId = req.query.feedId === undefined ? null : parsePositiveInt(req.query.feedId, "订阅源 ID", { allowNull: true });
    const limit = req.query.limit === undefined ? 20 : parsePositiveInt(req.query.limit, "分页大小", { min: 1, max: 200 });
    const page = req.query.page === undefined ? 1 : parsePositiveInt(req.query.page, "页码", { min: 1, max: 100000 });
    const filter = parseFilter(req.query.filter);
    const publishedSince = req.query.publishedSince
      ? parseIsoDateTime(req.query.publishedSince, "发布时间", { allowNull: true })
      : null;
    const skipImmediateTranslations = req.query.skipImmediateTranslations === undefined
      ? false
      : parseBoolean(req.query.skipImmediateTranslations, "跳过即时翻译");
    const includeTotal = req.query.includeTotal === undefined
      ? true
      : parseBoolean(req.query.includeTotal, "包含总数");

    res.json(await itemService.listItems(req.auth.user.id, feedId, limit, {
      page,
      filter,
      publishedSince,
      skipImmediateTranslations,
      includeTotal
    }));
  }));

  router.get("/counts", (req, res) => {
    res.json(
      itemService.getItemCounts(req.auth.user.id, {
        todaySince: req.query.todaySince ? String(req.query.todaySince) : null
      })
    );
  });

  router.post("/read-state/bulk", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = await itemService.setReadStateBulk(req.auth.user.id, {
      itemIds: parseIntegerArray(body.itemIds, "文章 ID 列表", { maxItems: 5000 }),
      isRead: body.isRead === undefined ? true : parseBoolean(body.isRead, "已读状态"),
      feedId: body.feedId === undefined || body.feedId === null
        ? null
        : parsePositiveInt(body.feedId, "订阅源 ID", { allowNull: true }),
      filter: parseFilter(body.filter || "all"),
      publishedSince: body.publishedSince
        ? parseIsoDateTime(body.publishedSince, "发布时间", { allowNull: true })
        : null,
      olderThanDays: body.olderThanDays === undefined || body.olderThanDays === null
        ? null
        : parsePositiveInt(body.olderThanDays, "天数", { min: 1, max: 3650, allowNull: true })
    });
    res.json(result);
  }));

  router.get("/:id", route(async (req, res) => {
    const item = await itemService.getItemPreview(req.auth.user, parseItemId(req.params.id));
    res.json(item);
  }));

  router.get("/:id/content", route(async (req, res) => {
    const item = await itemService.getItemContent(req.auth.user, parseItemId(req.params.id));
    res.json(item);
  }));

  router.get("/:id/page", route(async (req, res) => {
    const item = await itemService.getItemPageContent(req.auth.user, parseItemId(req.params.id));
    res.json(item);
  }));

  router.post("/:id/read-state", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const item = await itemService.setReadState(
      req.auth.user.id,
      parseItemId(req.params.id),
      parseBoolean(body.isRead, "已读状态")
    );
    res.json(item);
  }));

  router.post("/:id/favorite-state", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const item = await itemService.setFavoriteState(
      req.auth.user.id,
      parseItemId(req.params.id),
      parseBoolean(body.isFavorited, "收藏状态")
    );
    res.json(item);
  }));

  router.post("/:id/translate", aiLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const translationMode = body.translationMode === undefined && body.translation_mode === undefined
      ? null
      : parseEnum(body.translationMode ?? body.translation_mode, "翻译范围", ["title", "full"]);
    res.json(await itemService.translateItem(req.auth.user, parseItemId(req.params.id), { translationMode }));
  }));

  router.post("/:id/summarize", aiLimiter, route(async (req, res) => {
    res.json(await itemService.summarizeItem(req.auth.user, parseItemId(req.params.id)));
  }));

  return router;
}
