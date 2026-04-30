import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import { badGateway, badRequest } from "../lib/errors.js";
import { isLikelyInvalidArticleContent, isV2exHost } from "./article-content.js";

const DEFAULT_BOT_USER_AGENT = "Z7RSSBot/0.1";
const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const BROWSER_FALLBACK_STATUS_CODES = new Set([401, 403, 406, 409, 412, 425, 429, 451, 503]);
const ACCESS_CHALLENGE_PATTERN =
  /just a moment|attention required|cloudflare|cf-browser-verification|captcha|verify you are human|access denied|403 forbidden|security check|checking your browser|browser integrity|ddos-guard/i;
const XML_ENTITY_LIMIT_PATTERN = /Entity expansion limit exceeded/i;
const BASE_XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  trimValues: true
};

const parser = new XMLParser({
  ...BASE_XML_PARSER_OPTIONS,
  // Some real-world feeds embed a large number of XML entities in summaries.
  // Keep entity processing enabled, but raise the ceiling enough to avoid false failures.
  processEntities: {
    enabled: true,
    maxTotalExpansions: 10000,
    maxExpandedLength: 500000,
    maxExpansionDepth: 20,
    maxEntityCount: 5000
  }
});
const relaxedEntityParser = new XMLParser({
  ...BASE_XML_PARSER_OPTIONS,
  // Retry exceptionally large feeds with a looser ceiling before giving up.
  processEntities: {
    enabled: true,
    maxTotalExpansions: 50000,
    maxExpandedLength: 2000000,
    maxExpansionDepth: 20,
    maxEntityCount: 20000
  }
});
const noEntityParser = new XMLParser({
  ...BASE_XML_PARSER_OPTIONS,
  // As a last resort, skip entity expansion entirely so valid XML feeds still parse.
  processEntities: false
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseXmlFeedDocument(body = "") {
  try {
    return parser.parse(body);
  } catch (error) {
    if (!XML_ENTITY_LIMIT_PATTERN.test(String(error?.message || ""))) {
      throw error;
    }
  }

  try {
    return relaxedEntityParser.parse(body);
  } catch (error) {
    if (!XML_ENTITY_LIMIT_PATTERN.test(String(error?.message || ""))) {
      throw error;
    }
  }

  return noEntityParser.parse(body);
}

function isSafeNavigationUrl(value, { allowRelative = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (allowRelative && /^[./#]/.test(raw)) return true;
  if (/^(https?:|mailto:)/i.test(raw)) return true;
  return false;
}

function toSafeAbsoluteUrl(candidate, baseUrl, { allowRelative = false } = {}) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  if (!allowRelative && !isSafeNavigationUrl(raw)) {
    return "";
  }

  try {
    if (baseUrl) {
      const resolved = new URL(raw, baseUrl);
      if (isSafeNavigationUrl(resolved.toString())) {
        return resolved.toString();
      }
      return "";
    }

    if (isSafeNavigationUrl(raw)) {
      return new URL(raw).toString();
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function sanitizeHtmlFragment(html = "", baseUrl = "") {
  if (!html) return "";

  const $ = cheerio.load(`<div data-sanitize-root="1">${html}</div>`, null, false);
  const root = $("[data-sanitize-root='1']").first();

  root.find("script, style, noscript, iframe, object, embed, form, input, button, textarea, select, meta, link").remove();

  root.find("*").each((_, element) => {
    const attrs = { ...(element.attribs || {}) };
    for (const [name, value] of Object.entries(attrs)) {
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith("on") || lowerName === "srcdoc" || lowerName === "nonce" || lowerName === "integrity") {
        $(element).removeAttr(name);
        continue;
      }

      if (lowerName === "href") {
        const safeHref = toSafeAbsoluteUrl(value, baseUrl, { allowRelative: true });
        if (safeHref) {
          $(element).attr(name, safeHref);
          $(element).attr("rel", "noreferrer noopener");
          $(element).attr("target", "_blank");
        } else {
          $(element).removeAttr(name);
        }
        continue;
      }

      if (lowerName === "src" || lowerName === "poster") {
        const safeSrc = toSafeAbsoluteUrl(value, baseUrl, { allowRelative: true });
        if (safeSrc) {
          $(element).attr(name, safeSrc);
        } else {
          $(element).removeAttr(name);
        }
        continue;
      }

      if (lowerName === "srcset") {
        const nextSrcset = String(value || "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => {
            const [urlPart, descriptor] = entry.split(/\s+/, 2);
            const safeSrc = toSafeAbsoluteUrl(urlPart, baseUrl, { allowRelative: true });
            if (!safeSrc) return "";
            return descriptor ? `${safeSrc} ${descriptor}` : safeSrc;
          })
          .filter(Boolean)
          .join(", ");

        if (nextSrcset) {
          $(element).attr(name, nextSrcset);
        } else {
          $(element).removeAttr(name);
        }
      }
    }
  });

  return root.html() || "";
}

function extractCanonicalUrl($, fallbackUrl = "") {
  const candidates = [
    $("link[rel='canonical']").attr("href"),
    $("meta[property='og:url']").attr("content"),
    $("meta[name='twitter:url']").attr("content")
  ];

  for (const candidate of candidates) {
    const resolved = toSafeAbsoluteUrl(candidate || "", fallbackUrl, { allowRelative: true });
    if (resolved) {
      return resolved;
    }
  }

  return toSafeAbsoluteUrl(fallbackUrl || "", "") || String(fallbackUrl || "").trim();
}

function extractDocumentTitle($, fallback = "") {
  const candidates = [
    $("meta[property='og:title']").attr("content"),
    $("meta[name='twitter:title']").attr("content"),
    $("title").first().text(),
    $("h1").first().text()
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").replace(/\s+/g, " ").trim();
    if (value) {
      return value;
    }
  }

  return String(fallback || "").trim();
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.text === "string") return node.text;
  return "";
}

function normalizeProfile(value = "") {
  const candidate = String(value || "").trim().toLowerCase();
  return ["browser", "bot"].includes(candidate) ? candidate : "auto";
}

function getResourceOrigin(resourceUrl) {
  try {
    return `${new URL(resourceUrl).origin}/`;
  } catch (_error) {
    return "";
  }
}

function parseCookieAssignments(raw = "") {
  return String(raw || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.includes("="))
    .map((part) => {
      const separator = part.indexOf("=");
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    })
    .filter(([name]) => Boolean(name));
}

function mergeCookieHeaders(...values) {
  const cookies = new Map();
  values.flatMap((value) => parseCookieAssignments(value)).forEach(([name, cookieValue]) => {
    cookies.set(name, cookieValue);
  });
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getResponseSetCookies(response) {
  if (typeof response?.headers?.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response?.headers?.get("set-cookie");
  return single ? [single] : [];
}

function extractCookieHeaderFromSetCookies(setCookieHeaders = []) {
  return setCookieHeaders
    .map((entry) => String(entry || "").split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

function getRequestProfiles(options = {}) {
  const forced = normalizeProfile(options.requestProfile);
  if (forced === "browser") return ["browser"];
  if (forced === "bot") return ["bot"];
  return ["bot", "browser"];
}

function shouldRetryWithBrowserOnError(profile, profiles, error) {
  if (profile !== "bot" || !profiles.includes("browser")) {
    return false;
  }
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.cause?.code || error?.code || "").toUpperCase();
  return message.includes("timeout") || code.includes("TIMEOUT") || code === "ECONNRESET" || code === "UND_ERR_SOCKET";
}

function buildRequestHeaders(
  resourceUrl,
  { kind = "feed", profile = "bot", userAgent = "", browserUserAgent = "", cookie = "" } = {}
) {
  const accept =
    kind === "feed"
      ? "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  if (profile === "browser") {
    const referer = getResourceOrigin(resourceUrl);
    return {
      "user-agent": browserUserAgent || DEFAULT_BROWSER_USER_AGENT,
      accept,
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "upgrade-insecure-requests": "1",
      ...(cookie ? { cookie } : {}),
      ...(referer ? { referer } : {})
    };
  }

  return {
    "user-agent": userAgent || DEFAULT_BOT_USER_AGENT,
    accept,
    ...(cookie ? { cookie } : {})
  };
}

function looksLikeHtmlDocument(body = "", contentType = "") {
  const sample = String(body || "").slice(0, 4000);
  return /text\/html/i.test(contentType) || /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(sample);
}

function looksLikeAccessChallenge(body = "", contentType = "") {
  if (!looksLikeHtmlDocument(body, contentType)) {
    return false;
  }
  return ACCESS_CHALLENGE_PATTERN.test(String(body || "").slice(0, 4000));
}

async function requestWithBrowserFallback(resourceUrl, options = {}, handlers = {}) {
  const kind = options.kind === "article" ? "article" : "feed";
  let lastError = null;
  const profiles = getRequestProfiles(options);

  for (const profile of profiles) {
    let runtimeCookie = String(options.cookie || "").trim();
    if (options.loginUrl && options.username && options.password) {
      let loginResponse;
      try {
        loginResponse = await fetch(options.loginUrl, {
          method: "POST",
          redirect: "manual",
          headers: {
            ...buildRequestHeaders(options.loginUrl, {
              kind: "article",
              profile,
              userAgent: options.userAgent,
              browserUserAgent: options.browserUserAgent,
              cookie: runtimeCookie
            }),
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: new URLSearchParams({
            [String(options.usernameField || "username")]: String(options.username || ""),
            [String(options.passwordField || "password")]: String(options.password || "")
          }),
          signal: AbortSignal.timeout(options.timeoutMs || 15000)
        });
      } catch (error) {
        if (shouldRetryWithBrowserOnError(profile, profiles, error)) {
          lastError = error;
          continue;
        }
        throw error;
      }

      if (loginResponse.status >= 400) {
        const error = badGateway(`Login request failed: ${loginResponse.status} ${loginResponse.statusText}`, {
          code: "feed_login_failed"
        });
        if (profile === "bot" && profiles.includes("browser")) {
          lastError = error;
          continue;
        }
        throw error;
      }

      runtimeCookie = mergeCookieHeaders(
        runtimeCookie,
        extractCookieHeaderFromSetCookies(getResponseSetCookies(loginResponse))
      );
    }

    let response;
    try {
      response = await fetch(resourceUrl, {
        headers: buildRequestHeaders(resourceUrl, {
          kind,
          profile,
          userAgent: options.userAgent,
          browserUserAgent: options.browserUserAgent,
          cookie: runtimeCookie
        }),
        signal: AbortSignal.timeout(options.timeoutMs || 15000)
      });
    } catch (error) {
      if (shouldRetryWithBrowserOnError(profile, profiles, error)) {
        lastError = error;
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const error = badGateway(
        `${kind === "feed" ? "Feed" : "Article"} request failed: ${response.status} ${response.statusText}`,
        {
          code: `${kind}_request_failed`
        }
      );

      if (profile === "bot" && BROWSER_FALLBACK_STATUS_CODES.has(response.status)) {
        lastError = error;
        continue;
      }

      throw error;
    }

    const body = await response.text();
    const contentType = response.headers.get("content-type") || "";
    if (typeof handlers.onBody !== "function") {
      return { body, contentType, profile };
    }

    const outcome = handlers.onBody({ body, contentType, profile });
    if (outcome?.retry && profile === "bot") {
      lastError = outcome.error || lastError;
      continue;
    }
    if (outcome?.retry || outcome?.error) {
      throw outcome.error || badGateway(`${kind} request could not be completed`, {
        code: `${kind}_request_failed`
      });
    }
    return outcome.value;
  }

  throw lastError || badGateway(`${kind} request failed`, { code: `${kind}_request_failed` });
}

function splitPath(path = "") {
  return String(path || "")
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getPathValue(input, path = "") {
  if (!path) return input;
  return splitPath(path).reduce((value, segment) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(segment)) {
      return value[Number(segment)];
    }
    return value[segment];
  }, input);
}

function coerceJsonText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.html === "string") return value.html;
    if (typeof value.content === "string") return value.content;
    if (typeof value.title === "string") return value.title;
    return "";
  }
  return "";
}

function findJsonItems(payload) {
  if (Array.isArray(payload)) return payload;
  const directCandidates = ["items", "entries", "articles", "posts", "results"];
  for (const key of directCandidates) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
    if (Array.isArray(payload?.data?.[key])) {
      return payload.data[key];
    }
  }
  const nestedArray = Object.values(payload || {}).find((entry) => Array.isArray(entry));
  return Array.isArray(nestedArray) ? nestedArray : [];
}

function mapJsonItems(payload, feedUrl, options = {}) {
  const itemsRoot = options.jsonItemsPath ? getPathValue(payload, options.jsonItemsPath) : findJsonItems(payload);
  const items = Array.isArray(itemsRoot) ? itemsRoot : [];

  return items.map((item, index) => {
    const rawLink =
      coerceJsonText(options.jsonLinkPath ? getPathValue(item, options.jsonLinkPath) : item.link || item.url || item.permalink) ||
      "";
    const rawTitle =
      coerceJsonText(options.jsonTitlePath ? getPathValue(item, options.jsonTitlePath) : item.title || item.name || item.headline) ||
      "Untitled";
    const rawSummary = coerceJsonText(
      options.jsonSummaryPath ? getPathValue(item, options.jsonSummaryPath) : item.summary || item.description || item.excerpt
    );
    const rawContent = coerceJsonText(
      options.jsonContentPath ? getPathValue(item, options.jsonContentPath) : item.content || item.content_html || rawSummary
    );
    const link = toSafeAbsoluteUrl(rawLink, feedUrl, { allowRelative: true }) || "";
    const contentHtml = sanitizeHtmlFragment(rawContent, link || feedUrl);
    const authorValue = item.author?.name || item.author || item.creator || item.byline || "";
    return {
      guid: coerceJsonText(item.id || item.guid || link || `${feedUrl}#json-${index}`) || `${feedUrl}#json-${index}`,
      title: rawTitle,
      link,
      author: coerceJsonText(authorValue),
      summary: rawSummary,
      contentHtml,
      contentText: stripHtml(contentHtml || rawSummary),
      publishedAt: toIsoOrNull(
        coerceJsonText(
          options.jsonDatePath ? getPathValue(item, options.jsonDatePath) : item.publishedAt || item.published_at || item.pubDate || item.date
        )
      )
    };
  });
}

function mapRssItems(channel) {
  return asArray(channel.item).map((item) => {
    const encoded = item["content:encoded"];
    const itemLink = item.link || "";
    const rawContentHtml = typeof encoded === "string" ? encoded : item.description || "";
    const contentHtml = sanitizeHtmlFragment(rawContentHtml, itemLink);
    return {
      guid: item.guid?.text || item.guid || itemLink || crypto.randomUUID(),
      title: item.title || "Untitled",
      link: toSafeAbsoluteUrl(itemLink, channel.link || "") || "",
      author: item.author || item["dc:creator"] || "",
      summary: item.description || "",
      contentHtml,
      contentText: stripHtml(contentHtml),
      publishedAt: toIsoOrNull(item.pubDate)
    };
  });
}

function mapAtomEntries(feed) {
  return asArray(feed.entry).map((entry) => {
    const links = asArray(entry.link);
    const alternate = links.find((link) => link.rel === "alternate") || links[0] || {};
    const entryLink = alternate.href || "";
    const html = sanitizeHtmlFragment(pickText(entry.content) || pickText(entry.summary), entryLink);
    return {
      guid: entry.id || entryLink || crypto.randomUUID(),
      title: pickText(entry.title) || "Untitled",
      link: toSafeAbsoluteUrl(entryLink, feed.link?.href || "") || "",
      author: entry.author?.name || "",
      summary: pickText(entry.summary),
      contentHtml: html,
      contentText: stripHtml(html),
      publishedAt: toIsoOrNull(entry.published || entry.updated)
    };
  });
}

export async function fetchFeed(feedUrl, options = {}) {
  return requestWithBrowserFallback(
    feedUrl,
    { ...options, kind: "feed" },
    {
      onBody({ body, contentType, profile }) {
        const forcedFormat = String(options.feedFormat || "").trim().toLowerCase() || "auto";
        const looksLikeJson = /application\/json|text\/json/i.test(contentType) || /^[\[{]/.test(String(body || "").trim());
        if (forcedFormat === "json" || (forcedFormat === "auto" && looksLikeJson)) {
          try {
            const payload = JSON.parse(body);
            const items = mapJsonItems(payload, feedUrl, options);
            return {
              value: {
                meta: {
                  title: coerceJsonText(payload?.title || payload?.name || payload?.feed?.title) || feedUrl,
                  description: coerceJsonText(payload?.description || payload?.subtitle || payload?.feed?.description),
                  siteUrl:
                    toSafeAbsoluteUrl(
                      coerceJsonText(payload?.home_page_url || payload?.site_url || payload?.feed_url || payload?.url),
                      feedUrl,
                      { allowRelative: true }
                    ) || ""
                },
                items
              }
            };
          } catch (_error) {
            if (forcedFormat === "json") {
              return {
                error: badRequest("JSON 抓取结果解析失败", { code: "feed_json_invalid" })
              };
            }
          }
        }

        let parsed = null;
        try {
          parsed = parseXmlFeedDocument(body);
        } catch (_error) {
          parsed = null;
        }

        if (forcedFormat !== "atom" && parsed?.rss?.channel) {
          const channel = parsed.rss.channel;
          return {
            value: {
              meta: {
                title: channel.title || feedUrl,
                description: channel.description || "",
                siteUrl: toSafeAbsoluteUrl(channel.link || "", feedUrl) || ""
              },
              items: mapRssItems(channel)
            }
          };
        }

        if (forcedFormat !== "rss" && parsed?.feed) {
          const feed = parsed.feed;
          const links = asArray(feed.link);
          const site = links.find((link) => link.rel === "alternate") || links[0] || {};
          return {
            value: {
              meta: {
                title: pickText(feed.title) || feedUrl,
                description: pickText(feed.subtitle),
                siteUrl: toSafeAbsoluteUrl(site.href || "", feedUrl) || ""
              },
              items: mapAtomEntries(feed)
            }
          };
        }

        if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
          return {
            retry: true,
            error: badGateway("Feed request returned an access challenge page instead of RSS content", {
              code: "feed_request_access_challenge"
            })
          };
        }

        return {
          error: badRequest("Unsupported feed format", { code: "unsupported_feed_format" })
        };
      }
    }
  );
}

export async function fetchArticleContent(articleUrl, options = {}) {
  if (!articleUrl) {
    return { html: "", text: "" };
  }

  const mode = options.mode === "page" ? "page" : "article";
  const customSelector =
    mode === "page" ? String(options.pageSelector || "").trim() : String(options.articleSelector || "").trim();
  return requestWithBrowserFallback(
    articleUrl,
    { ...options, kind: "article" },
    {
      onBody({ body, contentType, profile }) {
        if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
          return {
            retry: true,
            error: badGateway("Article request returned an access challenge page instead of article content", {
              code: "article_request_access_challenge"
            })
          };
        }

        const $ = cheerio.load(body);
        $("script, style, noscript, iframe").remove();

        const candidates = [
          ...(customSelector ? [customSelector] : []),
          ...(isV2exHost(articleUrl)
            ? mode === "page"
              ? ["#Main", "#Wrapper #Main", ".box .cell .topic_content"]
              : [".topic_content", "#Main .topic_content", ".markdown_body", "#Main .markdown_body"]
            : []),
          ...(mode === "page"
            ? ["main", "[role='main']", "#main", "#Main", "article", ".article-content", ".entry-content", ".content"]
            : [
                "article",
                "main article",
                "[itemprop='articleBody']",
                ".post-content",
                ".entry-content",
                ".article-content",
                ".topic_content",
                ".markdown-body",
                ".markdown_body",
                "main",
                "[role='main']",
                ".content"
              ])
        ];
        let root = null;
        for (const selector of candidates) {
          let found = null;
          try {
            found = $(selector).first();
          } catch (_error) {
            continue;
          }
          if (!found.length) {
            continue;
          }

          const candidateHtml = found.html() || "";
          const candidateText = found.text().replace(/\s+/g, " ").trim();
          if (!candidateText && !candidateHtml.trim()) {
            continue;
          }

          if (isLikelyInvalidArticleContent({ articleUrl, text: candidateText, html: candidateHtml })) {
            continue;
          }

          root = found;
          break;
        }

        const selected = mode === "page" ? root || $("body") : root || $("body");
        const text = selected.text().replace(/\s+/g, " ").trim();
        const selectedHtml = selected.html() || "";

        if (isLikelyInvalidArticleContent({ articleUrl, text, html: selectedHtml })) {
          if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
            return {
              retry: true,
              error: badGateway("Article request returned an access challenge page instead of article content", {
                code: "article_request_access_challenge"
              })
            };
          }

          return {
            error: badGateway("Article request returned a login or navigation page instead of article content", {
              code: "article_request_invalid_content"
            })
          };
        }

        const contentHtml = sanitizeHtmlFragment(selectedHtml, articleUrl);
        const originalUrl = extractCanonicalUrl($, articleUrl);
        const title = extractDocumentTitle($, articleUrl);

        return {
          value: { html: contentHtml, text, originalUrl, title }
        };
      }
    }
  );
}
