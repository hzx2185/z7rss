import express from "express";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import { expectObject, parseBoolean, parseIntegerArray, parsePassword, parsePositiveInt, parseTrimmedString } from "../lib/validation.js";

export function createAccountRouter({ accountService, aiConfigService, authService, config, digestService, feedService, mailService, opmlBackupService }) {
  const router = express.Router();
  const hasOwn = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key);
  const aiLimiter = createRateLimiter({
    name: "account-ai",
    windowMs: config.rateLimitAiWindowMs,
    max: config.rateLimitAiMax,
    code: "ai_rate_limited",
    message: "AI 请求过于频繁，请稍后再试"
  });

  router.get("/preferences", (req, res) => {
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences: accountService.getUserPreferences(req.auth.user.id)
    });
  });

  router.get("/security", (req, res) => {
    res.json({
      sessions: authService.listSessions(req.auth.user.id, req.auth.session?.token || null)
    });
  });

  router.get("/digest-rules", route(async (req, res) => {
    res.json(digestService.listRules(req.auth.user));
  }));

  router.post("/digest-rules", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.status(201).json(digestService.createRule(req.auth.user, {
      name: parseTrimmedString(body.name, "规则名称", { maxLength: 80 }),
      isEnabled: body.isEnabled === undefined ? true : parseBoolean(body.isEnabled, "启用状态"),
      sendTime: parseTrimmedString(body.sendTime, "发送时间", { maxLength: 5 }) || "09:00",
      timezone: parseTrimmedString(body.timezone, "时区", { maxLength: 80 }) || "Asia/Shanghai",
      recipientEmails: body.recipientEmails,
      aiSource: parseTrimmedString(body.aiSource, "AI 来源", { maxLength: 32 }) || "system",
      prompt: parseTrimmedString(body.prompt, "提示词", { maxLength: 4000 }),
      lookbackHours: body.lookbackHours === undefined ? 24 : parsePositiveInt(body.lookbackHours, "文章时间范围", { min: 1, max: 168 }),
      unreadOnly: body.unreadOnly === undefined ? false : parseBoolean(body.unreadOnly, "仅未读"),
      feedScope: parseTrimmedString(body.feedScope, "订阅源范围", { maxLength: 32 }) || "all",
      feedIds: parseIntegerArray(body.feedIds, "订阅源", { maxItems: 200 }),
      category: parseTrimmedString(body.category, "分类", { maxLength: 40 })
    }));
  }));

  router.post("/digest-rules/:id", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const payload = {};
    if (hasOwn(body, "name")) payload.name = parseTrimmedString(body.name, "规则名称", { maxLength: 80 });
    if (hasOwn(body, "isEnabled")) payload.isEnabled = parseBoolean(body.isEnabled, "启用状态");
    if (hasOwn(body, "sendTime")) payload.sendTime = parseTrimmedString(body.sendTime, "发送时间", { maxLength: 5 });
    if (hasOwn(body, "timezone")) payload.timezone = parseTrimmedString(body.timezone, "时区", { maxLength: 80 });
    if (hasOwn(body, "recipientEmails")) payload.recipientEmails = body.recipientEmails;
    if (hasOwn(body, "aiSource")) payload.aiSource = parseTrimmedString(body.aiSource, "AI 来源", { maxLength: 32 });
    if (hasOwn(body, "prompt")) payload.prompt = parseTrimmedString(body.prompt, "提示词", { maxLength: 4000 });
    if (hasOwn(body, "lookbackHours")) payload.lookbackHours = parsePositiveInt(body.lookbackHours, "文章时间范围", { min: 1, max: 168 });
    if (hasOwn(body, "unreadOnly")) payload.unreadOnly = parseBoolean(body.unreadOnly, "仅未读");
    if (hasOwn(body, "feedScope")) payload.feedScope = parseTrimmedString(body.feedScope, "订阅源范围", { maxLength: 32 });
    if (hasOwn(body, "feedIds")) payload.feedIds = parseIntegerArray(body.feedIds, "订阅源", { maxItems: 200 });
    if (hasOwn(body, "category")) payload.category = parseTrimmedString(body.category, "分类", { maxLength: 40 });
    res.json(digestService.updateRule(req.auth.user, parsePositiveInt(req.params.id, "规则 ID"), payload));
  }));

  router.delete("/digest-rules/:id", route(async (req, res) => {
    res.json(digestService.deleteRule(req.auth.user, parsePositiveInt(req.params.id, "规则 ID")));
  }));

  router.post("/digest-rules/:id/test", aiLimiter, route(async (req, res) => {
    res.json(await digestService.testRule(req.auth.user, parsePositiveInt(req.params.id, "规则 ID")));
  }));

  router.post("/preferences/ai", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const preferences = accountService.updateUserAiSettings(req.auth.user, {
      baseUrl: parseTrimmedString(body.baseUrl, "AI Base URL", { maxLength: 1000 }),
      apiKey: parseTrimmedString(body.apiKey, "AI Key", { maxLength: 4000 }),
      model: parseTrimmedString(body.model, "AI 模型", { maxLength: 200 }),
      translatePrompt: parseTrimmedString(body.translatePrompt, "翻译 Prompt", { maxLength: 8000 }),
      summaryPrompt: parseTrimmedString(body.summaryPrompt, "总结 Prompt", { maxLength: 8000 })
    });
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences
    });
  }));

  router.post("/preferences/translation", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const preferences = accountService.updateUserTranslationSettings(req.auth.user, {
      provider: parseTrimmedString(body.provider, "翻译工具", { required: true, maxLength: 32 }),
      targetLanguage: parseTrimmedString(body.targetLanguage, "目标语言", { required: true, maxLength: 32 }),
      translationMode: parseTrimmedString(body.translationMode ?? body.translation_mode, "翻译范围", { maxLength: 32 }),
      autoTranslate: body.autoTranslate,
      displayTranslated: body.displayTranslated
    });
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences
    });
  }));

  router.post("/preferences/reader", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const preferences = accountService.updateUserReaderSettings(req.auth.user, {
      feedUnreadFilter: parseTrimmedString(body.feedUnreadFilter, "订阅源默认筛选", { required: true, maxLength: 32 }),
      itemFilter: parseTrimmedString(body.itemFilter, "文章列表默认筛选", { required: true, maxLength: 32 })
    });
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences
    });
  }));

  router.post("/preferences/translation-provider/:provider", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const preferences = accountService.updateUserTranslationProviderSettings(
      req.auth.user,
      parseTrimmedString(req.params.provider, "翻译工具", { required: true, maxLength: 32 }),
      {
        apiKey: parseTrimmedString(body.apiKey, "翻译 API Key", { maxLength: 4000 }),
        baseUrl: parseTrimmedString(body.baseUrl, "翻译 Base URL", { maxLength: 1000 }),
        region: parseTrimmedString(body.region, "翻译区域", { maxLength: 200 })
      }
    );
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences
    });
  }));

  router.post("/preferences/translation-provider/:provider/reset", route(async (req, res) => {
    const preferences = accountService.resetUserTranslationProviderSettings(
      req.auth.user,
      parseTrimmedString(req.params.provider, "翻译工具", { required: true, maxLength: 32 })
    );
    res.json({
      account: accountService.getAccount(req.auth.user),
      preferences
    });
  }));

  router.post("/preferences/ai/test", aiLimiter, route(async (req, res) => {
    const result = await aiConfigService.testAi(req.auth.user.id);
    res.json(result);
  }));

  router.post("/password", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = authService.changePassword({
      userId: req.auth.user.id,
      currentPassword: parsePassword(body.currentPassword, "当前密码", { minLength: 1 }),
      newPassword: parsePassword(body.newPassword, "新密码"),
      currentToken: req.auth.session?.token || null,
      revokeOtherSessions: body.revokeOtherSessions === undefined ? true : parseBoolean(body.revokeOtherSessions, "注销其他设备")
    });
    res.json(result);
  }));

  router.post("/sessions/revoke-others", route(async (req, res) => {
    res.json(authService.revokeOtherSessions(req.auth.user.id, req.auth.session?.token || null));
  }));

  router.post("/backup-opml", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const email = parseTrimmedString(body.email, "接收邮箱", { required: true, maxLength: 200 });
    const result = await opmlBackupService.sendBackupNow(req.auth.user.id, { email });
    res.json(result);
  }));

  router.get("/backup-opml/config", (req, res) => {
    res.json(opmlBackupService.getBackupConfig(req.auth.user.id));
  });

  router.post("/backup-opml/config", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const payload = {};
    if (hasOwn(body, "email")) payload.email = parseTrimmedString(body.email, "接收邮箱", { maxLength: 200 });
    if (hasOwn(body, "sendTime")) payload.sendTime = parseTrimmedString(body.sendTime, "发送时间", { maxLength: 5 });
    if (hasOwn(body, "enabled")) payload.enabled = parseBoolean(body.enabled, "启用定时备份");
    res.json(opmlBackupService.updateBackupConfig(req.auth.user.id, payload));
  }));

  return router;
}
