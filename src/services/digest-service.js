import { badRequest, forbidden, notFound } from "../lib/errors.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIGEST_INPUT_LIMITS = {
  maxItems: 30,
  maxCharsPerItem: 300,
  maxTotalChars: 6000,
  inputMode: "title_summary"
};
const digestInputModes = new Set(["title", "title_summary", "title_summary_body"]);

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizeEmails(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,;\n]/);
  const emails = [...new Set(source.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 10) {
    throw badRequest("单条规则最多 10 个接收邮箱", { code: "digest_email_limit" });
  }
  for (const email of emails) {
    if (!emailPattern.test(email)) {
      throw badRequest(`邮箱格式无效: ${email}`, { code: "invalid_digest_email" });
    }
  }
  return emails;
}

function normalizeSendTime(value) {
  const sendTime = String(value || "09:00").trim();
  if (!/^\d{2}:\d{2}$/.test(sendTime)) {
    throw badRequest("发送时间格式应为 HH:mm", { code: "invalid_digest_send_time" });
  }
  const [hour, minute] = sendTime.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throw badRequest("发送时间格式应为 HH:mm", { code: "invalid_digest_send_time" });
  }
  return sendTime;
}

function normalizeRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isEnabled: Boolean(row.is_enabled),
    sendTime: row.send_time,
    timezone: row.timezone,
    recipientEmails: parseJsonSafe(row.recipient_emails, []),
    aiSource: row.ai_source,
    prompt: row.prompt,
    lookbackHours: Number(row.lookback_hours || 24),
    unreadOnly: Boolean(row.unread_only),
    feedScope: row.feed_scope,
    feedIds: parseJsonSafe(row.feed_ids_json, []),
    category: row.category || "",
    lastSentDate: row.last_sent_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name || "",
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    emailTo: row.email_to,
    itemCount: row.item_count,
    content: row.content,
    error: row.error
  };
}

function localDateParts(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeMailUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : "";
  } catch (_error) {
    return "";
  }
}

function truncateText(value, maxChars) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (maxChars <= 0) return "";
  if (!normalized || normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeDigestInputSettings(settings = {}) {
  const maxItems = Math.max(
    1,
    Math.min(100, Number(settings.max_items ?? settings.maxItems ?? DIGEST_INPUT_LIMITS.maxItems) || DIGEST_INPUT_LIMITS.maxItems)
  );
  const maxCharsPerItem = Math.max(
    0,
    Math.min(2000, Number(settings.max_chars_per_item ?? settings.maxCharsPerItem ?? DIGEST_INPUT_LIMITS.maxCharsPerItem) || DIGEST_INPUT_LIMITS.maxCharsPerItem)
  );
  const maxTotalChars = Math.max(
    500,
    Math.min(30000, Number(settings.max_total_chars ?? settings.maxTotalChars ?? DIGEST_INPUT_LIMITS.maxTotalChars) || DIGEST_INPUT_LIMITS.maxTotalChars)
  );
  const inputMode = digestInputModes.has(String(settings.input_mode ?? settings.inputMode ?? ""))
    ? String(settings.input_mode ?? settings.inputMode)
    : DIGEST_INPUT_LIMITS.inputMode;
  return {
    maxItems,
    maxCharsPerItem,
    maxTotalChars,
    inputMode
  };
}

function getDigestItemBody(item, inputMode) {
  if (inputMode === "title") return "";
  if (inputMode === "title_summary") return item.summary || "";
  return item.summary || item.content_text || "";
}

export function buildDigestSource(items, limits = DIGEST_INPUT_LIMITS) {
  const normalizedLimits = normalizeDigestInputSettings(limits);
  const selectedItems = [];
  let totalChars = 0;

  for (const item of items.slice(0, normalizedLimits.maxItems)) {
    const body = truncateText(getDigestItemBody(item, normalizedLimits.inputMode), normalizedLimits.maxCharsPerItem);
    const block = [
      `${selectedItems.length + 1}. [${item.feed_title || "未知订阅源"}] ${item.title || "未命名文章"}`,
      body,
      item.link || ""
    ].filter(Boolean).join("\n");
    if (!block) continue;

    const separatorLength = selectedItems.length ? 2 : 0;
    if (totalChars + separatorLength + block.length > normalizedLimits.maxTotalChars) {
      const remaining = normalizedLimits.maxTotalChars - totalChars - separatorLength;
      if (remaining > 80) {
        selectedItems.push(block.slice(0, remaining));
        totalChars = normalizedLimits.maxTotalChars;
      }
      break;
    }

    selectedItems.push(block);
    totalChars += separatorLength + block.length;
  }

  return {
    source: selectedItems.length ? selectedItems.join("\n\n") : "过去 24 小时没有新的文章。",
    items: items.slice(0, selectedItems.length),
    sourceChars: selectedItems.length ? totalChars : 0,
    inputLimits: { ...normalizedLimits }
  };
}

function renderDigestHtml(content, items) {
  const itemLinks = items.slice(0, 20).map((item) => {
    const url = safeMailUrl(item.link);
    const title = escapeHtml(item.title || "未命名文章");
    const feedTitle = escapeHtml(item.feed_title || "未知订阅源");
    return url ? `<li><a href="${escapeHtml(url)}">${title}</a> · ${feedTitle}</li>` : `<li>${title} · ${feedTitle}</li>`;
  }).join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#18202f">
    <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(content)}</pre>
    ${itemLinks ? `<hr><ul>${itemLinks}</ul>` : ""}
  </div>`;
}

export function createDigestService({ store, accountService, ai, mailService, config }) {
  let timer = null;
  let running = false;

  function assertDigestEntitlement(user) {
    const account = accountService.getAccount(user);
    if (!account.features.digest) {
      throw forbidden("当前套餐不支持 AI 总结简报", { code: "digest_unavailable" });
    }
    if (!account.features.emailDigest) {
      throw forbidden("当前套餐不支持邮件订阅简报", { code: "email_digest_unavailable" });
    }
    return account;
  }

  function getDigestInputSettings() {
    const digestSettings = store.listSettings().reduce((acc, row) => {
      if (row.category === "digest") acc[row.key] = row.value;
      return acc;
    }, {});
    return normalizeDigestInputSettings(digestSettings);
  }

  function normalizePayload(user, payload = {}, existing = null) {
    const account = assertDigestEntitlement(user);
    const feedScope = String(payload.feedScope ?? payload.feed_scope ?? existing?.feed_scope ?? "all").trim();
    if (!["all", "selected", "category"].includes(feedScope)) {
      throw badRequest("订阅源范围无效", { code: "invalid_digest_feed_scope" });
    }
    const feedIds = [...new Set((payload.feedIds ?? payload.feed_ids ?? parseJsonSafe(existing?.feed_ids_json, []))
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0))];
    if (feedScope === "selected" && !feedIds.length) {
      throw badRequest("请选择订阅源", { code: "digest_feed_required" });
    }
    const validFeedIds = feedIds.length ? store.listUserFeedIdsByFeedIds(user.id, feedIds) : [];
    if (feedScope === "selected" && validFeedIds.length !== feedIds.length) {
      throw forbidden("订阅源不属于当前用户", { code: "digest_feed_forbidden" });
    }
    const emails = normalizeEmails(payload.recipientEmails ?? payload.recipient_emails ?? parseJsonSafe(existing?.recipient_emails, []));
    const lookbackHours = Number(payload.lookbackHours ?? payload.lookback_hours ?? existing?.lookback_hours ?? 24);
    return {
      userId: user.id,
      name: String(payload.name ?? existing?.name ?? "每日简报").trim().slice(0, 80) || "每日简报",
      isEnabled: payload.isEnabled ?? payload.is_enabled ?? existing?.is_enabled ?? true ? 1 : 0,
      sendTime: normalizeSendTime(payload.sendTime ?? payload.send_time ?? existing?.send_time ?? "09:00"),
      timezone: String(payload.timezone ?? existing?.timezone ?? "Asia/Shanghai").trim().slice(0, 80) || "Asia/Shanghai",
      recipientEmails: JSON.stringify(emails),
      aiSource: ["system", "user"].includes(String(payload.aiSource ?? payload.ai_source ?? existing?.ai_source ?? "system"))
        ? String(payload.aiSource ?? payload.ai_source ?? existing?.ai_source ?? "system")
        : "system",
      prompt: String(payload.prompt ?? existing?.prompt ?? "").trim().slice(0, 4000),
      lookbackHours: Number.isFinite(lookbackHours) && lookbackHours > 0 ? Math.max(1, Math.min(168, Math.floor(lookbackHours))) : 24,
      unreadOnly: payload.unreadOnly ?? payload.unread_only ?? existing?.unread_only ?? false ? 1 : 0,
      feedScope,
      feedIdsJson: JSON.stringify(validFeedIds),
      category: feedScope === "category" ? String(payload.category ?? existing?.category ?? "").trim().slice(0, 40) : null,
      account
    };
  }

  function listRules(user) {
    assertDigestEntitlement(user);
    return {
      account: accountService.getAccount(user),
      rules: store.listDigestRulesByUser(user.id).map(normalizeRule),
      runs: store.listDigestRunsByUser(user.id, 20).map(normalizeRun),
      mail: mailService.getConfigStatus(),
      inputSettings: getDigestInputSettings()
    };
  }

  async function sendRuleNow(ruleRow, user, options = {}) {
    const rule = normalizeRule(ruleRow);
    const account = assertDigestEntitlement(user);
    const feedIds = rule.feedScope === "selected" ? rule.feedIds : [];
    const category = rule.feedScope === "category" ? rule.category : "";
    const inputSettings = getDigestInputSettings();
    const items = store.listDigestItems(user.id, {
      feedIds,
      category,
      since: new Date(Date.now() - Math.max(1, Number(rule.lookbackHours || 24)) * 60 * 60 * 1000).toISOString(),
      unreadOnly: rule.unreadOnly,
      limit: inputSettings.maxItems
    });
    const digestSource = buildDigestSource(items, inputSettings);
    const run = store.createDigestRun({
      ruleId: rule.id,
      userId: user.id,
      status: "running",
      emailTo: rule.recipientEmails.join(", "),
      itemCount: digestSource.items.length,
      detailsJson: JSON.stringify({
        inputLimits: digestSource.inputLimits,
        sourceChars: digestSource.sourceChars
      })
    });
    try {
      const aiRuntimes = accountService.getEffectiveAiRuntimes(rule.aiSource === "user" ? user.id : 0);
      const userPrompt = rule.prompt || "请用中文生成一份约 500 字的 RSS 每日简报，合并同类信息，突出重点、来源和可行动的结论。";
      const digestErrors = [];
      let content = "";
      for (const runtime of aiRuntimes) {
        try {
          content = await ai.summarize(
            {
              ...runtime,
              summaryPrompt: `${userPrompt}\n要求：约 500 个中文字符，不要编造未提供的信息。`
            },
            digestSource.source
          );
          break;
        } catch (error) {
          digestErrors.push(`${runtime.label || runtime.source}: ${error?.message || String(error)}`);
        }
      }
      if (!content && digestErrors.length) {
        throw new Error(`AI 简报生成失败。详情：${digestErrors.join(" | ")}`);
      }
      if (!content) {
        throw new Error("AI 接口未配置");
      }
      if (rule.recipientEmails.length) {
        await mailService.sendMail({
          to: rule.recipientEmails,
          subject: `${rule.name} - ${localDateParts(rule.timezone).date}`,
          text: content,
          html: renderDigestHtml(content, digestSource.items)
        });
      }
      const sentDate = localDateParts(rule.timezone).date;
      store.markDigestRuleSent(rule.id, sentDate);
      return store.updateDigestRun({
        id: run.id,
        status: "success",
        finishedAt: new Date().toISOString(),
        itemCount: digestSource.items.length,
        content,
        detailsJson: JSON.stringify({
          planCode: account.plan.code,
          inputLimits: digestSource.inputLimits,
          sourceChars: digestSource.sourceChars
        })
      });
    } catch (error) {
      if (options.markAttemptedOnFailure) {
        store.markDigestRuleSent(rule.id, localDateParts(rule.timezone).date);
      }
      return store.updateDigestRun({
        id: run.id,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message
      });
    }
  }

  async function processDueRules() {
    if (running) return { skipped: true };
    running = true;
    try {
      const runs = [];
      for (const row of store.listEnabledDigestRules()) {
        const { date, time } = localDateParts(row.timezone);
        if (row.last_sent_date === date || time < row.send_time) continue;
        const user = store.getUserById(row.user_id);
        if (!user) continue;
        runs.push(await sendRuleNow(row, user, { markAttemptedOnFailure: true }));
      }
      return { processed: runs.length, runs };
    } finally {
      running = false;
    }
  }

  return {
    listRules,
    createRule(user, payload) {
      const normalized = normalizePayload(user, payload);
      if (store.countDigestRulesByUser(user.id) >= normalized.account.limits.digestRules) {
        throw forbidden("简报规则数量已达到当前套餐上限", { code: "digest_rule_limit_reached" });
      }
      return normalizeRule(store.createDigestRule(normalized));
    },
    updateRule(user, id, payload) {
      const existing = store.getDigestRuleById(id);
      if (!existing || Number(existing.user_id) !== Number(user.id)) {
        throw notFound("简报规则不存在", { code: "digest_rule_not_found" });
      }
      return normalizeRule(store.updateDigestRule({ id, ...normalizePayload(user, payload, existing) }));
    },
    deleteRule(user, id) {
      const deleted = store.deleteDigestRule(id, user.id);
      if (!deleted) {
        throw notFound("简报规则不存在", { code: "digest_rule_not_found" });
      }
      return { deleted: true };
    },
    async testRule(user, id) {
      const rule = store.getDigestRuleById(id);
      if (!rule || Number(rule.user_id) !== Number(user.id)) {
        throw notFound("简报规则不存在", { code: "digest_rule_not_found" });
      }
      return normalizeRun(await sendRuleNow(rule, user));
    },
    async processDueRules() {
      return processDueRules();
    },
    startSchedule() {
      if (timer || config.aiEnabled === false) return;
      timer = setInterval(() => {
        processDueRules().catch((error) => console.error("Digest schedule failed:", error.message));
      }, 60 * 1000);
      timer.unref?.();
    },
    stopSchedule() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async waitForIdle() {
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
}
