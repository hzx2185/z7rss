import * as cheerio from "cheerio";
import { badGateway, badRequest } from "../lib/errors.js";

const BUILTIN_PROTOCOL = "builtin:";
const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const ZHIHU_HOT_URL = "https://www.zhihu.com/hot";
const ZHIHU_HOT_API_URLS = [
  "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true",
  "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50"
];

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toIsoOrNull(value) {
  if (!value) return null;
  const parsed = Number(value);
  const date = Number.isFinite(parsed)
    ? new Date(parsed > 1e12 ? parsed : parsed * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSafeHttpUrl(value = "", fallbackBase = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = fallbackBase ? new URL(raw, fallbackBase) : new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function parseApiQuestionAnswerUrl(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/api\.zhihu\.com\/questions\/(\d+)(?:\/answers\/(\d+))?/i);
  if (!match) return "";
  return match[2]
    ? `https://www.zhihu.com/question/${match[1]}/answer/${match[2]}`
    : `https://www.zhihu.com/question/${match[1]}`;
}

function normalizeZhihuLink(rawUrl = "", entry = {}) {
  const direct = toSafeHttpUrl(rawUrl);
  if (direct) {
    return parseApiQuestionAnswerUrl(direct) || direct;
  }

  const target = entry.target || entry;
  const question = target.question || entry.question || {};
  const apiUrl = parseApiQuestionAnswerUrl(target.url || question.url || "");
  if (apiUrl) return apiUrl;

  const questionId = question.id || target.question_id || target.questionId;
  const answerId = target.id || entry.answer_id || entry.answerId;
  if (questionId && answerId && String(target.type || "").toLowerCase().includes("answer")) {
    return `https://www.zhihu.com/question/${questionId}/answer/${answerId}`;
  }
  if (questionId) {
    return `https://www.zhihu.com/question/${questionId}`;
  }
  if (target.id && String(target.type || "").toLowerCase().includes("question")) {
    return `https://www.zhihu.com/question/${target.id}`;
  }

  return ZHIHU_HOT_URL;
}

function coerceEntryTitle(entry = {}) {
  const target = entry.target || entry;
  return normalizeText(
    entry.title ||
      target.title ||
      target.question?.title ||
      entry.question?.title ||
      target.excerpt_title ||
      target.name ||
      "知乎热榜"
  );
}

function coerceEntrySummary(entry = {}) {
  const target = entry.target || entry;
  return normalizeText(
    entry.excerpt ||
      entry.description ||
      target.excerpt ||
      target.excerpt_new ||
      target.summary ||
      target.description ||
      ""
  );
}

function mapZhihuHotEntry(entry = {}, index = 0) {
  const target = entry.target || entry;
  const title = coerceEntryTitle(entry);
  const link = normalizeZhihuLink(target.url || entry.url || target.question?.url || "", entry);
  if (!title || !link) return null;
  const summary = coerceEntrySummary(entry);
  const contentText = summary;
  const contentHtml = summary ? `<p>${escapeHtml(summary)}</p>` : "";
  const id = target.id || entry.id || link || `zhihu-hot-${index}`;
  const publishedAt = toIsoOrNull(target.updated_time || target.created_time || target.updated || target.created || entry.updated_time || entry.created_time) || new Date().toISOString();

  return {
    guid: `builtin:zhihu:hot:${id}`,
    title,
    link,
    author: normalizeText(target.author?.name || entry.author?.name || "知乎"),
    summary,
    contentHtml,
    contentText,
    publishedAt
  };
}

function dedupeItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item?.title) continue;
    const key = item.link || item.guid || item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractBalancedJson(source = "", startIndex = 0) {
  const text = String(source || "");
  let index = text.indexOf("{", startIndex);
  if (index < 0) return "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(text.indexOf("{", startIndex), index + 1);
      }
    }
  }
  return "";
}

function parseJsonCandidate(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function collectZhihuHotEntries(value, items = [], visited = new Set(), depth = 0) {
  if (!value || depth > 8 || items.length >= 80) return items;
  if (typeof value !== "object") return items;
  if (visited.has(value)) return items;
  visited.add(value);

  if (Array.isArray(value)) {
    const mapped = value.map((entry, index) => mapZhihuHotEntry(entry, index)).filter(Boolean);
    if (mapped.length >= 3) {
      items.push(...mapped);
    }
    for (const entry of value) collectZhihuHotEntries(entry, items, visited, depth + 1);
    return items;
  }

  const single = mapZhihuHotEntry(value, items.length);
  if (single && (value.target || value.detail_text || value.hot_value || value.metrics_area)) {
    items.push(single);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!nested || typeof nested !== "object") continue;
    if (!/hot|top|list|data|entities|question|answer|target|initial/i.test(key)) continue;
    collectZhihuHotEntries(nested, items, visited, depth + 1);
  }
  return items;
}

function extractZhihuHotItemsFromHtml(html = "") {
  const $ = cheerio.load(html);
  const payloads = [];
  $("script").each((_, element) => {
    const text = $(element).html() || "";
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/^\s*[\[{]/.test(trimmed)) {
      const parsed = parseJsonCandidate(trimmed);
      if (parsed) payloads.push(parsed);
    }
    for (const marker of ["window.__INITIAL_STATE__", "window.__NEXT_DATA__", "window.__INITIAL_DATA__"]) {
      const markerIndex = text.indexOf(marker);
      if (markerIndex < 0) continue;
      const parsed = parseJsonCandidate(extractBalancedJson(text, markerIndex));
      if (parsed) payloads.push(parsed);
    }
  });

  return dedupeItems(payloads.flatMap((payload) => collectZhihuHotEntries(payload, []))).slice(0, 50);
}

async function requestText(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.browserUserAgent || options.userAgent || DEFAULT_BROWSER_USER_AGENT,
      accept: options.accept || "application/json,text/html;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      referer: ZHIHU_HOT_URL,
      ...(options.cookie ? { cookie: String(options.cookie || "").trim() } : {})
    },
    signal: AbortSignal.timeout(options.timeoutMs || 15000)
  });
  const text = await response.text();
  if (!response.ok) {
    const authHint = response.status === 401 || response.status === 403
      ? options.cookie
        ? "，知乎拒绝了当前 Cookie，请更新后台模板共享 Cookie"
        : "，请在后台知乎热榜模板配置共享 Cookie"
      : "";
    throw badGateway(`内置知乎热榜请求失败: ${response.status} ${response.statusText}${authHint}`, {
      code: "builtin_feed_request_failed"
    });
  }
  return text;
}

async function fetchZhihuHotFeed(options = {}) {
  const errors = [];
  for (const apiUrl of ZHIHU_HOT_API_URLS) {
    try {
      const text = await requestText(apiUrl, { ...options, accept: "application/json,*/*;q=0.8" });
      const payload = JSON.parse(text);
      const items = dedupeItems(collectZhihuHotEntries(payload?.data || payload, [])).slice(0, 50);
      if (items.length) {
        return buildZhihuHotFeed(items);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  try {
    const html = await requestText(ZHIHU_HOT_URL, { ...options, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" });
    const items = extractZhihuHotItemsFromHtml(html);
    if (items.length) {
      return buildZhihuHotFeed(items);
    }
  } catch (error) {
    errors.push(error.message);
  }

  throw badGateway(`内置知乎热榜暂时不可用${errors.length ? `：${errors.slice(0, 2).join("；")}` : ""}`, {
    code: "builtin_feed_unavailable"
  });
}

function buildZhihuHotFeed(items) {
  return {
    meta: {
      title: "知乎热榜",
      description: "知乎当前热门内容",
      siteUrl: ZHIHU_HOT_URL
    },
    items
  };
}

export function isBuiltinFeedUrl(value = "") {
  try {
    return new URL(String(value || "").trim()).protocol === BUILTIN_PROTOCOL;
  } catch (_error) {
    return false;
  }
}

export function normalizeBuiltinFeedUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== BUILTIN_PROTOCOL) return "";
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (host === "zhihu" && path === "hot") return "builtin://zhihu/hot";
  } catch (_error) {
    return "";
  }
  return "";
}

export function matchBuiltinFeedInput(inputUrl = "") {
  let url;
  try {
    url = new URL(String(inputUrl || "").trim());
  } catch (_error) {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (host === "zhihu.com" && (!path || path === "hot")) {
    return {
      url: "builtin://zhihu/hot",
      source: "builtin",
      confidence: "high",
      title: "知乎热榜"
    };
  }
  return null;
}

export async function fetchBuiltinFeed(feedUrl, options = {}) {
  const normalized = normalizeBuiltinFeedUrl(feedUrl);
  if (normalized === "builtin://zhihu/hot") {
    return fetchZhihuHotFeed(options);
  }
  throw badRequest("Unsupported builtin feed", { code: "unsupported_builtin_feed" });
}
