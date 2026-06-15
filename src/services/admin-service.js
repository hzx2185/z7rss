import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import * as cheerio from "cheerio";
import { normalizeIp } from "../lib/request.js";
import { hashPassword } from "../lib/security.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { describeFetchError } from "../lib/http.js";
import { getFeedAdapterTemplates, normalizeFeedAdapterTemplate, setFeedAdapterTemplates } from "./feed-adapter-templates.js";
import { normalizeRssHubBaseUrls, parseRssHubBaseUrlList } from "./feed-discovery.js";

const REDEEM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DOCKER_HUB_DEFAULT_API_BASE_URL = "https://hub.docker.com/v2";
const RSSHUB_HEALTH_ROUTES = ["/zhihu/hot", "/gelonghui/hot-article"];

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeRssHubCheckBases(value, fallback = []) {
  const raw = String(value || "").trim();
  if (/^none$/i.test(raw)) return [];
  if (raw) return normalizeRssHubBaseUrls(parseRssHubBaseUrlList(raw));
  return normalizeRssHubBaseUrls(fallback);
}

function normalizeDockerImageName(value = "") {
  let raw = String(value || "").trim();
  if (!raw) return "hzx2185/z7rss";
  raw = raw.replace(/^docker\.io\//i, "");
  raw = raw.replace(/^registry-1\.docker\.io\//i, "");
  raw = raw.replace(/^index\.docker\.io\//i, "");
  raw = raw.replace(/^library\//i, "library/");
  if (!raw.includes("/")) return `library/${raw}`;
  return raw;
}

function parseDockerImageRef(image, tag) {
  const normalizedImage = normalizeDockerImageName(image);
  const segments = normalizedImage.split("/");
  const repositoryPart = segments.pop() || "z7rss";
  const namespace = segments.join("/") || "library";
  const colonIndex = repositoryPart.lastIndexOf(":");
  const repository = colonIndex > -1 ? repositoryPart.slice(0, colonIndex) : repositoryPart;
  const inferredTag = colonIndex > -1 ? repositoryPart.slice(colonIndex + 1) : "";
  return {
    namespace,
    repository,
    tag: String(tag || inferredTag || "latest").trim() || "latest"
  };
}

function toIsoOrEmpty(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isRemoteNewer(localBuildTime, remoteUpdatedAt) {
  const local = new Date(localBuildTime);
  const remote = new Date(remoteUpdatedAt);
  if (Number.isNaN(local.getTime()) || Number.isNaN(remote.getTime())) return null;
  return remote.getTime() > local.getTime() + 1000;
}

function parseSemverTag(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    raw,
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ""
  };
}

function compareSemverTags(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && !right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function getLatestVersionTag(tags = []) {
  return tags
    .map((entry) => ({
      name: String(entry?.name || "").trim(),
      publishedAt: toIsoOrEmpty(entry?.tag_last_pushed || entry?.last_updated || ""),
      semver: parseSemverTag(entry?.name)
    }))
    .filter((entry) => entry.name && entry.semver)
    .sort((left, right) => compareSemverTags(right.semver, left.semver))[0] || null;
}

function isVersionNewer(currentVersion, latestVersion) {
  const current = parseSemverTag(currentVersion);
  const latest = parseSemverTag(latestVersion);
  if (!current || !latest) return null;
  return compareSemverTags(latest, current) > 0;
}

export function createAdminService({
  store,
  accountService,
  config,
  secretBox,
  feedService,
  ai = null,
  refreshService = null,
  maintenanceService = null,
  dockerHubFetch = globalThis.fetch
}) {
  function isSecretSettingKey(key) {
    return key === "api_key" || key === "password" || key === "configs_secret";
  }

  function normalizePeriodEnd(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw badRequest("到期时间格式无效", { code: "invalid_period_end" });
    }
    return date.toISOString();
  }

  function isPrivateHost(hostname = "") {
    const host = String(hostname || "").trim().toLowerCase();
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    const ipVersion = net.isIP(host.replace(/^\[|\]$/g, ""));
    if (!ipVersion) return false;
    if (ipVersion === 6) {
      return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
    }
    const [a, b] = host.split(".").map((part) => Number(part));
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  function parsePublicHttpUrl(value = "") {
    let url;
    try {
      url = new URL(String(value || "").trim());
    } catch (_error) {
      throw badRequest("网址格式无效", { code: "feed_adapter_suggest_url_invalid" });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw badRequest("只支持 http/https 网址", { code: "feed_adapter_suggest_url_invalid" });
    }
    if (isPrivateHost(url.hostname)) {
      throw badRequest("不能抓取本机或内网地址", { code: "feed_adapter_suggest_url_blocked" });
    }
    url.hash = "";
    return url.toString();
  }

  function escapeRegex(value = "") {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildDefaultTemplateMatch(inputUrl = "") {
    const url = new URL(inputUrl);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const suffix = pathname === "/" ? "/?" : `${escapeRegex(pathname)}/?`;
    return `^${escapeRegex(url.origin)}${suffix}$`;
  }

  function slugifyTemplateId(value = "") {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `template-${Date.now().toString(36)}`;
  }

  function normalizeText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toSafeAbsoluteHttpUrl(candidate = "", baseUrl = "") {
    const raw = String(candidate || "").trim();
    if (!raw) return "";
    try {
      const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function buildJuejinHotTemplate(inputUrl = "") {
    let url;
    try {
      url = new URL(inputUrl);
    } catch (_error) {
      return null;
    }
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "juejin.cn" || !/^\/hot\/articles(?:\/\d+)?\/?$/i.test(url.pathname)) {
      return null;
    }
    const categoryId = url.pathname.split("/").filter(Boolean)[2] || "1";
    return {
      name: "掘金热榜 文章",
      match: "^https://juejin\\.cn/hot/articles(?:/\\d+)?/?$",
      feedUrl: `https://api.juejin.cn/content_api/v1/content/article_rank?category_id=${encodeURIComponent(categoryId)}&type=hot`,
      requestMethod: "GET",
      requestBody: "",
      feedFormat: "json",
      requestProfile: "browser",
      jsonItemsPath: "data",
      jsonTitlePath: "content.title",
      jsonLinkPath: "content.content_id",
      jsonSummaryPath: "content.brief",
      jsonContentPath: "content.brief"
    };
  }

  function buildJuejinRecommendedTemplate(inputUrl = "") {
    let url;
    try {
      url = new URL(inputUrl);
    } catch (_error) {
      return null;
    }
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "juejin.cn" || !/^\/recommended\/?$/i.test(url.pathname)) {
      return null;
    }
    const sort = String(url.searchParams.get("sort") || "popular").trim().toLowerCase();
    const sortTypes = {
      popular: 200,
      newest: 300,
      hottest: 0,
      three_days_hottest: 3,
      weekly_hottest: 7,
      monthly_hottest: 30,
      newest_withtop: 600,
      newest_ctime: 500
    };
    const sortType = sortTypes[sort] ?? sortTypes.popular;
    const sortLabels = {
      popular: "推荐",
      newest: "最新",
      hottest: "热门",
      three_days_hottest: "3天热门",
      weekly_hottest: "7天热门",
      monthly_hottest: "30天热门"
    };
    const match = sort && sort !== "popular"
      ? `^https://juejin\\.cn/recommended(?:\\?(?:[^#]*&)?sort=${escapeRegex(sort)}(?:&[^#]*)?)?$`
      : "^https://juejin\\.cn/recommended(?:\\?.*)?$";
    return {
      name: `掘金推荐 ${sortLabels[sort] || sort}`,
      match,
      feedUrl: "https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed",
      requestMethod: "POST",
      requestBody: JSON.stringify({
        id_type: 2,
        client_type: 2608,
        sort_type: sortType,
        cursor: "0",
        limit: 20
      }),
      feedFormat: "json",
      requestProfile: "browser",
      jsonItemsPath: "data",
      jsonTitlePath: "item_info.article_info.title",
      jsonLinkPath: "item_info.article_info.article_id",
      jsonDatePath: "item_info.article_info.rtime",
      jsonSummaryPath: "item_info.article_info.brief_content",
      jsonContentPath: "item_info.article_info.brief_content"
    };
  }

  function getCandidateTemplateValue(rawSuggestion = {}, keys = []) {
    const sources = [
      rawSuggestion,
      rawSuggestion.template,
      rawSuggestion.rules,
      rawSuggestion.rule,
      rawSuggestion.mapping,
      rawSuggestion.selectors,
      rawSuggestion.html,
      rawSuggestion.json
    ].filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    for (const source of sources) {
      for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null) {
          return source[key];
        }
      }
    }
    return "";
  }

  function inferHtmlTemplateSuggestion(inputUrl = "", sample = "") {
    if (!/<(?:html|body|article|main|div|a)\b/i.test(sample)) return null;
    const $ = cheerio.load(sample);
    const candidates = [
      "article",
      "li",
      ".article-item",
      ".entry",
      ".item",
      ".post",
      ".hot-list a[href]",
      "a[href]"
    ];
    for (const selector of candidates) {
      const roots = $(selector).toArray();
      const validRoots = roots.filter((element) => {
        const root = $(element);
        const link = root.is("a")
          ? toSafeAbsoluteHttpUrl(root.attr("href") || "", inputUrl)
          : toSafeAbsoluteHttpUrl(root.find("a[href]").first().attr("href") || "", inputUrl);
        const title = normalizeText(root.is("a") ? root.text() : root.find("h1,h2,h3,a").first().text());
        return Boolean(link && title && title.length >= 4 && title.length <= 180);
      });
      if (validRoots.length < 2) continue;
      const isAnchorRoot = selector.endsWith("a[href]") || selector === "a[href]";
      return {
        feedFormat: "html",
        requestProfile: "browser",
        htmlItemsSelector: selector,
        htmlTitleSelector: isAnchorRoot ? "" : "h1,h2,h3,a",
        htmlLinkSelector: isAnchorRoot ? "" : "a[href]",
        htmlSummarySelector: "",
        htmlContentSelector: ""
      };
    }
    return null;
  }

  function buildBaselineTemplateSuggestion(inputUrl = "", sample = "") {
    return buildJuejinHotTemplate(inputUrl) || buildJuejinRecommendedTemplate(inputUrl) || inferHtmlTemplateSuggestion(inputUrl, sample) || {};
  }

  function hasUsableTemplateSuggestion(suggestion = {}) {
    return Boolean(
      suggestion &&
        typeof suggestion === "object" &&
        suggestion.feedUrl &&
        suggestion.feedFormat &&
        (
          suggestion.feedFormat !== "html" ||
          suggestion.htmlItemsSelector ||
          suggestion.jsonItemsPath
        )
    );
  }

  function normalizeSuggestedRequestMethod(value = "", fallback = "GET") {
    const candidate = String(value || "").trim().toUpperCase();
    if (candidate === "GET" || candidate === "POST") return candidate;
    return fallback === "POST" ? "POST" : "GET";
  }

  function extractJsonObject(text = "") {
    const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(raw);
    } catch (_error) {
      // Continue with a balanced-object scan below.
    }

    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
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
          try {
            return JSON.parse(raw.slice(start, index + 1));
          } catch (_error) {
            return null;
          }
        }
      }
    }
    return null;
  }

  async function fetchTemplateSample(inputUrl, cookie = "") {
    let response;
    try {
      response = await fetch(inputUrl, {
        headers: {
          "user-agent": config.browserUserAgent || config.userAgent || "Mozilla/5.0 AppleWebKit/537.36 Chrome/135 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
          ...(cookie ? { cookie } : {})
        },
        signal: AbortSignal.timeout(Math.min(Math.max(Number(config.crawlTimeoutMs) || 15000, 5000), 30000))
      });
    } catch (error) {
      throw badRequest(`网页样本抓取失败：${describeFetchError(error)}`, { code: "feed_adapter_suggest_fetch_failed" });
    }
    const body = await response.text();
    if (!response.ok) {
      throw badRequest(`网页样本抓取失败：${response.status} ${response.statusText}`, { code: "feed_adapter_suggest_fetch_failed" });
    }
    return {
      contentType: response.headers.get("content-type") || "",
      sample: body.slice(0, 60000)
    };
  }

  function compactTemplateSample(sample = "", contentType = "") {
    const raw = String(sample || "");
    if (!raw) return "";
    if (/json/i.test(contentType) || /^\s*[\[{]/.test(raw)) {
      return raw.slice(0, 14000);
    }
    const $ = cheerio.load(raw);
    const title = normalizeText($("title").first().text());
    const description = normalizeText(
      $("meta[name='description']").attr("content") ||
        $("meta[property='og:description']").attr("content") ||
        ""
    );
    const links = $("a[href]").toArray().slice(0, 80).map((element) => {
      const node = $(element);
      const text = normalizeText(node.text()).slice(0, 180);
      const href = String(node.attr("href") || "").trim();
      return text || href ? `<a href="${href}">${text}</a>` : "";
    }).filter(Boolean);
    const containers = $("article, main, li, .hot-list, .entry-list, .article-list, .item, .entry")
      .toArray()
      .slice(0, 40)
      .map((element) => {
        const node = $(element).clone();
        node.find("script,style,noscript,svg,img").remove();
        return normalizeText(node.text()).slice(0, 300);
      })
      .filter(Boolean);
    const scriptHints = [];
    $("script").each((_, element) => {
      const text = $(element).html() || "";
      if (/__NUXT__|__NEXT_DATA__|INITIAL|content_api|recommend_api|article_rank|hot/i.test(text)) {
        scriptHints.push(text.slice(0, 2500));
      }
    });
    return [
      title ? `TITLE: ${title}` : "",
      description ? `DESCRIPTION: ${description}` : "",
      links.length ? `LINKS:\n${links.join("\n")}` : "",
      containers.length ? `TEXT_BLOCKS:\n${containers.join("\n")}` : "",
      scriptHints.length ? `SCRIPT_HINTS:\n${scriptHints.join("\n---\n")}` : ""
    ].filter(Boolean).join("\n\n").slice(0, 14000);
  }

  function buildTemplateSuggestionPrompt({ inputUrl, contentType, sample }) {
    return `你是 RSS 抓取模板配置助手。请根据给定网址和网页样本，输出一个严格 JSON 对象，用于把网页列表映射成订阅源。不要输出 Markdown，不要解释。\n\n可用字段：\n{\n  "name": "模板名称",\n  "match": "匹配输入网址的 JavaScript 正则字符串",\n  "feedUrl": "抓取地址模板，通常填 {rawUrl}，也可填固定 API URL 或 builtin://...",\n  "feedFormat": "html|json|auto|rss|atom",\n  "requestProfile": "browser|auto|bot",\n  "requestMethod": "GET|POST",\n  "requestBody": "POST 请求体 JSON 字符串，可为空",\n  "htmlItemsSelector": "每条列表项的 CSS 选择器",\n  "htmlTitleSelector": "相对于列表项的标题选择器",\n  "htmlLinkSelector": "相对于列表项的链接选择器",\n  "htmlDateSelector": "相对于列表项的日期选择器，可为空",\n  "htmlSummarySelector": "相对于列表项的摘要选择器，可为空",\n  "htmlContentSelector": "相对于列表项的正文选择器，可为空",\n  "jsonItemsPath": "JSON 列表路径，可为空",\n  "jsonTitlePath": "JSON 标题路径，可为空",\n  "jsonLinkPath": "JSON 链接路径，可为空",\n  "jsonDatePath": "JSON 日期路径，可为空",\n  "jsonSummaryPath": "JSON 摘要路径，可为空",\n  "jsonContentPath": "JSON 正文路径，可为空",\n  "notes": "一句话说明"\n}\n\n规则：\n- 如果样本是普通 HTML 列表，feedFormat 选 html，feedUrl 优先 {rawUrl}。\n- HTML 选择器尽量稳定、简短，优先列表项容器、标题、链接、摘要，不要使用随机 hash 类名。\n- 如果页面内明显是 JSON API 响应，feedFormat 选 json 并填写 JSON 路径；接口需要 POST 时填写 requestMethod 和 requestBody。\n- match 应精确到当前栏目路径，避免匹配整个网站。\n- 不确定的字段填空字符串。\n\n网址：${inputUrl}\nContent-Type：${contentType}\n网页样本：\n${sample}`;
  }

  function normalizeSuggestedTemplate(rawSuggestion = {}, inputUrl = "", baselineSuggestion = {}) {
    const url = new URL(inputUrl);
    const hostLabel = url.hostname.replace(/^www\./i, "");
    const pick = (keys) => getCandidateTemplateValue(rawSuggestion, keys);
    const name = String(pick(["name", "title", "templateName"]) || baselineSuggestion.name || `${hostLabel} 抓取模板`).trim().slice(0, 120);
    const template = {
      id: slugifyTemplateId(name || hostLabel),
      name,
      enabled: true,
      match: String(pick(["match", "urlPattern", "pattern"]) || baselineSuggestion.match || "").trim() || buildDefaultTemplateMatch(inputUrl),
      feedUrl: String(pick(["feedUrl", "feed_url", "url", "apiUrl", "api_url"]) || baselineSuggestion.feedUrl || "").trim() || "{rawUrl}",
      requestMethod: normalizeSuggestedRequestMethod(
        pick(["requestMethod", "request_method", "method"]),
        baselineSuggestion.requestMethod || "GET"
      ),
      requestBody: String(pick(["requestBody", "request_body", "body", "postBody", "post_body"]) || baselineSuggestion.requestBody || "").trim(),
      feedFormat: String(pick(["feedFormat", "feed_format", "format"]) || baselineSuggestion.feedFormat || "html").trim().toLowerCase(),
      requestProfile: String(pick(["requestProfile", "request_profile", "profile"]) || baselineSuggestion.requestProfile || "browser").trim().toLowerCase(),
      htmlItemsSelector: String(pick(["htmlItemsSelector", "html_items_selector", "itemsSelector", "itemSelector", "listSelector"]) || baselineSuggestion.htmlItemsSelector || "").trim(),
      htmlTitleSelector: String(pick(["htmlTitleSelector", "html_title_selector", "titleSelector"]) || baselineSuggestion.htmlTitleSelector || "").trim(),
      htmlLinkSelector: String(pick(["htmlLinkSelector", "html_link_selector", "linkSelector"]) || baselineSuggestion.htmlLinkSelector || "").trim(),
      htmlDateSelector: String(pick(["htmlDateSelector", "html_date_selector", "dateSelector"]) || baselineSuggestion.htmlDateSelector || "").trim(),
      htmlSummarySelector: String(pick(["htmlSummarySelector", "html_summary_selector", "summarySelector"]) || baselineSuggestion.htmlSummarySelector || "").trim(),
      htmlContentSelector: String(pick(["htmlContentSelector", "html_content_selector", "contentSelector"]) || baselineSuggestion.htmlContentSelector || "").trim(),
      jsonItemsPath: String(pick(["jsonItemsPath", "json_items_path", "itemsPath", "listPath"]) || baselineSuggestion.jsonItemsPath || "").trim(),
      jsonTitlePath: String(pick(["jsonTitlePath", "json_title_path", "titlePath"]) || baselineSuggestion.jsonTitlePath || "").trim(),
      jsonLinkPath: String(pick(["jsonLinkPath", "json_link_path", "linkPath", "urlPath"]) || baselineSuggestion.jsonLinkPath || "").trim(),
      jsonDatePath: String(pick(["jsonDatePath", "json_date_path", "datePath"]) || baselineSuggestion.jsonDatePath || "").trim(),
      jsonSummaryPath: String(pick(["jsonSummaryPath", "json_summary_path", "summaryPath"]) || baselineSuggestion.jsonSummaryPath || "").trim(),
      jsonContentPath: String(pick(["jsonContentPath", "json_content_path", "contentPath"]) || baselineSuggestion.jsonContentPath || "").trim()
    };
    return template;
  }

  function buildBaselineTemplateResult(inputUrl, cookie, sample, baselineSuggestion, notes = "") {
    const template = normalizeFeedAdapterTemplate(normalizeSuggestedTemplate({}, inputUrl, baselineSuggestion));
    return {
      template: { ...template, cookie: "", cookieConfigured: Boolean(cookie) },
      notes,
      provider: "本地识别",
      sample: {
        contentType: sample.contentType,
        chars: sample.sample.length
      }
    };
  }

  function normalizePositiveInteger(value, label) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
      throw badRequest(`${label}必须是大于等于 0 的整数`, { code: "invalid_non_negative_integer" });
    }
    return Math.floor(normalized);
  }

  function normalizeOptionalBoolean(value, label) {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (value === true || value === 1 || value === "1" || value === "true") return 1;
    if (value === false || value === 0 || value === "0" || value === "false") return 0;
    throw badRequest(`${label}必须是布尔值`, { code: "invalid_boolean" });
  }

  function normalizeRedeemCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function generateRedeemCode(prefix = "") {
    const normalizedPrefix = normalizeRedeemCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const chunks = [];
    for (let i = 0; i < 16; i += 1) {
      chunks.push(REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)]);
    }
    const body = `${chunks.slice(0, 4).join("")}-${chunks.slice(4, 8).join("")}-${chunks.slice(8, 12).join("")}-${chunks.slice(12, 16).join("")}`;
    return normalizedPrefix ? `${normalizedPrefix}-${body}` : body;
  }

  function createRedeemBatchId() {
    return `batch_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
  }

  function getRedeemBatchId(entry) {
    return String(entry?.resolved_batch_id || entry?.batch_id || "").trim();
  }

  function getRedeemCodeById(id) {
    return store.listRedeemCodes().find((entry) => Number(entry.id) === Number(id)) || null;
  }

  function getRedeemBatch(batchId) {
    const normalizedBatchId = String(batchId || "").trim();
    if (!normalizedBatchId) return [];
    return store.listRedeemCodes().filter((entry) => getRedeemBatchId(entry) === normalizedBatchId);
  }

  function markUnavailableSecret(output, category, key, rawValue, decryptedValue) {
    if (!output?.[category]) return;
    const hasRawValue = Boolean(String(rawValue || "").trim());
    const hasDecryptedValue = Boolean(String(decryptedValue || "").trim());
    if (key === "api_key") {
      output[category].api_key_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "password") {
      output[category].password_unavailable = hasRawValue && !hasDecryptedValue;
    }
    if (key === "configs_secret") {
      output[category].configs_unavailable = hasRawValue && !hasDecryptedValue;
    }
  }

  function getUnavailableSecretFlag(key) {
    if (key === "api_key") return "api_key_unavailable";
    if (key === "password") return "password_unavailable";
    if (key === "configs_secret") return "configs_unavailable";
    return "";
  }

  function getSecretSettingLabel(category, key) {
    if (key === "configs_secret") return "API 列表";
    if (key === "password") return "密码";
    if (key === "api_key") return "API Key";
    return `${category}.${key}`;
  }

  function getSettingSecretValue(category, key) {
    const normalizedCategory = String(category || "").trim().toLowerCase();
    const normalizedKey = String(key || "").trim().toLowerCase();
    const allowedSecrets = new Set([
      "mail.password",
      "ai.api_key",
      "translation_google.api_key",
      "translation_bing.api_key",
      "translation_deeplx.api_key"
    ]);
    const secretId = `${normalizedCategory}.${normalizedKey}`;
    if (!allowedSecrets.has(secretId)) {
      throw badRequest("密钥类型无效", { code: "invalid_secret_setting" });
    }

    const row = store.getSetting(normalizedCategory, normalizedKey);
    const value = secretBox.decrypt(row?.value || "");
    return {
      category: normalizedCategory,
      key: normalizedKey,
      value
    };
  }

  function isUnavailableSecret(current, category, key) {
    const flag = getUnavailableSecretFlag(key);
    return Boolean(flag && current?.[category]?.[flag]);
  }

  function maskApiKey(output, category) {
    if (!output?.[category]) return;
    output[category].api_key_configured = Boolean(output[category].api_key || output[category].api_key_unavailable);
    delete output[category].api_key;
  }

  function maskPassword(output, category) {
    if (!output?.[category]) return;
    output[category].password_configured = Boolean(output[category].password || output[category].password_unavailable);
    delete output[category].password;
  }

  function maskTranslationProviderPool(output) {
    const pool = output?.translation_provider_pool;
    if (!pool?.configs_secret) return;
    try {
      const configs = JSON.parse(pool.configs_secret);
      pool.configs = Array.isArray(configs)
        ? configs.map((entry) => {
            const { apiKey: _apiKey, api_key: _api_key, ...safeEntry } = entry || {};
            return {
              ...safeEntry,
              api_key_configured: Boolean(_apiKey || _api_key)
            };
          })
        : [];
    } catch (_error) {
      pool.configs = [];
      pool.configs_unavailable = true;
    }
    delete pool.configs_secret;
  }

  function maskAiProviderPool(output) {
    const pool = output?.ai_provider_pool;
    if (!pool?.configs_secret) return;
    try {
      const configs = JSON.parse(pool.configs_secret);
      pool.configs = Array.isArray(configs)
        ? configs.map((entry) => {
            const { apiKey: _apiKey, api_key: _api_key, ...safeEntry } = entry || {};
            return {
              ...safeEntry,
              api_key_configured: Boolean(_apiKey || _api_key)
            };
          })
        : [];
    } catch (_error) {
      pool.configs = [];
      pool.configs_unavailable = true;
    }
    delete pool.configs_secret;
  }

  function withMaskedSecrets(settings) {
    const output = structuredClone(settings || {});
    maskApiKey(output, "ai");
    maskApiKey(output, "translation_google");
    maskApiKey(output, "translation_bing");
    maskApiKey(output, "translation_deeplx");
    maskPassword(output, "mail");
    maskTranslationProviderPool(output);
    maskAiProviderPool(output);
    return output;
  }

  function getSettingsMap() {
    const rows = store.listSettings();
    const settings = rows.reduce((acc, row) => {
      if (!acc[row.category]) acc[row.category] = {};
      const value = isSecretSettingKey(row.key) ? secretBox.decrypt(row.value) : row.value;
      acc[row.category][row.key] = value;
      if (isSecretSettingKey(row.key)) markUnavailableSecret(acc, row.category, row.key, row.value, value);
      return acc;
    }, {});
    return withMaskedSecrets(settings);
  }

  function getPoolSecretValue(poolType, id) {
    const normalizedPoolType = String(poolType || "").trim().toLowerCase();
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      throw badRequest("API ID 不能为空", { code: "invalid_secret_id" });
    }

    if (normalizedPoolType === "ai") {
      const entry = accountService.getSystemAiProviderPool()
        .find((item) => String(item.id) === normalizedId);
      if (!entry) {
        throw notFound("AI 接口不存在", { code: "secret_not_found" });
      }
      return {
        pool: "ai",
        id: entry.id,
        name: entry.name,
        apiKey: entry.apiKey || ""
      };
    }

    if (normalizedPoolType === "translation") {
      const entry = accountService.getSystemTranslationProviderPool()
        .find((item) => String(item.id) === normalizedId);
      if (!entry) {
        throw notFound("翻译 API 不存在", { code: "secret_not_found" });
      }
      return {
        pool: "translation",
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        apiKey: entry.apiKey || ""
      };
    }

    throw badRequest("API 类型无效", { code: "invalid_secret_pool" });
  }

  function getAuditContext(context = null) {
    const actor = context?.actor || null;
    return {
      actorUserId: actor?.id ?? null,
      actorEmail: String(actor?.email || "").trim().toLowerCase(),
      actorDisplayName: String(actor?.displayName || "").trim(),
      actorIp: normalizeIp(context?.requestIp || "")
    };
  }

  function sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isAdmin: Boolean(user.is_admin),
      status: user.status,
      createdAt: user.created_at
    };
  }

  function sanitizeSession(session) {
    return {
      id: session.id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      lastSeenAt: session.last_seen_at,
      ipAddress: session.ip_address || "",
      userAgent: session.user_agent || ""
    };
  }

  function getUserOrThrow(userId) {
    const user = store.getUserById(userId);
    if (!user) {
      throw notFound("用户不存在", { code: "user_not_found" });
    }
    return user;
  }

  function getUserSecuritySnapshot(userId) {
    return {
      user: sanitizeUser(getUserOrThrow(userId)),
      sessions: store.listUserSessions(userId).map((session) => sanitizeSession(session))
    };
  }

  function logAudit(context, entry) {
    if (!entry?.action || !entry?.targetType || !entry?.summary) {
      return;
    }

    const actor = getAuditContext(context);
    store.createAuditLog({
      ...actor,
      action: String(entry.action),
      targetType: String(entry.targetType),
      targetId: entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
      summary: String(entry.summary),
      detailsJson: JSON.stringify(entry.details || {})
    });
  }

  function getFileSize(filePath) {
    try {
      return fs.statSync(filePath).size;
    } catch (_error) {
      return 0;
    }
  }

  function getBackupDir() {
    return path.join(path.dirname(config.dbPath), "backups");
  }

  function listDatabaseBackupFiles() {
    const backupDir = getBackupDir();
    return fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir)
          .filter((entry) => entry.endsWith(".db"))
          .map((filename) => {
            const filePath = path.join(backupDir, filename);
            const stat = fs.statSync(filePath);
            return {
              filename,
              size: stat.size,
              updatedAt: stat.mtime.toISOString(),
              automatic: /^z7rss-auto-.*\.db$/i.test(filename)
            };
          })
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      : [];
  }

  function getBackupPath(filename) {
    const normalized = path.basename(String(filename || "").trim());
    if (!/^[a-zA-Z0-9._-]+\.db$/.test(normalized)) {
      throw badRequest("备份文件名无效", { code: "invalid_backup_filename" });
    }
    const backupDir = getBackupDir();
    const filePath = path.join(backupDir, normalized);
    const resolvedDir = path.resolve(backupDir);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) {
      throw badRequest("备份文件名无效", { code: "invalid_backup_filename" });
    }
    if (!fs.existsSync(resolvedPath)) {
      throw notFound("备份文件不存在", { code: "backup_not_found" });
    }
    const walPath = `${resolvedPath}-wal`;
    const shmPath = `${resolvedPath}-shm`;
    const deleteRelatedFiles = () => {
      fs.rmSync(walPath, { force: true });
      fs.rmSync(shmPath, { force: true });
    };
    return {
      path: resolvedPath,
      filename: normalized,
      size: getFileSize(resolvedPath),
      walPath,
      shmPath,
      deleteRelatedFiles
    };
  }

  function getDatabaseSnapshot() {
    const metrics = store.getDatabaseMetrics?.() || {};
    const settingsRows = store.listSettings();
    const backupSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_backup") acc[row.key] = row.value;
      return acc;
    }, {});
    const vacuumSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_vacuum") acc[row.key] = row.value;
      return acc;
    }, {});
    const cleanupSettings = settingsRows.reduce((acc, row) => {
      if (row.category === "database_cleanup") acc[row.key] = row.value;
      return acc;
    }, {});
    const backupEnabledValue = String(backupSettings.enabled ?? "").trim().toLowerCase();
    const backupEnabled = backupEnabledValue
      ? ["1", "true", "yes", "on"].includes(backupEnabledValue)
      : config.databaseBackupEnabled !== false;
    const backupRetentionDays = Math.max(0, Number(backupSettings.retention_days ?? config.databaseBackupRetentionDays ?? 14) || 0);
    const backupMaxFiles = Math.max(1, Number(backupSettings.max_files ?? config.databaseBackupMaxFiles ?? 24) || 24);
    const backupScheduleFrequency =
      String(backupSettings.schedule_frequency || "daily").trim().toLowerCase() === "weekly" ? "weekly" : "daily";
    const backupScheduleTime = /^\d{2}:\d{2}$/.test(String(backupSettings.schedule_time || "").trim())
      ? String(backupSettings.schedule_time).trim()
      : "00:00";
    const backupScheduleWeekdays = String(backupSettings.schedule_weekdays || "")
      .split(",")
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
    const vacuumEnabledValue = String(vacuumSettings.enabled ?? "").trim().toLowerCase();
    const vacuumEnabled = vacuumEnabledValue
      ? ["1", "true", "yes", "on"].includes(vacuumEnabledValue)
      : config.databaseVacuumEnabled !== false;
    const vacuumIntervalDays = Math.max(
      1,
      Number(vacuumSettings.interval_days ?? config.databaseVacuumIntervalDays ?? 7) || 7
    );
    const vacuumScheduleTime = /^\d{2}:\d{2}$/.test(String(vacuumSettings.schedule_time || "").trim())
      ? String(vacuumSettings.schedule_time).trim()
      : config.databaseVacuumTime || "03:30";
    const mainBytes = getFileSize(config.dbPath);
    const walBytes = getFileSize(`${config.dbPath}-wal`);
    const shmBytes = getFileSize(`${config.dbPath}-shm`);
    const totalBytes = mainBytes + walBytes + shmBytes;
    const backupDir = getBackupDir();
    const backupFiles = listDatabaseBackupFiles();
    return {
      path: config.dbPath,
      mainBytes,
      walBytes,
      shmBytes,
      totalBytes,
      pageSize: metrics.pageSize || 0,
      pageCount: metrics.pageCount || 0,
      freelistCount: metrics.freelistCount || 0,
      databaseBytes: metrics.databaseBytes || 0,
      freeBytes: metrics.freeBytes || 0,
      freeRatio: metrics.freeRatio || 0,
      journalMode: metrics.journalMode || "",
      tableRows: metrics.tableRows || [],
      orphanMetrics: metrics.orphanMetrics || {},
      orphanTotal: metrics.orphanTotal || 0,
      backups: {
        enabled: backupEnabled,
        directory: backupDir,
        retentionDays: backupRetentionDays,
        maxFiles: backupMaxFiles,
        scheduleFrequency: backupScheduleFrequency,
        scheduleTime: backupScheduleTime,
        scheduleWeekdays: backupScheduleWeekdays,
        count: backupFiles.length,
        automaticCount: backupFiles.filter((entry) => entry.automatic).length,
        totalBytes: backupFiles.reduce((total, entry) => total + Number(entry.size || 0), 0),
        latest: backupFiles[0] || null,
        files: backupFiles.slice(0, 100)
      },
      vacuum: {
        enabled: vacuumEnabled,
        intervalDays: vacuumIntervalDays,
        scheduleTime: vacuumScheduleTime,
        lastVacuumAt: String(vacuumSettings.last_vacuum_at || "")
      },
      cleanup: {
        maxItemsTotal: String(cleanupSettings.max_items_total ?? cleanupSettings.max_items_per_feed ?? ""),
        maxAgeDays: Math.max(0, Number(cleanupSettings.max_age_days || 0) || 0),
        protectFavorites: cleanupSettings.protect_favorites === undefined
          ? true
          : ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_favorites).trim().toLowerCase()),
        protectUnread: ["1", "true", "yes", "on"].includes(String(cleanupSettings.protect_unread ?? "").trim().toLowerCase()),
        minKeepItems: Math.max(0, Number(cleanupSettings.min_keep_items || 0) || 0)
      },
      maintenance: maintenanceService ? maintenanceService.getStatus() : null
    };
  }

  function getSystemSnapshot(dockerUpdate = null) {
    const imageRef = parseDockerImageRef(config.dockerImage, config.dockerImageTag);
    return {
      billingProvider: config.billingProvider,
      aiEnabled: config.aiEnabled,
      appVersion: config.appVersion || "0.0.0",
      buildCommit: config.buildCommit || "",
      buildTime: config.buildTime || "",
      docker: {
        image: `${imageRef.namespace}/${imageRef.repository}`,
        namespace: imageRef.namespace,
        repository: imageRef.repository,
        tag: imageRef.tag,
        update: dockerUpdate
      }
    };
  }

  function getRssHubConfiguredBases() {
    const settingValue = store.getSetting?.("rsshub", "base_urls")?.value ?? "";
    return normalizeRssHubCheckBases(settingValue, config.rssHubBaseUrls || []);
  }

  function parseRssHubHomeInfo(html = "") {
    const $ = cheerio.load(String(html || ""));
    const debugInfo = {};

    // 优先使用高精度 DOM 选择器解析 Debug Info
    $(".debug-item").each((_, el) => {
      const key = $(el).find(".debug-key").text().replace(":", "").trim();
      const val = $(el).find(".debug-value").text().trim();
      if (key) {
        debugInfo[key] = val;
      }
    });

    // 兼容可能不含 debug-item 结构但包含文本的 Fallback
    const readFieldFallback = (label) => {
      if (debugInfo[label]) return debugInfo[label];
      const text = $.text();
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(new RegExp(`${escaped}:\\s*([^\\n]+?)(?=(?:\\s*[A-Z][a-zA-Z\\s]+:|\\s*$))`, "i"));
      return match ? match[1].trim() : "";
    };

    const commitLink = $("a[href*='/commit/']").first().text().trim();
    return {
      gitHash: commitLink || debugInfo["Git Hash"] || readFieldFallback("Git Hash"),
      gitDate: debugInfo["Git Date"] || readFieldFallback("Git Date"),
      health: debugInfo["Health"] || readFieldFallback("Health"),
      uptime: debugInfo["Uptime"] || readFieldFallback("Uptime"),
      cacheHitRatio: debugInfo["Cache Hit Ratio"] || readFieldFallback("Cache Hit Ratio")
    };
  }

  function buildRssHubUrl(baseUrl, routePath = "/") {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    const route = String(routePath || "/").replace(/^\/+/, "");
    url.pathname = [basePath, route].filter(Boolean).join("/").replace(/\/+/g, "/") || "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function fetchRssHubText(url) {
    const response = await fetch(url, {
      headers: {
        "user-agent": config.userAgent || "Z7RSSBot/0.1",
        accept: "text/html,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(Math.min(Math.max(Number(config.crawlTimeoutMs) || 15000, 3000), 15000))
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      route: response.headers.get("x-rsshub-route") || "",
      text
    };
  }

  async function checkRssHubBase(baseUrl) {
    const rootUrl = buildRssHubUrl(baseUrl, "/");
    const root = await fetchRssHubText(rootUrl);
    const routes = [];
    for (const routePath of RSSHUB_HEALTH_ROUTES) {
      try {
        const result = await fetchRssHubText(buildRssHubUrl(baseUrl, routePath));
        routes.push({
          path: routePath,
          ok: result.ok,
          status: result.status,
          route: result.route,
          contentType: result.contentType
        });
      } catch (error) {
        routes.push({
          path: routePath,
          ok: false,
          status: 0,
          error: describeFetchError(error)
        });
      }
    }

    return {
      baseUrl,
      ok: root.ok,
      status: root.status,
      statusText: root.statusText,
      contentType: root.contentType,
      rootUrl,
      ...parseRssHubHomeInfo(root.text),
      routes
    };
  }

  async function fetchDockerHubTag(imageRef) {
    if (typeof dockerHubFetch !== "function") {
      throw badRequest("当前运行环境不支持 Docker Hub 更新检查", { code: "docker_update_check_unavailable" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.dockerUpdateCheckTimeoutMs || 8000);
    const baseUrl = stripTrailingSlash(config.dockerHubApiBaseUrl || DOCKER_HUB_DEFAULT_API_BASE_URL);
    const url = new URL(`${baseUrl}/namespaces/${encodeURIComponent(imageRef.namespace)}/repositories/${encodeURIComponent(imageRef.repository)}/tags/${encodeURIComponent(imageRef.tag)}`);

    try {
      const response = await dockerHubFetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw badRequest(`Docker Hub 返回 ${response.status}`, { code: "docker_update_check_failed" });
      }
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw badRequest("Docker Hub 更新检查超时", { code: "docker_update_check_timeout" });
      }
      if (error?.code) throw error;
      throw badRequest("Docker Hub 更新检查失败", { code: "docker_update_check_failed" });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchDockerHubTags(imageRef) {
    if (typeof dockerHubFetch !== "function") {
      throw badRequest("当前运行环境不支持 Docker Hub 更新检查", { code: "docker_update_check_unavailable" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.dockerUpdateCheckTimeoutMs || 8000);
    const baseUrl = stripTrailingSlash(config.dockerHubApiBaseUrl || DOCKER_HUB_DEFAULT_API_BASE_URL);
    const url = new URL(`${baseUrl}/namespaces/${encodeURIComponent(imageRef.namespace)}/repositories/${encodeURIComponent(imageRef.repository)}/tags`);
    url.searchParams.set("page_size", "100");

    try {
      const response = await dockerHubFetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw badRequest(`Docker Hub 返回 ${response.status}`, { code: "docker_update_check_failed" });
      }
      const body = await response.json();
      return Array.isArray(body?.results) ? body.results : [];
    } catch (error) {
      if (error?.name === "AbortError") {
        throw badRequest("Docker Hub 更新检查超时", { code: "docker_update_check_timeout" });
      }
      if (error?.code) throw error;
      throw badRequest("Docker Hub 更新检查失败", { code: "docker_update_check_failed" });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    getDashboard() {
      return {
        metrics: {
          userCount: store.countUsers(),
          adminCount: store.countAdmins(),
          feedCount: store.listAdminFeeds().length,
          orderCount: store.listAllBillingEvents().length
        },
        users: store.listUsers(),
        orders: store.listAllBillingEvents(),
        redeemCodes: store.listRedeemCodes(),
        settings: getSettingsMap(),
        plugins: store.listPlugins().map((entry) => ({
          ...entry,
          config: parseJsonSafe(entry.config_json, {})
        })),
        feedAdapterTemplates: getFeedAdapterTemplates(store, secretBox).map((entry) => ({
          ...entry,
          cookieConfigured: Boolean(entry.cookie),
          cookie: ""
        })),
        contentRules: store.listContentRules(),
        blockedSites: store.listBlockedSites(),
        blockedIps: store.listBlockedIps(),
        auditLogs: store.listAuditLogs(100).map((entry) => ({
          ...entry,
          details: parseJsonSafe(entry.details_json, {})
        })),
        feeds: store.listAdminFeeds(),
        items: store.listAdminItems(150),
        plans: store.listPlans(),
        refresh: refreshService ? refreshService.getStatus() : null,
        maintenance: maintenanceService ? maintenanceService.getStatus() : null,
        database: getDatabaseSnapshot(),
        system: getSystemSnapshot()
      };
    },
    async checkDockerImageUpdate() {
      const imageRef = parseDockerImageRef(config.dockerImage, config.dockerImageTag);
      const [tagResult, tagsResult] = await Promise.allSettled([
        fetchDockerHubTag(imageRef),
        fetchDockerHubTags(imageRef)
      ]);
      if (tagResult.status === "rejected") {
        throw tagResult.reason;
      }
      const tagData = tagResult.value;
      const latestVersionTag = tagsResult.status === "fulfilled"
        ? getLatestVersionTag(tagsResult.value)
        : null;
      const remoteUpdatedAt = toIsoOrEmpty(tagData.tag_last_pushed || tagData.last_updated || "");
      const remoteDigest = String(tagData.digest || "").trim();
      return {
        checkedAt: new Date().toISOString(),
        image: `${imageRef.namespace}/${imageRef.repository}`,
        namespace: imageRef.namespace,
        repository: imageRef.repository,
        tag: imageRef.tag,
        appVersion: config.appVersion || "0.0.0",
        buildCommit: config.buildCommit || "",
        buildTime: config.buildTime || "",
        latestVersion: latestVersionTag?.semver?.version || "",
        latestVersionTag: latestVersionTag?.name || "",
        latestVersionPublishedAt: latestVersionTag?.publishedAt || "",
        remoteUpdatedAt,
        remoteDigest,
        remoteStatus: String(tagData.tag_status || "").trim(),
        remoteSizeBytes: Number(tagData.full_size || 0) || 0,
        versionUpdateAvailable: isVersionNewer(config.appVersion, latestVersionTag?.semver?.version || ""),
        updateAvailable: isRemoteNewer(config.buildTime, remoteUpdatedAt),
        sourceUrl: `https://hub.docker.com/r/${imageRef.namespace}/${imageRef.repository}/tags?name=${encodeURIComponent(imageRef.tag)}`
      };
    },
    async checkRssHubStatus(context = null) {
      const bases = getRssHubConfiguredBases();
      const results = [];
      for (const baseUrl of bases) {
        try {
          results.push(await checkRssHubBase(baseUrl));
        } catch (error) {
          results.push({
            baseUrl,
            ok: false,
            status: 0,
            error: describeFetchError(error),
            routes: []
          });
        }
      }

      // 后端双保险：顺便在后端服务器请求 GitHub API，为前端浏览器受限网络环境做 Failover
      let latestGitHash = "-";
      try {
        const githubRes = await fetch("https://api.github.com/repos/DIYgod/RSSHub/commits/master", {
          headers: {
            "user-agent": "Z7RSSBot/0.1",
            accept: "application/json"
          },
          signal: AbortSignal.timeout(3000)
        });
        if (githubRes.ok) {
          const githubData = await githubRes.json();
          if (githubData && githubData.sha) {
            latestGitHash = String(githubData.sha).substring(0, 7);
          }
        }
      } catch (_e) {
        // 允许静默失败，优雅降级
      }

      const result = {
        checkedAt: new Date().toISOString(),
        enabled: bases.length > 0,
        bases,
        results,
        latestGitHash,
        updateCommand: "docker compose pull rsshub && docker compose up -d rsshub"
      };
      logAudit(context, {
        action: "admin.rsshub.checked",
        targetType: "system",
        targetId: "rsshub",
        summary: "检查 RSSHub 状态",
        details: {
          bases,
          okCount: results.filter((entry) => entry.ok).length
        }
      });
      return result;
    },
    revealProviderSecret(poolType, id, context = null) {
      const result = getPoolSecretValue(poolType, id);
      logAudit(context, {
        action: "admin.settings.secret_revealed",
        targetType: "settings",
        targetId: `${result.pool}:${result.id}`,
        summary: `查看 ${result.pool === "ai" ? "AI" : "翻译"} API Key`,
        details: {
          pool: result.pool,
          id: result.id,
          provider: result.provider || "",
          hasApiKey: Boolean(result.apiKey)
        }
      });
      return result;
    },
    revealSettingSecret(category, key, context = null) {
      const result = getSettingSecretValue(category, key);
      logAudit(context, {
        action: "admin.settings.secret_revealed",
        targetType: "settings",
        targetId: `${result.category}.${result.key}`,
        summary: `查看 ${getSecretSettingLabel(result.category, result.key)}`,
        details: {
          category: result.category,
          key: result.key,
          hasValue: Boolean(result.value)
        }
      });
      return result;
    },
    setFeedAdapterTemplates(templates = [], context = null) {
      const currentById = new Map(getFeedAdapterTemplates(store, secretBox).map((entry) => [entry.id, entry]));
      const prepared = (Array.isArray(templates) ? templates : []).map((entry) => {
        const current = currentById.get(String(entry?.id || ""));
        const cookie = String(entry?.cookie || "").trim() || current?.cookie || "";
        return { ...entry, cookie };
      });
      const saved = setFeedAdapterTemplates(store, prepared, secretBox);
      logAudit(context, {
        action: "admin.feed_adapter_templates.updated",
        targetType: "settings",
        targetId: "feed_adapter_templates.templates_json",
        summary: `更新抓取模板 ${saved.length} 个`,
        details: {
          count: saved.length,
          ids: saved.map((entry) => entry.id)
        }
      });
      return {
        templates: saved.map((entry) => ({
          ...entry,
          cookieConfigured: Boolean(entry.cookie),
          cookie: ""
        }))
      };
    },
    async testFeedAdapterTemplate(template = {}, inputUrl = "") {
      if (!feedService?.testFetchAdapterTemplate) {
        throw badRequest("抓取模板测试服务不可用", { code: "feed_adapter_test_unavailable" });
      }
      const current = getFeedAdapterTemplates(store, secretBox).find((entry) => entry.id === String(template?.id || ""));
      const cookie = String(template?.cookie || "").trim() || current?.cookie || "";
      return feedService.testFetchAdapterTemplate({ ...template, cookie }, inputUrl);
    },
    async suggestFeedAdapterTemplate(payload = {}, context = null) {
      if (!ai?.summarize || !accountService?.getEffectiveAiRuntimes) {
        throw badRequest("AI 模板生成服务不可用", { code: "feed_adapter_suggest_unavailable" });
      }
      const inputUrl = parsePublicHttpUrl(payload.url || payload.inputUrl || payload.input_url || "");
      const current = getFeedAdapterTemplates(store, secretBox).find((entry) => entry.id === String(payload?.template?.id || payload?.id || ""));
      const cookie = String(payload.cookie || payload.template?.cookie || "").trim() || current?.cookie || "";
      const sample = await fetchTemplateSample(inputUrl, cookie);
      const baselineSuggestion = buildBaselineTemplateSuggestion(inputUrl, sample.sample);
      const compactSample = compactTemplateSample(sample.sample, sample.contentType);
      const prompt = buildTemplateSuggestionPrompt({ inputUrl, contentType: sample.contentType, sample: compactSample });
      const runtimes = accountService.getEffectiveAiRuntimes(0).filter((entry) => entry.baseUrl && entry.apiKey);
      if (!runtimes.length) {
        if (hasUsableTemplateSuggestion(baselineSuggestion)) {
          return buildBaselineTemplateResult(inputUrl, cookie, sample, baselineSuggestion, "后台 AI 未配置，已使用本地识别规则");
        }
        throw badRequest("后台 AI 接口未配置，无法生成抓取模板", { code: "ai_provider_unconfigured" });
      }

      const errors = [];
      for (const runtime of runtimes) {
        try {
          const output = await ai.summarize({
            ...runtime,
            summaryPrompt: "你是 RSS 抓取模板生成器。只输出严格 JSON 对象，不要输出 Markdown、解释或额外文本。",
            maxInputChars: Math.max(Number(runtime.maxInputChars || 0), 16000)
          }, prompt);
          const parsed = extractJsonObject(output);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("AI 未返回有效 JSON 对象");
          }
          const template = normalizeFeedAdapterTemplate(normalizeSuggestedTemplate(parsed, inputUrl, baselineSuggestion));
          logAudit(context, {
            action: "admin.feed_adapter_template.suggested",
            targetType: "settings",
            targetId: "feed_adapter_templates.templates_json",
            summary: `AI 生成抓取模板草稿 ${template.name}`,
            details: {
              inputUrl,
              feedFormat: template.feedFormat,
              provider: runtime.label || runtime.id || runtime.source || "ai"
            }
          });
          return {
            template: { ...template, cookie: "", cookieConfigured: Boolean(cookie) },
            notes: String(parsed.notes || "").trim(),
            provider: runtime.label || runtime.id || runtime.source || "AI",
            sample: {
              contentType: sample.contentType,
              chars: sample.sample.length
            }
          };
        } catch (error) {
          errors.push(`${runtime.label || runtime.id || runtime.source || "AI"}: ${error.message || String(error)}`);
        }
      }
      if (hasUsableTemplateSuggestion(baselineSuggestion)) {
        return buildBaselineTemplateResult(
          inputUrl,
          cookie,
          sample,
          baselineSuggestion,
          `AI 生成失败，已使用本地识别规则：${errors.slice(0, 2).join("；")}`
        );
      }
      throw badRequest(`AI 生成抓取模板失败：${errors.slice(0, 3).join("；")}`, { code: "feed_adapter_suggest_failed" });
    },
    getUserSecurity(userId) {
      return getUserSecuritySnapshot(userId);
    },
    updateUser({ userId, isAdmin, status }, context = null) {
      const existingUser = getUserOrThrow(userId);

      if (typeof isAdmin === "boolean") {
        store.setUserAdmin(userId, isAdmin, status || null);
      }
      if (status) {
        store.setUserStatus(userId, status);
      }

      const updatedUser = store.getUserById(userId);
      if (updatedUser.status !== "active") {
        store.deleteUserSessions(userId);
      }
      logAudit(context, {
        action: "admin.user.updated",
        targetType: "user",
        targetId: userId,
        summary: `更新用户 ${updatedUser.email}`,
        details: {
          email: updatedUser.email,
          before: {
            isAdmin: Boolean(existingUser.is_admin),
            status: existingUser.status
          },
          after: {
            isAdmin: Boolean(updatedUser.is_admin),
            status: updatedUser.status
          }
        }
      });
      return updatedUser;
    },
    deleteUser(userId, context = null) {
      const existingUser = getUserOrThrow(userId);
      const actorUserId = Number(context?.actor?.id || 0);

      if (actorUserId && actorUserId === Number(userId)) {
        throw badRequest("不能删除当前登录账号", { code: "cannot_delete_current_user" });
      }
      if (existingUser.is_admin && store.countAdmins() <= 1) {
        throw conflict("至少保留一个管理员账号", { code: "last_admin_required" });
      }

      store.deleteUser(userId);
      const orphanCleanup = store.cleanupOrphans?.() || {};
      const orphanFeedsDeleted = Number(orphanCleanup.changes?.orphanFeedsDeleted || 0);
      logAudit(context, {
        action: "admin.user.deleted",
        targetType: "user",
        targetId: userId,
        summary: `删除用户 ${existingUser.email}`,
        details: {
          email: existingUser.email,
          isAdmin: Boolean(existingUser.is_admin),
          status: existingUser.status,
          orphanFeedsDeleted,
          orphanCleanup
        }
      });

      return {
        deleted: true,
        user: sanitizeUser(existingUser),
        orphanFeedsDeleted,
        orphanCleanup
      };
    },
    revokeUserSession(userId, sessionId, context = null) {
      const user = getUserOrThrow(userId);
      const existingSession = store.listUserSessions(userId).find((entry) => Number(entry.id) === Number(sessionId));
      if (!existingSession) {
        throw notFound("会话不存在", { code: "session_not_found" });
      }

      store.deleteSession(existingSession.token);
      const security = getUserSecuritySnapshot(userId);
      logAudit(context, {
        action: "admin.user.session.revoked",
        targetType: "session",
        targetId: existingSession.id,
        summary: `下线 ${user.email} 的会话`,
        details: {
          email: user.email,
          sessionId: existingSession.id,
          ipAddress: existingSession.ip_address || "",
          userAgent: existingSession.user_agent || ""
        }
      });

      return {
        ...security,
        revokedCount: 1
      };
    },
    revokeUserSessions(userId, context = null) {
      const user = getUserOrThrow(userId);
      const revokedCount = store.listUserSessions(userId).length;
      store.deleteUserSessions(userId);
      logAudit(context, {
        action: "admin.user.sessions.revoked",
        targetType: "user",
        targetId: userId,
        summary: `下线 ${user.email} 的全部会话`,
        details: {
          email: user.email,
          revokedCount
        }
      });

      return {
        ...getUserSecuritySnapshot(userId),
        revokedCount
      };
    },
    resetUserPassword({ userId, newPassword, revokeSessions = true }, context = null) {
      const user = getUserOrThrow(userId);
      store.setUserPassword(userId, hashPassword(newPassword));

      let revokedCount = 0;
      if (revokeSessions) {
        revokedCount = store.listUserSessions(userId).length;
        store.deleteUserSessions(userId);
      }

      const security = getUserSecuritySnapshot(userId);
      logAudit(context, {
        action: "admin.user.password.reset",
        targetType: "user",
        targetId: userId,
        summary: `重置 ${user.email} 的登录密码`,
        details: {
          email: user.email,
          revokeSessions: Boolean(revokeSessions),
          revokedCount
        }
      });

      return {
        ...security,
        revokedCount
      };
    },
    triggerGlobalRefresh(context = null) {
      if (!refreshService) {
        throw badRequest("后台刷新服务不可用", { code: "refresh_service_unavailable" });
      }

      const result = refreshService.triggerRun({
        trigger: "admin_manual",
        actor: context?.actor || null
      });

      if (result.started) {
        logAudit(context, {
          action: "admin.refresh.started",
          targetType: "refresh_run",
          targetId: result.run?.id ?? null,
          summary: "手动启动全站刷新任务",
          details: {
            runId: result.run?.id ?? null,
            totalFeeds: result.run?.totalFeeds ?? 0
          }
        });
      }

      return result;
    },
    triggerMaintenance(context = null) {
      if (!maintenanceService) {
        throw badRequest("后台维护服务不可用", { code: "maintenance_service_unavailable" });
      }

      const result = maintenanceService.triggerRun({
        trigger: "admin_manual"
      });

      if (result.started) {
        logAudit(context, {
          action: "admin.maintenance.started",
          targetType: "maintenance_run",
          targetId: result.run?.id ?? null,
          summary: "手动启动系统维护任务",
          details: {
            runId: result.run?.id ?? null
          }
        });
      }

      return result;
    },
    getDatabase() {
      return getDatabaseSnapshot();
    },
    optimizeDatabase(context = null) {
      store.optimize?.();
      logAudit(context, {
        action: "admin.database.optimized",
        targetType: "database",
        targetId: "main",
        summary: "优化数据库",
        details: getDatabaseSnapshot()
      });
      return getDatabaseSnapshot();
    },
    vacuumDatabase(context = null) {
      store.vacuum?.();
      store.setSetting?.("database_vacuum", "last_vacuum_at", new Date().toISOString());
      logAudit(context, {
        action: "admin.database.vacuumed",
        targetType: "database",
        targetId: "main",
        summary: "执行数据库碎片整理",
        details: getDatabaseSnapshot()
      });
      return getDatabaseSnapshot();
    },
    async createDatabaseBackup(context = null) {
      const backupDir = getBackupDir();
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `z7rss-${stamp}.db`;
      const targetPath = path.join(backupDir, filename);
      await store.backup?.(targetPath);
      const size = getFileSize(targetPath);
      logAudit(context, {
        action: "admin.database.backup.created",
        targetType: "database_backup",
        targetId: filename,
        summary: "创建数据库备份",
        details: {
          filename,
          size
        }
      });
      return {
        path: targetPath,
        filename,
        size
      };
    },
    getDatabaseBackup(filename) {
      return getBackupPath(filename);
    },
    deleteDatabaseBackup(filename, context = null) {
      const backup = getBackupPath(filename);
      fs.rmSync(backup.path, { force: true });
      backup.deleteRelatedFiles();
      logAudit(context, {
        action: "admin.database.backup.deleted",
        targetType: "database_backup",
        targetId: backup.filename,
        summary: `删除数据库备份 ${backup.filename}`,
        details: {
          filename: backup.filename,
          size: backup.size
        }
      });
      return {
        deleted: true,
        filename: backup.filename,
        database: getDatabaseSnapshot()
      };
    },
    updateUserSubscription({ userId, planCode, currentPeriodEnd, status }, context = null) {
      const user = getUserOrThrow(userId);

      const normalizedPlanCode = String(planCode || "").trim().toLowerCase();
      const plan = store.getPlanByCode(normalizedPlanCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      const existing = store.getUserSubscription(userId);
      const nextStatus = String(status || existing?.status || "active").trim() || "active";
      const periodEnd = normalizePeriodEnd(currentPeriodEnd);

      store.setUserSubscription({
        userId,
        planId: plan.id,
        status: nextStatus,
        provider: "admin_manual",
        providerCustomerId: existing?.provider_customer_id || null,
        providerSubscriptionId: existing?.provider_subscription_id || `admin-${userId}`,
        currentPeriodStart: existing?.current_period_start || new Date().toISOString(),
        currentPeriodEnd: periodEnd
      });

      if (feedService) {
        feedService.pruneFeedsForUser(userId);
      }

      const subscription = store.getUserSubscription(userId);
      logAudit(context, {
        action: "admin.subscription.updated",
        targetType: "subscription",
        targetId: userId,
        summary: `更新 ${user.email} 的套餐为 ${subscription.plan_code}`,
        details: {
          userEmail: user.email,
          planCode: subscription.plan_code,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
        }
      });

      return {
        user: store.getUserById(userId),
        subscription,
        account: accountService.getAccount(store.getUserById(userId))
      };
    },
    updatePlanSettings(planCode, payload, context = null) {
      const normalizedPlanCode = String(planCode || "").trim().toLowerCase();
      const plan = store.getPlanByCode(normalizedPlanCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      const nextPlan = store.updatePlanSettings(normalizedPlanCode, {
        maxSavedItems:
          payload?.maxSavedItems === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxSavedItems, "总文章保留数"),
        maxFavoriteItems:
          payload?.maxFavoriteItems === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxFavoriteItems, "收藏文章上限"),
        maxFeeds:
          payload?.maxFeeds === undefined ? undefined : normalizePositiveInteger(payload.maxFeeds, "订阅源上限"),
        aiTranslationEnabled: normalizeOptionalBoolean(payload?.aiTranslationEnabled, "AI 翻译开关"),
        aiSummaryEnabled: normalizeOptionalBoolean(payload?.aiSummaryEnabled, "AI 总结开关"),
        customAiEnabled: normalizeOptionalBoolean(payload?.customAiEnabled, "自定义 AI 开关"),
        specialRoutesEnabled: normalizeOptionalBoolean(payload?.specialRoutesEnabled, "特殊路由开关"),
        aiDigestEnabled: normalizeOptionalBoolean(payload?.aiDigestEnabled, "AI 简报开关"),
        emailDigestEnabled: normalizeOptionalBoolean(payload?.emailDigestEnabled, "邮件简报开关"),
        maxDigestRules:
          payload?.maxDigestRules === undefined
            ? undefined
            : normalizePositiveInteger(payload.maxDigestRules, "简报规则上限")
      });

      if (feedService) {
        feedService.pruneAllFeeds();
      }

      logAudit(context, {
        action: "admin.plan.updated",
        targetType: "plan",
        targetId: normalizedPlanCode,
        summary: `更新套餐 ${nextPlan.name}`,
        details: {
          code: nextPlan.code,
          maxFeeds: nextPlan.max_feeds,
          maxSavedItems: nextPlan.max_saved_items,
          maxFavoriteItems: nextPlan.max_favorite_items,
          aiTranslationEnabled: Boolean(nextPlan.ai_translation_enabled),
          aiSummaryEnabled: Boolean(nextPlan.ai_summary_enabled),
          customAiEnabled: Boolean(nextPlan.custom_ai_enabled),
          specialRoutesEnabled: Boolean(nextPlan.special_routes_enabled),
          aiDigestEnabled: Boolean(nextPlan.ai_digest_enabled),
          emailDigestEnabled: Boolean(nextPlan.email_digest_enabled),
          maxDigestRules: nextPlan.max_digest_rules
        }
      });

      return nextPlan;
    },
    async reclassifyFeed(feedId, context = null, options = {}) {
      if (!feedService?.reclassifyFeed) {
        throw badRequest("订阅源分类服务不可用", { code: "classification_unavailable" });
      }
      const result = await feedService.reclassifyFeed(feedId, {
        useAi: options.useAi !== false,
        userId: context?.actor?.id || null
      });
      logAudit(context, {
        action: "admin.feed.reclassified",
        targetType: "feed",
        targetId: feedId,
        summary: `重新分类订阅源 ${result.feed.title}`,
        details: result
      });
      return result;
    },
    async reclassifyFeeds(context = null, options = {}) {
      if (!feedService?.reclassifyFeeds) {
        throw badRequest("订阅源分类服务不可用", { code: "classification_unavailable" });
      }
      const result = await feedService.reclassifyFeeds({
        useAi: options.useAi !== false,
        limit: options.limit,
        userId: context?.actor?.id || null
      });
      logAudit(context, {
        action: "admin.feeds.reclassified",
        targetType: "feed",
        targetId: "bulk",
        summary: `批量重新分类 ${result.updatedCount} 个订阅源`,
        details: result
      });
      return result;
    },
    setSettings(category, values, context = null) {
      const rows = store.listSettings();
      const current = rows.reduce((acc, row) => {
        if (!acc[row.category]) acc[row.category] = {};
        const value = isSecretSettingKey(row.key) ? secretBox.decrypt(row.value) : row.value;
        acc[row.category][row.key] = value;
        if (isSecretSettingKey(row.key)) markUnavailableSecret(acc, row.category, row.key, row.value, value);
        return acc;
      }, {});

      for (const [key, value] of Object.entries(values)) {
        let normalizedInput = String(value ?? "");
        if (isSecretSettingKey(key) && normalizedInput === "__CLEAR__") {
          store.setSetting(category, key, "");
          continue;
        }

        if (key === "configs_secret" && normalizedInput.trim()) {
          try {
            const parsed = JSON.parse(normalizedInput);
            if (Array.isArray(parsed)) {
              const hasUnavailableCurrentList = Boolean(current[category]?.configs_unavailable);
              const hasKeepPlaceholder = parsed.some((entry) => String(entry?.apiKey ?? entry?.api_key ?? "") === "__KEEP__");
              if (hasUnavailableCurrentList && (!parsed.length || hasKeepPlaceholder)) {
                throw badRequest("旧 API 列表不可用，请恢复 APP_SECRET，或重新填写 API Key 后保存新列表", {
                  code: "secret_unavailable"
                });
              }
              let currentParsed;
              try {
                currentParsed = JSON.parse(current[category]?.[key] || "[]");
              } catch (_error) {
                throw badRequest("旧 API 列表格式无效，请重新保存 API 列表", {
                  code: "invalid_provider_pool"
                });
              }
              parsed.forEach(entry => {
                if (entry.apiKey === "__KEEP__") {
                  const existing = currentParsed.find(e => e.id === entry.id);
                  entry.apiKey = existing?.apiKey || "";
                }
              });
              normalizedInput = JSON.stringify(parsed);
            }
          } catch (error) {
            if (error?.code === "secret_unavailable") throw error;
            throw badRequest("API 列表格式无效", { code: "invalid_provider_pool" });
          }
        }

        const normalizedValue =
          isSecretSettingKey(key)
            ? normalizedInput.trim()
              ? secretBox.encrypt(normalizedInput)
              : current[category]?.[key]
                ? secretBox.encrypt(current[category][key])
                : isUnavailableSecret(current, category, key)
                  ? (() => {
                      throw badRequest(`旧${getSecretSettingLabel(category, key)}不可用，请恢复 APP_SECRET，或重新填写后保存`, {
                        code: "secret_unavailable"
                      });
                    })()
                : ""
            : normalizedInput;
        store.setSetting(category, key, normalizedValue);
      }

      const settings = getSettingsMap();
      const changedKeys = Object.keys(values || {}).filter((key) => values[key] !== undefined);
      logAudit(context, {
        action: "admin.settings.updated",
        targetType: "settings",
        targetId: category,
        summary: `更新 ${category} 配置`,
        details: {
          category,
          changedKeys,
          apiKeyUpdated: changedKeys.includes("api_key")
        }
      });
      return settings;
    },
    createRedeemCode(payload, context = null) {
      const planCode = String(payload.planCode || "").trim().toLowerCase();
      const requestedCode = normalizeRedeemCode(payload.code);
      const quantity = normalizePositiveInteger(payload.quantity ?? 1, "生成数量");
      const normalizedQuantity = Math.min(Math.max(quantity, 1), 200);
      const expiresAt = payload.expiresAt || null;
      const note = String(payload.note || "");
      const prefix = String(payload.prefix || "");
      const batchId = createRedeemBatchId();

      if (!planCode) {
        throw badRequest("套餐代码不能为空，可用值：free / pro / team", { code: "plan_code_required" });
      }
      if (requestedCode && normalizedQuantity > 1) {
        throw badRequest("填写指定兑换码时只能生成 1 个", { code: "redeem_code_quantity_conflict" });
      }

      const plan = store.getPlanByCode(planCode);
      if (!plan) {
        throw badRequest("套餐代码无效，可用值：free / pro / team", { code: "invalid_plan_code" });
      }

      if (requestedCode && store.getRedeemCode(requestedCode)) {
        throw conflict("兑换码已存在，请换一个", { code: "redeem_code_exists" });
      }

      const redeemCodes = [];
      const seenCodes = new Set();
      for (let index = 0; index < normalizedQuantity; index += 1) {
        let code = index === 0 && requestedCode ? requestedCode : "";
        for (let attempt = 0; !code || store.getRedeemCode(code) || seenCodes.has(code); attempt += 1) {
          if (attempt > 20) {
            throw conflict("兑换码生成失败，请稍后重试", { code: "redeem_code_generation_failed" });
          }
          code = generateRedeemCode(prefix);
        }
        seenCodes.add(code);
        redeemCodes.push(store.createRedeemCode({
          code,
          batchId,
          planId: plan.id,
          maxUses: 1,
          expiresAt,
          isActive: payload.isActive === false ? 0 : 1,
          note
        }));
      }

      logAudit(context, {
        action: "admin.redeem-code.created",
        targetType: "redeem_code",
        targetId: redeemCodes.length === 1 ? redeemCodes[0].id : "batch",
        summary: redeemCodes.length === 1 ? `创建售卖兑换码 ${redeemCodes[0].code}` : `批量创建 ${redeemCodes.length} 个售卖兑换码`,
        details: {
          codes: redeemCodes.map((entry) => entry.code),
          batchId,
          planCode,
          maxUses: 1,
          expiresAt,
          isActive: redeemCodes.every((entry) => Boolean(entry.is_active))
        }
      });
      return {
        batchId,
        redeemCodes,
        redeemCode: redeemCodes[0] || null
      };
    },
    updateRedeemCode(payload, context = null) {
      const existing = store.listRedeemCodes().find((entry) => Number(entry.id) === Number(payload.id));
      if (!existing) {
        throw notFound("兑换码不存在", { code: "redeem_code_not_found" });
      }

      store.updateRedeemCode({
        id: Number(payload.id),
        isActive: payload.isActive ? 1 : 0,
        expiresAt: payload.expiresAt || null,
        note: String(payload.note || "")
      });

      const redeemCodes = store.listRedeemCodes();
      const updated = redeemCodes.find((entry) => Number(entry.id) === Number(payload.id)) || existing;
      logAudit(context, {
        action: "admin.redeem-code.updated",
        targetType: "redeem_code",
        targetId: updated.id,
        summary: `更新兑换码 ${updated.code}`,
        details: {
          code: updated.code,
          maxUses: 1,
          expiresAt: updated.expires_at,
          isActive: Boolean(updated.is_active)
        }
      });
      return redeemCodes;
    },
    deleteRedeemCode(id, context = null) {
      const existing = getRedeemCodeById(id);
      if (!existing) {
        throw notFound("兑换码不存在", { code: "redeem_code_not_found" });
      }
      if (Number(existing.used_count || 0) > 0) {
        throw conflict("已兑换的兑换码不能删除", { code: "redeem_code_used" });
      }

      const deletedCount = store.deleteRedeemCode(existing.id);
      if (deletedCount < 1) {
        throw conflict("兑换码已被使用，不能删除", { code: "redeem_code_used" });
      }
      logAudit(context, {
        action: "admin.redeem-code.deleted",
        targetType: "redeem_code",
        targetId: existing.id,
        summary: `删除兑换码 ${existing.code}`,
        details: {
          code: existing.code,
          batchId: getRedeemBatchId(existing),
          planCode: existing.plan_code
        }
      });
      return {
        deleted: true,
        deletedCount,
        redeemCodes: store.listRedeemCodes()
      };
    },
    deleteRedeemCodeBatch(batchId, context = null) {
      const codes = getRedeemBatch(batchId);
      if (!codes.length) {
        throw notFound("兑换码批次不存在", { code: "redeem_code_batch_not_found" });
      }

      const usedCount = codes.filter((entry) => Number(entry.used_count || 0) > 0).length;
      const deletedCount = store.deleteRedeemCodeBatch(batchId);
      logAudit(context, {
        action: "admin.redeem-code.batch-deleted",
        targetType: "redeem_code_batch",
        targetId: batchId,
        summary: `删除兑换码批次 ${codes[0]?.note || batchId}`,
        details: {
          batchId,
          deletedCount,
          retainedUsedCount: usedCount,
          totalCount: codes.length,
          codes: codes.map((entry) => entry.code)
        }
      });
      return {
        deleted: deletedCount > 0,
        deletedCount,
        retainedUsedCount: usedCount,
        redeemCodes: store.listRedeemCodes()
      };
    },
    redeemCodeForUser(userId, code) {
      const redeemCode = store.getRedeemCode(String(code || "").trim().toUpperCase());
      if (!redeemCode || !redeemCode.is_active) {
        throw badRequest("兑换码无效", { code: "redeem_code_invalid" });
      }
      if (redeemCode.expires_at && new Date(redeemCode.expires_at).getTime() < Date.now()) {
        throw badRequest("兑换码已过期", { code: "redeem_code_expired" });
      }
      if (redeemCode.used_count >= 1) {
        throw conflict("兑换码已用完", { code: "redeem_code_exhausted" });
      }
      try {
        store.useRedeemCode(redeemCode.id, userId);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw conflict("你已经使用过这个兑换码", { code: "redeem_code_already_used" });
        }
        throw error;
      }
      store.setUserSubscription({
        userId,
        planId: redeemCode.plan_id,
        status: "active",
        provider: "redeem_code",
        providerCustomerId: null,
        providerSubscriptionId: redeemCode.code,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: null
      });
      store.createBillingEvent({
        userId,
        planId: redeemCode.plan_id,
        provider: "redeem_code",
        providerCheckoutId: redeemCode.code,
        status: "paid",
        amountCents: 0,
        currency: "usd",
        checkoutUrl: null
      });
      if (feedService) {
        feedService.pruneFeedsForUser(userId);
      }
      return accountService.getAccount(store.getUserById(userId));
    },
    upsertPlugin(payload, context = null) {
      const code = String(payload.code || "").trim();
      const existing = store.listPlugins().find((entry) => entry.code === code) || null;
      const plugin = store.upsertPlugin({
        code,
        name: String(payload.name || "").trim(),
        description: String(payload.description || "").trim(),
        configJson: JSON.stringify(payload.config || {}),
        isEnabled: payload.isEnabled ? 1 : 0
      });
      logAudit(context, {
        action: existing ? "admin.plugin.updated" : "admin.plugin.created",
        targetType: "plugin",
        targetId: plugin.code,
        summary: `${existing ? "更新" : "创建"}插件 ${plugin.name}`,
        details: {
          code: plugin.code,
          name: plugin.name,
          isEnabled: Boolean(plugin.is_enabled)
        }
      });
      return plugin;
    },
    createContentRule(payload, context = null) {
      const rule = store.createContentRule({
        kind: String(payload.kind || "title"),
        pattern: String(payload.pattern || "").trim(),
        action: String(payload.action || "block"),
        isActive: payload.isActive === false ? 0 : 1
      });
      logAudit(context, {
        action: "admin.content-rule.created",
        targetType: "content_rule",
        targetId: rule.id,
        summary: `新增内容规则 ${rule.kind}:${rule.pattern}`,
        details: {
          kind: rule.kind,
          pattern: rule.pattern,
          action: rule.action,
          isActive: Boolean(rule.is_active)
        }
      });
      return rule;
    },
    toggleContentRule(id, isActive, context = null) {
      const existing = store.listContentRules().find((entry) => Number(entry.id) === Number(id));
      if (!existing) {
        throw notFound("规则不存在", { code: "content_rule_not_found" });
      }

      store.setContentRuleActive(id, isActive);
      const rules = store.listContentRules();
      const updated = rules.find((entry) => Number(entry.id) === Number(id)) || existing;
      logAudit(context, {
        action: "admin.content-rule.toggled",
        targetType: "content_rule",
        targetId: updated.id,
        summary: `${updated.is_active ? "启用" : "停用"}内容规则 ${updated.kind}:${updated.pattern}`,
        details: {
          kind: updated.kind,
          pattern: updated.pattern,
          isActive: Boolean(updated.is_active)
        }
      });
      return rules;
    },
    setBlockedSite(payload, context = null) {
      const domain = String(payload.domain || "").trim().toLowerCase();
      const existing = store.listBlockedSites().find((entry) => entry.domain === domain) || null;

      store.setBlockedSite({
        domain,
        reason: String(payload.reason || ""),
        isActive: payload.isActive === false ? 0 : 1
      });

      const blockedSites = store.listBlockedSites();
      const updated = blockedSites.find((entry) => entry.domain === domain) || existing;
      logAudit(context, {
        action: existing ? "admin.blocked-site.updated" : "admin.blocked-site.created",
        targetType: "blocked_site",
        targetId: domain,
        summary: `${existing ? "更新" : "新增"}网站屏蔽 ${domain}`,
        details: {
          domain,
          reason: updated?.reason || "",
          isActive: Boolean(updated?.is_active)
        }
      });
      return blockedSites;
    },
    setBlockedIp(payload, context = null) {
      const ip = normalizeIp(payload.ip);
      const existing = store.listBlockedIps().find((entry) => normalizeIp(entry.ip) === ip) || null;

      store.setBlockedIp({
        ip,
        reason: String(payload.reason || ""),
        isActive: payload.isActive === false ? 0 : 1
      });

      const blockedIps = store.listBlockedIps();
      const updated = blockedIps.find((entry) => normalizeIp(entry.ip) === ip) || existing;
      logAudit(context, {
        action: existing ? "admin.blocked-ip.updated" : "admin.blocked-ip.created",
        targetType: "blocked_ip",
        targetId: ip,
        summary: `${existing ? "更新" : "新增"} IP 屏蔽 ${ip}`,
        details: {
          ip,
          reason: updated?.reason || "",
          isActive: Boolean(updated?.is_active)
        }
      });
      return blockedIps;
    },
    isBlockedIp(ip) {
      const requestIp = normalizeIp(ip);
      return store.listBlockedIps().some((entry) => entry.is_active && normalizeIp(entry.ip) === requestIp);
    },
    exportUserData(userId) {
      const user = store.getUserById(userId);
      if (!user) throw notFound("用户不存在");
      const settings = store.listUserSettings(userId).map((row) => ({
        category: row.category,
        key: row.key,
        value: isSecretSettingKey(row.key) ? "" : row.value
      }));
      const feeds = store.listUserFeeds(userId).map((feed) => ({
        title: feed.title,
        url: feed.url,
        site_url: feed.site_url || "",
        category: feed.category || "",
        custom_title: feed.custom_title || "",
        is_archived: feed.is_archived || 0,
        is_collapsed: feed.is_collapsed || 0,
        is_public: feed.is_public || 0
      }));
      const digestRules = (store.listDigestRulesByUser ? store.listDigestRulesByUser(userId) : []).map((rule) => ({
        name: rule.name,
        isEnabled: Boolean(rule.is_enabled),
        sendTime: rule.send_time,
        timezone: rule.timezone,
        recipientEmails: parseJsonSafe(rule.recipient_emails, []),
        aiSource: rule.ai_source,
        prompt: rule.prompt,
        lookbackHours: Number(rule.lookback_hours || 24),
        unreadOnly: Boolean(rule.unread_only),
        feedScope: rule.feed_scope,
        feedIds: parseJsonSafe(rule.feed_ids_json, []),
        category: rule.category || ""
      }));
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        user: {
          email: user.email,
          displayName: user.display_name || ""
        },
        settings,
        feeds,
        digestRules
      };
    },
    importUserData(userId, data, context = null) {
      const user = store.getUserById(userId);
      if (!user) throw notFound("用户不存在");
      if (!data || data.version !== 1) throw badRequest("导入数据格式无效");
      let feedsImported = 0;
      let settingsImported = 0;
      let digestImported = 0;
      if (Array.isArray(data.feeds)) {
        for (const feed of data.feeds) {
          const url = String(feed.url || "").trim();
          if (!url) continue;
          try {
            feedService.addFeed(userId, { title: String(feed.title || ""), url });
            feedsImported += 1;
          } catch (_error) {
            // skip duplicate or invalid feeds
          }
        }
      }
      if (Array.isArray(data.settings)) {
        for (const setting of data.settings) {
          const category = String(setting.category || "").trim();
          const key = String(setting.key || "").trim();
          const value = String(setting.value ?? "").trim();
          if (!category || !key || isSecretSettingKey(key) || !value) continue;
          store.setUserSetting(userId, category, key, value);
          settingsImported += 1;
        }
      }
      if (Array.isArray(data.digestRules) && store.createDigestRule) {
        for (const rule of data.digestRules) {
          try {
            store.createDigestRule({
              userId,
              name: String(rule.name || "每日简报").trim().slice(0, 80),
              isEnabled: rule.isEnabled !== false ? 1 : 0,
              sendTime: String(rule.sendTime || "09:00").trim(),
              timezone: String(rule.timezone || "Asia/Shanghai").trim().slice(0, 80),
              recipientEmails: JSON.stringify(Array.isArray(rule.recipientEmails) ? rule.recipientEmails : []),
              aiSource: String(rule.aiSource || "system"),
              prompt: String(rule.prompt || "").trim().slice(0, 4000),
              lookbackHours: Number(rule.lookbackHours || 24),
              unreadOnly: rule.unreadOnly ? 1 : 0,
              feedScope: String(rule.feedScope || "all"),
              feedIdsJson: JSON.stringify(Array.isArray(rule.feedIds) ? rule.feedIds : []),
              category: rule.category || null
            });
            digestImported += 1;
          } catch (_error) {
            // skip invalid rules
          }
        }
      }
      logAudit(context, {
        action: "admin.user-data.imported",
        targetType: "user",
        targetId: userId,
        summary: `导入用户数据：${feedsImported} 订阅源，${settingsImported} 配置，${digestImported} 简报规则`,
        details: { feedsImported, settingsImported, digestImported }
      });
      return { feedsImported, settingsImported, digestImported };
    }
  };
}
