import express from "express";
import { getRequestIp } from "../lib/request.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import {
  expectObject,
  parseBoolean,
  parseEnum,
  parseHostname,
  parseIpAddress,
  parseIsoDateTime,
  parsePassword,
  parsePositiveInt,
  parseTrimmedString
} from "../lib/validation.js";

export function createAdminRouter({ adminService, aiConfigService, config }) {
  const router = express.Router();
  const parseUserId = (value) => parsePositiveInt(value, "用户 ID");
  const parsePlanCode = (value) => parseTrimmedString(value, "套餐代码", { required: true, maxLength: 32 }).toLowerCase();
  const getAuditContext = (req) => ({
    actor: req.auth.user,
    requestIp: getRequestIp(req)
  });
  const aiLimiter = createRateLimiter({
    name: "admin-ai",
    windowMs: config.rateLimitAiWindowMs,
    max: config.rateLimitAiMax,
    code: "ai_rate_limited",
    message: "AI 请求过于频繁，请稍后再试"
  });

  router.get("/dashboard", (_req, res) => {
    res.json(adminService.getDashboard());
  });

  router.post("/refresh", route(async (req, res) => {
    const result = adminService.triggerGlobalRefresh(getAuditContext(req));
    res.status(result.started ? 202 : 200).json(result);
  }));

  router.post("/feeds/reclassify", aiLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(await adminService.reclassifyFeeds(getAuditContext(req), {
      useAi: body.useAi === undefined ? true : parseBoolean(body.useAi, "AI 分类"),
      limit: body.limit === undefined ? 200 : parsePositiveInt(body.limit, "分类数量", { min: 1, max: 500 })
    }));
  }));

  router.post("/feeds/:feedId/reclassify", aiLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(await adminService.reclassifyFeed(parsePositiveInt(req.params.feedId, "订阅源 ID"), getAuditContext(req), {
      useAi: body.useAi === undefined ? true : parseBoolean(body.useAi, "AI 分类")
    }));
  }));

  router.post("/maintenance", route(async (req, res) => {
    const result = adminService.triggerMaintenance(getAuditContext(req));
    res.status(result.started ? 202 : 200).json(result);
  }));

  router.get("/database", (_req, res) => {
    res.json(adminService.getDatabase());
  });

  router.post("/database/cleanup", route(async (req, res) => {
    const result = adminService.triggerMaintenance(getAuditContext(req));
    res.status(result.started ? 202 : 200).json(result);
  }));

  router.post("/database/optimize", route(async (req, res) => {
    res.json(adminService.optimizeDatabase(getAuditContext(req)));
  }));

  router.post("/database/vacuum", route(async (req, res) => {
    res.json(adminService.vacuumDatabase(getAuditContext(req)));
  }));

  router.get("/database/backup", route(async (req, res) => {
    const backup = await adminService.createDatabaseBackup(getAuditContext(req));
    res.download(backup.path, backup.filename);
  }));

  router.get("/database/backups/:filename", route((req, res) => {
    const backup = adminService.getDatabaseBackup(req.params.filename);
    res.download(backup.path, backup.filename);
  }));

  router.delete("/database/backups/:filename", route((req, res) => {
    res.json(adminService.deleteDatabaseBackup(req.params.filename, getAuditContext(req)));
  }));

  router.post("/users/:userId", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const user = adminService.updateUser({
      userId: parseUserId(req.params.userId),
      isAdmin: body.isAdmin === undefined ? undefined : parseBoolean(body.isAdmin, "管理员状态", { allowUndefined: true }),
      status: body.status === undefined ? undefined : parseTrimmedString(body.status, "用户状态", { required: true, maxLength: 32 })
    }, getAuditContext(req));
    res.json(user);
  }));

  router.delete("/users/:userId", route(async (req, res) => {
    res.json(adminService.deleteUser(parseUserId(req.params.userId), getAuditContext(req)));
  }));

  router.get("/users/:userId/security", route(async (req, res) => {
    res.json(adminService.getUserSecurity(parseUserId(req.params.userId)));
  }));

  router.post("/users/:userId/password", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.resetUserPassword({
      userId: parseUserId(req.params.userId),
      newPassword: parsePassword(body.newPassword, "新密码"),
      revokeSessions: body.revokeSessions === undefined ? true : parseBoolean(body.revokeSessions, "注销活跃会话")
    }, getAuditContext(req)));
  }));

  router.post("/users/:userId/sessions/revoke", route(async (req, res) => {
    res.json(adminService.revokeUserSessions(parseUserId(req.params.userId), getAuditContext(req)));
  }));

  router.post("/users/:userId/sessions/:sessionId/revoke", route(async (req, res) => {
    res.json(adminService.revokeUserSession(
      parseUserId(req.params.userId),
      parsePositiveInt(req.params.sessionId, "会话 ID"),
      getAuditContext(req)
    ));
  }));

  router.get("/users/:userId/export", route((req, res) => {
    const data = adminService.exportUserData(parseUserId(req.params.userId));
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="z7rss-user-${req.params.userId}-export.json"`);
    res.json(data);
  }));

  router.post("/users/:userId/import", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.importUserData(parseUserId(req.params.userId), body, getAuditContext(req)));
  }));

  router.post("/users/:userId/subscription", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.updateUserSubscription({
      userId: parseUserId(req.params.userId),
      planCode: parsePlanCode(body.planCode),
      currentPeriodEnd: body.currentPeriodEnd ? parseIsoDateTime(body.currentPeriodEnd, "到期时间", { allowNull: true }) : null,
      status: body.status === undefined ? undefined : parseTrimmedString(body.status, "订阅状态", { required: true, maxLength: 32 })
    }, getAuditContext(req)));
  }));

  router.post("/plans/:planCode", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.updatePlanSettings(parsePlanCode(req.params.planCode), body, getAuditContext(req)));
  }));

  router.post("/settings/:category", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const category = parseTrimmedString(req.params.category, "配置分类", { required: true, maxLength: 32 }).toLowerCase();
    if (category === "general") {
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(body, "site_name")) {
        payload.site_name = parseTrimmedString(body.site_name, "站点名称", { maxLength: 120 });
      }
      if (Object.prototype.hasOwnProperty.call(body, "site_domain")) {
        payload.site_domain = parseTrimmedString(body.site_domain, "站点域名", { maxLength: 255 });
      }
      res.json(adminService.setSettings(category, payload, getAuditContext(req)));
      return;
    }
    if (category === "mail") {
      res.json(adminService.setSettings(category, {
        from: parseTrimmedString(body.from, "发件人", { maxLength: 200 }),
        host: parseTrimmedString(body.host, "SMTP 主机", { maxLength: 255 }),
        port: parseTrimmedString(body.port, "SMTP 端口", { maxLength: 32 }),
        username: parseTrimmedString(body.username, "SMTP 用户", { maxLength: 255 }),
        password: parseTrimmedString(body.password, "SMTP 密码", { maxLength: 4000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "ai") {
      res.json(adminService.setSettings(category, {
        base_url: parseTrimmedString(body.base_url, "AI Base URL", { maxLength: 1000 }),
        api_key: parseTrimmedString(body.api_key, "AI Key", { maxLength: 4000 }),
        model: parseTrimmedString(body.model, "AI 模型", { maxLength: 200 }),
        translate_prompt: parseTrimmedString(body.translate_prompt, "翻译 Prompt", { maxLength: 8000 }),
        summary_prompt: parseTrimmedString(body.summary_prompt, "总结 Prompt", { maxLength: 8000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "digest") {
      res.json(adminService.setSettings(category, {
        input_mode: parseTrimmedString(body.input_mode, "简报输入策略", { maxLength: 32 }),
        max_items: parseTrimmedString(body.max_items, "简报文章数", { maxLength: 8 }),
        max_chars_per_item: parseTrimmedString(body.max_chars_per_item, "每篇字符数", { maxLength: 8 }),
        max_total_chars: parseTrimmedString(body.max_total_chars, "总输入字符数", { maxLength: 8 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "database_backup") {
      res.json(adminService.setSettings(category, {
        enabled: parseTrimmedString(body.enabled, "自动备份开关", { maxLength: 8 }),
        retention_days: parseTrimmedString(body.retention_days, "备份保留天数", { maxLength: 8 }),
        max_files: parseTrimmedString(body.max_files, "备份最大份数", { maxLength: 8 }),
        schedule_frequency: parseTrimmedString(body.schedule_frequency, "备份频率", { maxLength: 16 }),
        schedule_weekdays: parseTrimmedString(body.schedule_weekdays, "备份星期", { maxLength: 32 }),
        schedule_time: parseTrimmedString(body.schedule_time, "备份时间", { maxLength: 8 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "database_cleanup") {
      res.json(adminService.setSettings(category, {
        max_items_total: parseTrimmedString(body.max_items_total, "总文章保留数", { maxLength: 8 }),
        max_age_days: parseTrimmedString(body.max_age_days, "文章最多保留天数", { maxLength: 8 }),
        protect_favorites: parseTrimmedString(body.protect_favorites, "收藏文章保护", { maxLength: 8 }),
        protect_unread: parseTrimmedString(body.protect_unread, "未读文章保护", { maxLength: 8 }),
        min_keep_items: parseTrimmedString(body.min_keep_items, "至少保留文章数", { maxLength: 8 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "database_vacuum") {
      res.json(adminService.setSettings(category, {
        enabled: parseTrimmedString(body.enabled, "自动碎片整理开关", { maxLength: 8 }),
        interval_days: parseTrimmedString(body.interval_days, "碎片整理间隔天数", { maxLength: 8 }),
        schedule_time: parseTrimmedString(body.schedule_time, "碎片整理时间", { maxLength: 8 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "translation_google") {
      res.json(adminService.setSettings(category, {
        base_url: parseTrimmedString(body.base_url, "谷歌翻译接口地址", { maxLength: 1000 }),
        api_key: body.clear_api_key ? "__CLEAR__" : parseTrimmedString(body.api_key, "谷歌翻译 API Key", { maxLength: 4000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "translation_bing") {
      res.json(adminService.setSettings(category, {
        base_url: parseTrimmedString(body.base_url, "必应翻译 Base URL", { maxLength: 1000 }),
        api_key: body.clear_api_key ? "__CLEAR__" : parseTrimmedString(body.api_key, "必应翻译 API Key", { maxLength: 4000 }),
        region: parseTrimmedString(body.region, "必应翻译区域", { maxLength: 200 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "translation_deeplx") {
      res.json(adminService.setSettings(category, {
        base_url: parseTrimmedString(body.base_url, "DeepLX 接口地址", { maxLength: 2000 }),
        api_key: body.clear_api_key ? "__CLEAR__" : parseTrimmedString(body.api_key, "DeepLX API Key", { maxLength: 4000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "ai_provider_pool") {
      res.json(adminService.setSettings(category, {
        configs_secret: parseTrimmedString(body.configs ?? body.configs_secret ?? "[]", "AI 接口列表", { maxLength: 40000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "translation_provider_pool") {
      res.json(adminService.setSettings(category, {
        configs_secret: parseTrimmedString(body.configs ?? body.configs_secret ?? "[]", "翻译 API 列表", { maxLength: 40000 })
      }, getAuditContext(req)));
      return;
    }
    if (category === "translation") {
      res.json(adminService.setSettings(category, {
        provider: parseTrimmedString(body.provider, "默认翻译工具", { maxLength: 32 }),
        target_language: parseTrimmedString(body.target_language, "默认目标语言", { maxLength: 32 }),
        translation_mode: parseEnum(body.translation_mode ?? body.translationMode ?? "title", "默认翻译范围", ["title", "full"]),
        fallback_providers: parseTrimmedString(body.fallback_providers ?? body.fallbackProviders, "备用翻译顺序", { maxLength: 200 })
      }, getAuditContext(req)));
      return;
    }

    res.json(adminService.setSettings(category, body, getAuditContext(req)));
  }));

  router.post("/redeem-codes", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.status(201).json(adminService.createRedeemCode({
      code: parseTrimmedString(body.code, "兑换码", { required: true, maxLength: 64 }),
      planCode: parsePlanCode(body.planCode),
      maxUses: parsePositiveInt(body.maxUses ?? 1, "最大使用次数", { min: 1, max: 100000 }),
      expiresAt: body.expiresAt ? parseIsoDateTime(body.expiresAt, "到期时间", { allowNull: true }) : null,
      note: parseTrimmedString(body.note, "备注", { maxLength: 500 })
    }, getAuditContext(req)));
  }));

  router.post("/redeem-codes/:id", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.updateRedeemCode({
      id: parsePositiveInt(req.params.id, "兑换码 ID"),
      maxUses: parsePositiveInt(body.maxUses ?? 1, "最大使用次数", { min: 1, max: 100000 }),
      expiresAt: body.expiresAt ? parseIsoDateTime(body.expiresAt, "到期时间", { allowNull: true }) : null,
      note: parseTrimmedString(body.note, "备注", { maxLength: 500 }),
      isActive: parseBoolean(body.isActive, "启用状态")
    }, getAuditContext(req)));
  }));

  router.post("/plugins", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.upsertPlugin({
      code: parseTrimmedString(body.code, "插件代码", { required: true, maxLength: 64 }),
      name: parseTrimmedString(body.name, "插件名称", { required: true, maxLength: 120 }),
      description: parseTrimmedString(body.description, "插件描述", { required: true, maxLength: 500 }),
      config: body.config === undefined ? {} : expectObject(body.config, "插件配置"),
      isEnabled: parseBoolean(body.isEnabled, "启用状态")
    }, getAuditContext(req)));
  }));

  router.post("/content-rules", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.status(201).json(adminService.createContentRule({
      kind: parseTrimmedString(body.kind, "规则类型", { required: true, maxLength: 32 }),
      pattern: parseTrimmedString(body.pattern, "规则内容", { required: true, maxLength: 500 }),
      action: parseTrimmedString(body.action, "规则动作", { required: true, maxLength: 32 }),
      isActive: body.isActive === undefined ? true : parseBoolean(body.isActive, "启用状态")
    }, getAuditContext(req)));
  }));

  router.post("/content-rules/:id/toggle", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.toggleContentRule(
      parsePositiveInt(req.params.id, "规则 ID"),
      parseBoolean(body.isActive, "启用状态"),
      getAuditContext(req)
    ));
  }));

  router.post("/blocked-sites", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.setBlockedSite({
      domain: parseHostname(body.domain, "域名"),
      reason: parseTrimmedString(body.reason, "原因", { maxLength: 500 }),
      isActive: body.isActive === undefined ? true : parseBoolean(body.isActive, "启用状态")
    }, getAuditContext(req)));
  }));

  router.post("/blocked-ips", route(async (req, res) => {
    const body = expectObject(req.body || {});
    res.json(adminService.setBlockedIp({
      ip: parseIpAddress(body.ip, "IP"),
      reason: parseTrimmedString(body.reason, "原因", { maxLength: 500 }),
      isActive: body.isActive === undefined ? true : parseBoolean(body.isActive, "启用状态")
    }, getAuditContext(req)));
  }));

  router.post("/ai/test", aiLimiter, route(async (_req, res) => {
    res.json(await aiConfigService.testAi(0));
  }));

  router.post("/ai/test-runtime", aiLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const runtimeConfig = {
      baseUrl: parseTrimmedString(body.baseUrl, "Base URL", { maxLength: 2000 }),
      apiKey: parseTrimmedString(body.apiKey, "API Key", { maxLength: 4000 }),
      model: parseTrimmedString(body.model, "模型", { maxLength: 200 }),
      translatePrompt: parseTrimmedString(body.translatePrompt, "翻译提示词", { maxLength: 8000 }),
      summaryPrompt: parseTrimmedString(body.summaryPrompt, "总结提示词", { maxLength: 8000 })
    };
    const poolId = parseTrimmedString(body.id, "ID", { maxLength: 100 });
    res.json(await aiConfigService.testAiRuntime(runtimeConfig, poolId));
  }));

  router.post("/translation/test", aiLimiter, route(async (_req, res) => {
    res.json(await aiConfigService.testSystemTranslation());
  }));

  router.post("/translation/test-runtime", aiLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const runtimeConfig = {
      provider: parseTrimmedString(body.provider, "API 类型", { required: true, maxLength: 32 }),
      baseUrl: parseTrimmedString(body.baseUrl, "Base URL", { maxLength: 2000 }),
      apiKey: parseTrimmedString(body.apiKey, "API Key", { maxLength: 4000 }),
      region: parseTrimmedString(body.region, "Region", { maxLength: 200 }),
      targetLanguage: "zh-CN"
    };
    const poolId = parseTrimmedString(body.id, "ID", { maxLength: 100 });
    res.json(await aiConfigService.testTranslationRuntime(runtimeConfig, poolId));
  }));

  return router;
}
