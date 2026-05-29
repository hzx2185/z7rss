import { badRequest } from "../lib/errors.js";
import { findFeedAdapterTemplate, templateToFetchSettings, templateToRuntimeOptions } from "./feed-adapter-templates.js";
import { matchBuiltinFeedInput } from "./builtin-feeds.js";

const MAX_DISCOVERY_CANDIDATES = 28;
const COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml"];
const UNSUPPORTED_FEED_CODES = new Set(["unsupported_feed_format", "feed_json_invalid"]);
const ALTERNATIVE_FEED_CODES = new Set([
  ...UNSUPPORTED_FEED_CODES,
  "feed_request_failed",
  "feed_request_access_challenge"
]);

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeHttpUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function normalizeInputUrl(value = "") {
  const raw = String(value || "").trim();
  if (/^builtin:\/\//i.test(raw)) return raw;
  return normalizeHttpUrl(raw);
}

export function parseRssHubBaseUrlList(value = "") {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeRssHubBaseUrls(value = "") {
  const seen = new Set();
  const urls = [];
  for (const entry of parseRssHubBaseUrlList(value)) {
    const normalized = normalizeHttpUrl(entry).replace(/\/+$/, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

export function inferRssHubBaseUrlsFromFeeds(feeds = []) {
  const bases = [];
  for (const feed of feeds || []) {
    try {
      const url = new URL(String(feed?.url || "").trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (/rsshub/i.test(url.hostname)) {
        bases.push(url.origin);
      } else if (parts[0] && /rsshub/i.test(parts[0])) {
        bases.push(`${url.origin}/${parts[0]}`);
      }
    } catch (_error) {
      // Ignore malformed saved feeds while inferring optional RSSHub bases.
    }
  }
  return normalizeRssHubBaseUrls(bases);
}

function normalizeCandidateUrl(value = "", baseUrl = "") {
  const direct = normalizeHttpUrl(value);
  if (direct) return direct;
  if (!baseUrl) return "";
  try {
    return normalizeHttpUrl(new URL(String(value || "").trim(), baseUrl).toString());
  } catch (_error) {
    return "";
  }
}

function addCandidate(candidates, seen, candidate = {}, baseUrl = "") {
  const url = normalizeCandidateUrl(candidate.url, baseUrl);
  if (!url || seen.has(url)) return;
  seen.add(url);
  candidates.push({
    url,
    source: candidate.source || "discovered",
    confidence: candidate.confidence || "medium",
    title: normalizeText(candidate.title || ""),
    type: normalizeText(candidate.type || ""),
    route: normalizeText(candidate.route || "")
  });
}

function buildCommonFeedCandidates(inputUrl) {
  const candidates = [];
  let url;
  try {
    url = new URL(inputUrl);
  } catch (_error) {
    return candidates;
  }

  for (const path of COMMON_FEED_PATHS) {
    candidates.push({ url: new URL(path, url.origin).toString(), source: "common_path", confidence: "low" });
  }

  const currentPath = url.pathname.replace(/\/+$/, "");
  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length > 0 && segments.length <= 3) {
    candidates.push({ url: new URL(`${currentPath}/feed`, url.origin).toString(), source: "common_path", confidence: "low" });
    candidates.push({ url: new URL(`${currentPath}.rss`, url.origin).toString(), source: "common_path", confidence: "low" });
    candidates.push({ url: new URL(`${currentPath}.atom`, url.origin).toString(), source: "common_path", confidence: "low" });
  }

  return candidates;
}

function getPathSegments(url) {
  return url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (_error) {
        return part;
      }
    });
}

function buildKnownNativeCandidates(inputUrl) {
  const candidates = [];
  let url;
  try {
    url = new URL(inputUrl);
  } catch (_error) {
    return candidates;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const parts = getPathSegments(url);
  if ((host === "youtube.com" || host === "m.youtube.com") && parts[0] === "channel" && parts[1]) {
    const feedUrl = new URL("https://www.youtube.com/feeds/videos.xml");
    feedUrl.searchParams.set("channel_id", parts[1]);
    candidates.push({ url: feedUrl.toString(), source: "known_native", confidence: "high" });
  }
  const playlistId = url.searchParams.get("list");
  if ((host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") && playlistId) {
    const feedUrl = new URL("https://www.youtube.com/feeds/videos.xml");
    feedUrl.searchParams.set("playlist_id", playlistId);
    candidates.push({ url: feedUrl.toString(), source: "known_native", confidence: "high" });
  }

  if (host === "github.com" && parts[0] && parts[1]) {
    const owner = encodeURIComponent(parts[0]);
    const repo = encodeURIComponent(parts[1]);
    candidates.push({ url: `https://github.com/${owner}/${repo}/releases.atom`, source: "known_native", confidence: "medium" });
    candidates.push({ url: `https://github.com/${owner}/${repo}/commits.atom`, source: "known_native", confidence: "medium" });
  }

  if (host === "medium.com" && parts.length) {
    candidates.push({ url: new URL(`/feed/${parts.join("/")}`, url.origin).toString(), source: "known_native", confidence: "medium" });
  }

  if (host.endsWith(".substack.com")) {
    candidates.push({ url: new URL("/feed", url.origin).toString(), source: "known_native", confidence: "high" });
  }

  return candidates;
}

function isReservedSocialPath(value = "") {
  return new Set([
    "about",
    "explore",
    "hashtag",
    "home",
    "i",
    "intent",
    "login",
    "notifications",
    "privacy",
    "search",
    "settings",
    "share",
    "tos"
  ]).has(String(value || "").toLowerCase());
}

function buildRssHubRoutes(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch (_error) {
    return [];
  }

  const routes = [];
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const parts = getPathSegments(url);
  const addRoute = (segments, title = "") => {
    if (!segments.every(Boolean)) return;
    const key = segments.join("/");
    if (routes.some((route) => route.segments.join("/") === key)) return;
    routes.push({ segments, title });
  };

  if (host === "space.bilibili.com" && /^\d+$/.test(parts[0] || "")) {
    addRoute(["bilibili", "user", "video", parts[0]], "Bilibili 视频");
    addRoute(["bilibili", "user", "dynamic", parts[0]], "Bilibili 动态");
  }

  if (host === "weibo.com" || host === "m.weibo.cn") {
    const uid = parts[0] === "u" ? parts[1] : parts.find((part) => /^\d{4,}$/.test(part));
    if (uid) addRoute(["weibo", "user", uid], "微博用户");
  }

  if ((host === "twitter.com" || host === "x.com" || host === "mobile.twitter.com") && parts[0] && !isReservedSocialPath(parts[0])) {
    addRoute(["twitter", "user", parts[0].replace(/^@/, "")], "Twitter 用户");
  }

  if (host === "t.me" && parts[0]) {
    const channel = parts[0] === "s" ? parts[1] : parts[0];
    if (channel && !isReservedSocialPath(channel)) addRoute(["telegram", "channel", channel.replace(/^@/, "")], "Telegram 频道");
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const playlistId = url.searchParams.get("list");
    if (playlistId) addRoute(["youtube", "playlist", playlistId], "YouTube 播放列表");
    if (parts[0] === "channel" && parts[1]) addRoute(["youtube", "channel", parts[1]], "YouTube 频道");
    if ((parts[0] === "user" || parts[0] === "c") && parts[1]) addRoute(["youtube", "user", parts[1]], "YouTube 用户");
    if (parts[0]?.startsWith("@")) {
      addRoute(["youtube", "user", parts[0].slice(1)], "YouTube 用户");
      addRoute(["youtube", "user", parts[0]], "YouTube 用户");
    }
  }

  if (host === "github.com" && parts[0] && parts[1]) {
    if (parts.includes("releases")) addRoute(["github", "release", parts[0], parts[1]], "GitHub Releases");
    if (parts.includes("issues")) addRoute(["github", "issue", parts[0], parts[1]], "GitHub Issues");
    if (parts.includes("pulls") || parts.includes("pull")) addRoute(["github", "pull", parts[0], parts[1]], "GitHub Pull Requests");
  }

  if (host === "zhihu.com" && parts[0] === "people" && parts[1]) {
    addRoute(["zhihu", "people", "activities", parts[1]], "知乎动态");
  }
  if (host === "zhihu.com" && (!parts[0] || parts[0] === "hot")) {
    addRoute(["zhihu", "hot"], "知乎热榜");
  }

  if (host === "gelonghui.com" && (!parts[0] || parts[0] === "hot-article")) {
    addRoute(["gelonghui", "hot-article"], "格隆汇最热文章");
  }

  return routes;
}

function buildRssHubUrl(baseUrl, segments = []) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const routePath = segments.map((segment) => encodeURIComponent(String(segment))).join("/");
  url.pathname = [basePath, routePath].filter(Boolean).join("/").replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildRssHubCandidates(inputUrl, baseUrls = []) {
  const routes = buildRssHubRoutes(inputUrl);
  const bases = normalizeRssHubBaseUrls(baseUrls);
  const candidates = [];
  for (const baseUrl of bases) {
    for (const route of routes) {
      candidates.push({
        url: buildRssHubUrl(baseUrl, route.segments),
        source: "rsshub",
        confidence: "medium",
        baseUrl,
        title: route.title,
        route: route.segments.join("/")
      });
    }
  }
  return candidates;
}

function getErrorCode(error) {
  return String(error?.code || error?.cause?.code || "").trim();
}

function isUnsupportedFeedError(error) {
  return UNSUPPORTED_FEED_CODES.has(getErrorCode(error));
}

function shouldTryJsonMapping(error) {
  const code = getErrorCode(error);
  return code === "unsupported_feed_format" || code === "feed_request_failed" || code === "feed_request_access_challenge";
}

function shouldTryAlternativeFeeds(error) {
  return ALTERNATIVE_FEED_CODES.has(getErrorCode(error));
}

async function tryFetchFeed(fetchFeed, candidate, runtimeOptions) {
  try {
    const result = await fetchFeed(candidate.url, runtimeOptions);
    return { ok: true, candidate, result };
  } catch (error) {
    return { ok: false, candidate, error };
  }
}

function summarizeErrors(errors = []) {
  return errors
    .map((entry) => `${entry.candidate?.url || "unknown"}: ${entry.error?.message || "读取失败"}`)
    .slice(0, 5);
}

export async function resolveFeedInput(inputUrl, options = {}) {
  const feedUrl = normalizeInputUrl(inputUrl);
  if (!feedUrl) {
    throw badRequest("Feed URL 格式无效", { code: "feed_url_invalid" });
  }
  if (typeof options.fetchFeed !== "function") {
    throw new TypeError("resolveFeedInput requires fetchFeed");
  }

  const runtimeOptions = {
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
    requestProfile: options.requestProfile || "auto"
  };

  const matchedTemplate = findFeedAdapterTemplate(feedUrl, options.feedAdapterTemplates || []);
  if (matchedTemplate) {
    const mappingAttempt = await tryFetchFeed(
      options.fetchFeed,
      { url: matchedTemplate.feedUrl, source: "adapter_template", confidence: "high" },
      templateToRuntimeOptions(runtimeOptions, matchedTemplate)
    );
    const templateResult = {
      inputUrl: feedUrl,
      feedUrl,
      source: "adapter_template",
      confidence: "high",
      candidateTitle: matchedTemplate.name || "",
      itemCount: mappingAttempt.ok && Array.isArray(mappingAttempt.result.items) ? mappingAttempt.result.items.length : 0,
      meta: mappingAttempt.ok && mappingAttempt.result.meta?.title
        ? mappingAttempt.result.meta
        : {
            title: matchedTemplate.name || feedUrl,
            siteUrl: feedUrl,
            description: "抓取模板生成的订阅源"
          },
      fetchSettings: templateToFetchSettings(matchedTemplate),
      adapterTemplateId: matchedTemplate.id,
      discoveryError: mappingAttempt.ok ? "" : mappingAttempt.error?.message || "抓取模板测试失败",
      discoveryErrorCode: mappingAttempt.ok ? "" : getErrorCode(mappingAttempt.error)
    };
    if (mappingAttempt.ok) return templateResult;

    for (const candidate of buildRssHubCandidates(feedUrl, options.rssHubBaseUrls || [])) {
      const attempt = await tryFetchFeed(options.fetchFeed, candidate, runtimeOptions);
      if (attempt.ok) {
        return {
          inputUrl: feedUrl,
          feedUrl: candidate.url,
          source: candidate.source,
          confidence: candidate.confidence,
          route: candidate.route,
          candidateTitle: candidate.title || "",
          meta: attempt.result.meta || {},
          itemCount: Array.isArray(attempt.result.items) ? attempt.result.items.length : 0
        };
      }
    }

    return templateResult;
  }

  const direct = await tryFetchFeed(options.fetchFeed, { url: feedUrl, source: "direct", confidence: "high" }, runtimeOptions);
  if (direct.ok) {
    return {
      inputUrl: feedUrl,
      feedUrl,
      source: "direct",
      meta: direct.result.meta || {},
      itemCount: Array.isArray(direct.result.items) ? direct.result.items.length : 0
    };
  }

  const candidates = [];
  const seen = new Set([feedUrl]);
  let page = null;
  const shouldTryAlternatives = shouldTryAlternativeFeeds(direct.error);
  if (shouldTryAlternatives && typeof options.discoverFeedLinks === "function") {
    try {
      page = await options.discoverFeedLinks(feedUrl, runtimeOptions);
      for (const candidate of page?.feeds || []) {
        addCandidate(candidates, seen, candidate, feedUrl);
      }
    } catch (_error) {
      // Discovery is best-effort; common paths and RSSHub routes can still work.
    }
  }

  for (const candidate of buildKnownNativeCandidates(feedUrl)) addCandidate(candidates, seen, candidate, feedUrl);
  for (const candidate of buildCommonFeedCandidates(feedUrl)) addCandidate(candidates, seen, candidate, feedUrl);
  for (const candidate of buildRssHubCandidates(feedUrl, options.rssHubBaseUrls || [])) addCandidate(candidates, seen, candidate, feedUrl);

  const errors = [];
  for (const candidate of candidates.slice(0, MAX_DISCOVERY_CANDIDATES)) {
    const attempt = await tryFetchFeed(options.fetchFeed, candidate, runtimeOptions);
    if (attempt.ok) {
      return {
        inputUrl: feedUrl,
        feedUrl: candidate.url,
        source: candidate.source,
        confidence: candidate.confidence,
        route: candidate.route,
        siteTitle: page?.siteTitle || "",
        siteDescription: page?.siteDescription || "",
        candidateTitle: candidate.title || "",
        meta: attempt.result.meta || {},
        itemCount: Array.isArray(attempt.result.items) ? attempt.result.items.length : 0
      };
    }
    errors.push(attempt);
  }

  if (shouldTryJsonMapping(direct.error) && typeof options.discoverJsonFeedMapping === "function") {
    try {
      const jsonMapping = await options.discoverJsonFeedMapping(feedUrl, runtimeOptions);
      if (jsonMapping?.mapping && Array.isArray(jsonMapping.items) && jsonMapping.items.length) {
        return {
          inputUrl: feedUrl,
          feedUrl,
          source: "json_mapping",
          confidence: "medium",
          meta: {
            title: jsonMapping.items[0]?.title ? new URL(feedUrl).hostname : feedUrl,
            siteUrl: feedUrl,
            description: "自动识别网页 JSON 数据生成的订阅源"
          },
          itemCount: jsonMapping.items.length,
          fetchSettings: {
            feedFormat: "json",
            fetchRequestProfile: "browser",
            fetchJsonItemsPath: jsonMapping.mapping.jsonItemsPath || "",
            fetchJsonTitlePath: jsonMapping.mapping.jsonTitlePath || "",
            fetchJsonLinkPath: jsonMapping.mapping.jsonLinkPath || "",
            fetchJsonDatePath: jsonMapping.mapping.jsonDatePath || "",
            fetchJsonSummaryPath: jsonMapping.mapping.jsonSummaryPath || "",
            fetchJsonContentPath: jsonMapping.mapping.jsonContentPath || ""
          }
        };
      }
    } catch (_error) {
      // Continue to the normal failure path when JSON mapping cannot be inferred.
    }
  }

  const builtin = matchBuiltinFeedInput(feedUrl);
  if (builtin) {
    const builtinAttempt = await tryFetchFeed(options.fetchFeed, builtin, runtimeOptions);
    if (builtinAttempt.ok) {
      return {
        inputUrl: feedUrl,
        feedUrl: builtin.url,
        source: builtin.source,
        confidence: builtin.confidence,
        candidateTitle: builtin.title || "",
        meta: builtinAttempt.result.meta || {},
        itemCount: Array.isArray(builtinAttempt.result.items) ? builtinAttempt.result.items.length : 0
      };
    }
  }

  if (isUnsupportedFeedError(direct.error)) {
    throw badRequest("未找到可读取的 RSS/Atom/JSON 订阅源；可配置 RSSHUB_BASE_URLS 后重试，或在订阅源设置中填写备用 Feed 地址。", {
      code: "feed_discovery_failed",
      details: {
        inputUrl: feedUrl,
        tried: candidates.slice(0, MAX_DISCOVERY_CANDIDATES).map((candidate) => candidate.url),
        errors: summarizeErrors(errors)
      }
    });
  }

  return {
    inputUrl: feedUrl,
    feedUrl,
    source: "direct_unverified",
    meta: {},
    itemCount: 0,
    warning: direct.error?.message || "订阅源暂时无法验证"
  };
}
