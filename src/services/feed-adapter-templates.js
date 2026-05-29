import { badRequest } from "../lib/errors.js";

const TEMPLATE_CATEGORY = "feed_adapter_templates";
const TEMPLATE_KEY = "templates_json";
const LEGACY_ZHIHU_HOT_API_URL = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true";
const LEGACY_ZHIHU_HOT_TEMPLATE_URLS = new Set([
  LEGACY_ZHIHU_HOT_API_URL,
  "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50",
  "https://www.zhihu.com/hot",
  "https://zhihu.com/hot",
  "{rawUrl}"
]);
export const defaultFeedAdapterTemplates = [
  {
    id: "zhihu-hot-json",
    name: "知乎热榜 内置",
    enabled: true,
    match: "^https://www\\.zhihu\\.com/hot/?$|^https://zhihu\\.com/hot/?$",
    feedUrl: "builtin://zhihu/hot",
    feedFormat: "auto",
    requestProfile: "browser"
  },
  {
    id: "hani-china-list-html",
    name: "韩民族日报中文网 列表",
    enabled: true,
    match: "^https?://china\\.hani\\.co\\.kr/arti(?:/(?:RSS|politics|economy|international|northkorea|culture|opinion|multimedia|jejuand))?/?(?:\\?.*)?$",
    feedUrl: "{rawUrl}",
    feedFormat: "html",
    requestProfile: "browser",
    htmlItemsSelector: ".comm-fixed.fixed-left > ul > li",
    htmlTitleSelector: ".article-tit",
    htmlLinkSelector: "a[href]",
    htmlDateSelector: ".article-time",
    htmlSummarySelector: ".article-txt",
    htmlContentSelector: ".article-txt"
  }
];

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function mergeDefaultTemplate(raw = {}) {
  const id = String(raw?.id || raw?.code || "").trim();
  const defaults = defaultFeedAdapterTemplates.find((entry) => entry.id === id);
  if (id === "zhihu-hot-json" && defaults) {
    const feedUrl = String(raw.feedUrl || raw.feed_url || "").trim();
    const feedFormat = String(raw.feedFormat || raw.feed_format || "").toLowerCase();
    const isLegacyDefault = LEGACY_ZHIHU_HOT_TEMPLATE_URLS.has(feedUrl) || (feedFormat === "json" && !feedUrl);
    if (isLegacyDefault) {
      return {
        ...raw,
        name: raw.name && !/^知乎热榜\s+(JSON|HTML)$/i.test(String(raw.name).trim()) ? raw.name : defaults.name,
        feedUrl: defaults.feedUrl,
        feedFormat: defaults.feedFormat,
        requestProfile: raw.requestProfile || raw.request_profile || defaults.requestProfile
      };
    }
  }
  return defaults ? { ...defaults, ...raw } : raw;
}

function maybeDecryptCookie(template = {}, secretBox = null) {
  if (!secretBox?.decrypt || !template.cookie) return template;
  return {
    ...template,
    cookie: secretBox.decrypt(template.cookie)
  };
}

function maybeEncryptCookie(template = {}, secretBox = null) {
  if (!secretBox?.encrypt || !template.cookie) return template;
  return {
    ...template,
    cookie: secretBox.encrypt(template.cookie)
  };
}

function toRegExp(pattern = "", options = {}) {
  const raw = String(pattern || "").trim();
  if (!raw) return null;
  try {
    return new RegExp(raw, "i");
  } catch (_error) {
    if (options.throwOnInvalid) {
      throw badRequest(`抓取模板 ${options.templateName || "未命名"} 的匹配规则不是有效正则`, {
        code: "feed_adapter_template_invalid"
      });
    }
    return null;
  }
}

export function normalizeFeedAdapterTemplate(raw = {}, index = 0) {
  raw = mergeDefaultTemplate(raw);
  const id = String(raw.id || raw.code || `template-${index + 1}`).trim().slice(0, 100) || `template-${index + 1}`;
  const requestMethod = String(raw.requestMethod || raw.request_method || raw.method || "GET").trim().toUpperCase();
  const template = {
    id,
    name: String(raw.name || id).trim().slice(0, 120) || id,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    match: String(raw.match || raw.urlPattern || "").trim().slice(0, 1000),
    feedUrl: String(raw.feedUrl || raw.feed_url || "").trim().slice(0, 2000),
    requestMethod,
    requestBody: String(raw.requestBody || raw.request_body || raw.body || "").trim().slice(0, 20000),
    feedFormat: String(raw.feedFormat || raw.feed_format || "json").trim().toLowerCase(),
    requestProfile: String(raw.requestProfile || raw.request_profile || "browser").trim().toLowerCase(),
    cookie: String(raw.cookie || raw.sharedCookie || raw.shared_cookie || "").trim().slice(0, 20000),
    htmlItemsSelector: String(raw.htmlItemsSelector || raw.html_items_selector || "").trim().slice(0, 500),
    htmlTitleSelector: String(raw.htmlTitleSelector || raw.html_title_selector || "").trim().slice(0, 500),
    htmlLinkSelector: String(raw.htmlLinkSelector || raw.html_link_selector || "").trim().slice(0, 500),
    htmlDateSelector: String(raw.htmlDateSelector || raw.html_date_selector || "").trim().slice(0, 500),
    htmlSummarySelector: String(raw.htmlSummarySelector || raw.html_summary_selector || "").trim().slice(0, 500),
    htmlContentSelector: String(raw.htmlContentSelector || raw.html_content_selector || "").trim().slice(0, 500),
    jsonItemsPath: String(raw.jsonItemsPath || raw.json_items_path || "").trim().slice(0, 240),
    jsonTitlePath: String(raw.jsonTitlePath || raw.json_title_path || "").trim().slice(0, 240),
    jsonLinkPath: String(raw.jsonLinkPath || raw.json_link_path || "").trim().slice(0, 240),
    jsonDatePath: String(raw.jsonDatePath || raw.json_date_path || "").trim().slice(0, 240),
    jsonSummaryPath: String(raw.jsonSummaryPath || raw.json_summary_path || "").trim().slice(0, 240),
    jsonContentPath: String(raw.jsonContentPath || raw.json_content_path || "").trim().slice(0, 240)
  };
  if (!template.match) {
    throw badRequest(`抓取模板 ${template.name} 缺少匹配规则`, { code: "feed_adapter_template_invalid" });
  }
  if (!template.feedUrl) {
    throw badRequest(`抓取模板 ${template.name} 缺少备用 Feed 地址`, { code: "feed_adapter_template_invalid" });
  }
  toRegExp(template.match, { throwOnInvalid: true, templateName: template.name });
  if (!new Set(["auto", "rss", "atom", "json", "html"]).has(template.feedFormat)) template.feedFormat = "json";
  if (!new Set(["auto", "browser", "bot"]).has(template.requestProfile)) template.requestProfile = "browser";
  if (!new Set(["GET", "POST"]).has(template.requestMethod)) template.requestMethod = "GET";
  return template;
}

export function getFeedAdapterTemplates(store, secretBox = null) {
  const row = store.getSetting?.(TEMPLATE_CATEGORY, TEMPLATE_KEY);
  const custom = parseJsonSafe(row?.value || "", null);
  const source = Array.isArray(custom) ? [...custom] : [...defaultFeedAdapterTemplates];
  if (Array.isArray(custom)) {
    const customIds = new Set(source.map((entry) => String(entry?.id || entry?.code || "").trim()).filter(Boolean));
    for (const template of defaultFeedAdapterTemplates) {
      if (!customIds.has(template.id)) source.push(template);
    }
  }
  return source.map((entry, index) => normalizeFeedAdapterTemplate(maybeDecryptCookie(mergeDefaultTemplate(entry), secretBox), index));
}

export function setFeedAdapterTemplates(store, templates = [], secretBox = null) {
  const seen = new Set();
  const normalized = (Array.isArray(templates) ? templates : []).map((entry, index) => {
    const template = normalizeFeedAdapterTemplate(entry, index);
    if (seen.has(template.id)) {
      throw badRequest(`抓取模板 ID 重复: ${template.id}`, { code: "feed_adapter_template_invalid" });
    }
    seen.add(template.id);
    return template;
  });
  store.setSetting(TEMPLATE_CATEGORY, TEMPLATE_KEY, JSON.stringify(normalized.map((entry) => maybeEncryptCookie(entry, secretBox))));
  return normalized;
}

function expandTemplateFeedUrl(templateUrl = "", inputUrl = "", match = []) {
  const withNamedTokens = String(templateUrl || "")
    .replaceAll("{url}", encodeURIComponent(inputUrl))
    .replaceAll("{rawUrl}", inputUrl);
  return withNamedTokens.replace(/\$(\$|&|\d{1,2})/g, (_token, key) => {
    if (key === "$") return "$";
    if (key === "&") return match[0] || "";
    return match[Number(key)] || "";
  });
}

export function resolveFeedAdapterTemplate(inputUrl = "", template = {}) {
  const rawUrl = String(inputUrl || "").trim();
  if (!rawUrl || !template?.enabled) return null;
  const pattern = toRegExp(template.match);
  if (!pattern) return null;
  const match = rawUrl.match(pattern);
  if (!match) return null;
  return {
    ...template,
    feedUrl: expandTemplateFeedUrl(template.feedUrl, rawUrl, match)
  };
}

export function findFeedAdapterTemplate(inputUrl = "", templates = []) {
  const rawUrl = String(inputUrl || "").trim();
  if (!rawUrl) return null;
  for (const template of templates || []) {
    const resolved = resolveFeedAdapterTemplate(rawUrl, template);
    if (resolved) return resolved;
  }
  return null;
}

export function templateToFetchSettings(template = {}) {
  return {
    feedUrl: template.feedUrl,
    requestMethod: template.requestMethod || "GET",
    requestBody: template.requestBody || "",
    feedFormat: template.feedFormat || "json",
    fetchRequestProfile: template.requestProfile || "browser",
    fetchCookie: template.cookie || undefined,
    fetchHtmlItemsSelector: template.htmlItemsSelector || "",
    fetchHtmlTitleSelector: template.htmlTitleSelector || "",
    fetchHtmlLinkSelector: template.htmlLinkSelector || "",
    fetchHtmlDateSelector: template.htmlDateSelector || "",
    fetchHtmlSummarySelector: template.htmlSummarySelector || "",
    fetchHtmlContentSelector: template.htmlContentSelector || "",
    fetchJsonItemsPath: template.jsonItemsPath || "",
    fetchJsonTitlePath: template.jsonTitlePath || "",
    fetchJsonLinkPath: template.jsonLinkPath || "",
    fetchJsonDatePath: template.jsonDatePath || "",
    fetchJsonSummaryPath: template.jsonSummaryPath || "",
    fetchJsonContentPath: template.jsonContentPath || ""
  };
}

export function templateToRuntimeOptions(baseOptions = {}, template = {}) {
  return {
    ...baseOptions,
    requestProfile: template.requestProfile || baseOptions.requestProfile,
    requestMethod: template.requestMethod || baseOptions.requestMethod || "GET",
    requestBody: template.requestBody || baseOptions.requestBody || "",
    feedFormat: template.feedFormat || "json",
    cookie: template.cookie || baseOptions.cookie || "",
    htmlItemsSelector: template.htmlItemsSelector || "",
    htmlTitleSelector: template.htmlTitleSelector || "",
    htmlLinkSelector: template.htmlLinkSelector || "",
    htmlDateSelector: template.htmlDateSelector || "",
    htmlSummarySelector: template.htmlSummarySelector || "",
    htmlContentSelector: template.htmlContentSelector || "",
    jsonItemsPath: template.jsonItemsPath || "",
    jsonTitlePath: template.jsonTitlePath || "",
    jsonLinkPath: template.jsonLinkPath || "",
    jsonDatePath: template.jsonDatePath || "",
    jsonSummaryPath: template.jsonSummaryPath || "",
    jsonContentPath: template.jsonContentPath || ""
  };
}
