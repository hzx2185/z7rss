import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import { badGateway, badRequest } from "../lib/errors.js";
import { normalizeText } from "../lib/http.js";
import { isLikelyInvalidArticleContent, isV2exHost } from "./article-content.js";
import { fetchBuiltinFeed, isBuiltinFeedUrl } from "./builtin-feeds.js";

const DEFAULT_BOT_USER_AGENT = "Z7RSSBot/0.1";
const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const BROWSER_FALLBACK_STATUS_CODES = new Set([401, 403, 406, 409, 412, 425, 429, 451, 503]);
const ACCESS_CHALLENGE_PATTERN =
  /just a moment|attention required|cloudflare|cf-browser-verification|captcha|verify you are human|access denied|403 forbidden|security check|checking your browser|browser integrity|ddos-guard/i;
const XML_ENTITY_LIMIT_PATTERN = /Entity expansion limit exceeded/i;
const FEED_ACCESS_CHALLENGE_MESSAGE =
  "Feed 请求遇到反爬或人机验证页面，请在订阅源设置中尝试“模拟浏览器”、填写 Cookie 或登录信息。";
const ARTICLE_ACCESS_CHALLENGE_MESSAGE =
  "文章页遇到反爬或人机验证页面，请在订阅源设置中尝试“模拟浏览器”、填写 Cookie 或登录信息；若仍失败，说明该站点不允许服务端直接抓取全文。";
const FALLBACK_TEXT_ENCODING = "utf-8";
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

function stableFallbackGuid(prefix, parts = []) {
  const normalized = parts
    .map((part) => normalizeText(String(part || "")))
    .filter(Boolean)
    .join("|");
  return `${prefix}:${normalized || "untitled"}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function trimText(value = "", limit = 500) {
  const text = normalizeText(value);
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, "").trim()}...`;
}

function normalizeParagraphText(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n\n");
}

function normalizeEncodingLabel(value = "") {
  const label = String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  if (!label) return "";
  const aliases = {
    "shift-jis": "shift_jis",
    "shift_jis": "shift_jis",
    "sjis": "shift_jis",
    "x-sjis": "shift_jis",
    "windows-31j": "shift_jis",
    "ms932": "shift_jis",
    "cp932": "shift_jis",
    "utf8": "utf-8",
    "gb2312": "gb18030",
    "gbk": "gb18030",
    "big5-hkscs": "big5"
  };
  return aliases[label] || label;
}

function extractCharsetFromContentType(contentType = "") {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(String(contentType || ""));
  return normalizeEncodingLabel(match?.[1] || match?.[2] || match?.[3] || "");
}

function bytesToAsciiPreview(bytes, limit = 8192) {
  const size = Math.min(bytes.length, limit);
  let preview = "";
  for (let index = 0; index < size; index += 1) {
    const byte = bytes[index];
    preview += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : " ";
  }
  return preview;
}

function extractCharsetFromMarkup(bytes) {
  const preview = bytesToAsciiPreview(bytes);
  const directMeta = /<meta\s+[^>]*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'/>;]+))/i.exec(preview);
  if (directMeta) {
    return normalizeEncodingLabel(directMeta[1] || directMeta[2] || directMeta[3] || "");
  }
  const contentMeta = /<meta\s+[^>]*http-equiv\s*=\s*(?:"content-type"|'content-type'|content-type)[^>]*content\s*=\s*(?:"[^"]*charset\s*=\s*([^"\s;]+)|'[^']*charset\s*=\s*([^'\s;]+))/i.exec(preview);
  if (contentMeta) {
    return normalizeEncodingLabel(contentMeta[1] || contentMeta[2] || "");
  }
  const xmlEncoding = /<\?xml\s+[^>]*encoding\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(preview);
  return normalizeEncodingLabel(xmlEncoding?.[1] || xmlEncoding?.[2] || "");
}

function decodeBytes(bytes, encoding) {
  return new TextDecoder(encoding || FALLBACK_TEXT_ENCODING, { fatal: true }).decode(bytes);
}

function decodeResponseBytes(bytes, contentType = "") {
  const candidates = [
    extractCharsetFromContentType(contentType),
    extractCharsetFromMarkup(bytes),
    FALLBACK_TEXT_ENCODING
  ].filter((encoding, index, all) => encoding && all.indexOf(encoding) === index);

  for (const encoding of candidates) {
    try {
      return decodeBytes(bytes, encoding);
    } catch (_error) {
      // Try the next detected encoding before falling back to replacement mode.
    }
  }

  return new TextDecoder(FALLBACK_TEXT_ENCODING).decode(bytes);
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    body: decodeResponseBytes(bytes, contentType),
    contentType
  };
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

function isHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
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
          const tagName = (element.tagName || "").toLowerCase();
          if (tagName === "img") {
            $(element).attr("loading", "lazy");
            $(element).attr("referrerpolicy", "no-referrer");
          } else if (tagName === "video" || tagName === "audio") {
            $(element).attr("referrerpolicy", "no-referrer");
          }
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

const ARTICLE_BOILERPLATE_SELECTOR = [
  "aside",
  "nav",
  "footer",
  "header",
  "script",
  "style",
  "noscript",
  "iframe",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "template",
  "[hidden]",
  "[aria-hidden='true']",
  ".adsbygoogle",
  ".ad",
  ".ads",
  ".advert",
  ".advertisement",
  ".banner",
  ".cookie",
  ".comments",
  ".comment",
  ".newsletter",
  ".popup",
  ".promo",
  ".recommend",
  ".related",
  ".share",
  ".sharing",
  ".sidebar",
  ".sponsor",
  ".sponsored",
  ".subscribe",
  ".toolbar",
  "#comments"
].join(",");

const ARTICLE_BOILERPLATE_ATTR_PATTERN =
  /(^|[-_\s])(ad|ads|advert|advertisement|banner|breadcrumb|cookie|comment|footer|header|nav|newsletter|popup|promo|recommend|related|share|sharing|sidebar|sponsor|sponsored|subscribe|toolbar|widget)([-_\s]|$)/i;
const ARTICLE_BOILERPLATE_TEXT_PATTERN =
  /广告|赞助|推广|相关阅读|相关文章|推荐阅读|延伸阅读|热门推荐|点击关注|关注我们|订阅 newsletter|subscribe to|sign up for|advertisement|sponsored by|related articles|recommended reading/i;
const ARTICLE_CONTENT_TEXT_PATTERN = /[。！？!?]\s*$|[,，;；:：]\s*|[\u4e00-\u9fff]{12,}|[a-z0-9][.!?]\s+[A-Z0-9]/i;
const ARTICLE_BLOCK_SELECTOR = "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption";
const ARTICLE_BLOCK_TAGS = new Set(["p", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "figcaption"]);

function hasBoilerplateAttributes($element) {
  const values = [
    $element.attr("id"),
    $element.attr("class"),
    $element.attr("role"),
    $element.attr("aria-label"),
    $element.attr("data-testid"),
    $element.attr("data-test-id")
  ];
  return values.some((value) => ARTICLE_BOILERPLATE_ATTR_PATTERN.test(String(value || "")));
}

function shouldDropTextBlock(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (ARTICLE_BOILERPLATE_TEXT_PATTERN.test(normalized) && normalized.length <= 160) return true;
  if (/^(广告|ADVERTISEMENT|Advertisement|赞助内容)$/i.test(normalized)) return true;
  return false;
}

function cleanArticleRoot($, root) {
  const container = root.clone();
  container.find(ARTICLE_BOILERPLATE_SELECTOR).remove();
  container.find("*").each((_, element) => {
    const node = $(element);
    if (hasBoilerplateAttributes(node)) {
      node.remove();
      return;
    }
    if (ARTICLE_BLOCK_TAGS.has((element.tagName || "").toLowerCase()) && shouldDropTextBlock(node.text())) {
      node.remove();
    }
  });

  container.find("p, li, blockquote, pre, figcaption").each((_, element) => {
    const node = $(element);
    if (!normalizeText(node.text()) && !node.find("img, video, audio").length) {
      node.remove();
    }
  });

  container.find("div, section").each((_, element) => {
    const node = $(element);
    if (!normalizeText(node.text()) && !node.find("img, video, audio, p, li, blockquote, pre, h1, h2, h3, h4, h5, h6").length) {
      node.remove();
    }
  });

  return container;
}

function extractStructuredText($, root) {
  const parts = [];
  const seen = new Set();
  const addPart = (value = "") => {
    const text = normalizeText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    parts.push(text);
  };
  const walk = (node) => {
    node.contents().each((_, child) => {
      if (child.type === "text") {
        addPart(child.data || child.nodeValue || "");
        return;
      }
      if (child.type !== "tag") return;
      const childNode = $(child);
      const tagName = (child.tagName || child.name || "").toLowerCase();
      if (ARTICLE_BLOCK_TAGS.has(tagName)) {
        addPart(childNode.text());
        return;
      }
      walk(childNode);
    });
  };

  root.each((_, element) => {
    const node = $(element);
    const tagName = (element.tagName || element.name || "").toLowerCase();
    if (ARTICLE_BLOCK_TAGS.has(tagName)) {
      addPart(node.text());
      return;
    }
    walk(node);
  });

  if (!parts.length) {
    return normalizeParagraphText(root.text());
  }

  return parts.join("\n\n");
}

function scoreArticleCandidate($, root) {
  const cleaned = cleanArticleRoot($, root);
  const text = normalizeText(cleaned.text());
  if (!text) return { score: 0, text, html: "" };

  const blockCount = cleaned.find(ARTICLE_BLOCK_SELECTOR).length;
  const linkTextLength = normalizeText(cleaned.find("a").text()).length;
  const linkDensity = text.length ? linkTextLength / text.length : 1;
  const imageCount = cleaned.find("img").length;
  const punctuationCount = (text.match(/[。！？!?.,，；;：:]/g) || []).length;
  const contentLikeBlocks = cleaned
    .find(ARTICLE_BLOCK_SELECTOR)
    .toArray()
    .filter((element) => ARTICLE_CONTENT_TEXT_PATTERN.test(normalizeText($(element).text()))).length;
  const boilerplatePenalty = ARTICLE_BOILERPLATE_TEXT_PATTERN.test(text) ? Math.min(250, text.length * 0.25) : 0;
  const score =
    text.length +
    Math.min(blockCount, 30) * 18 +
    Math.min(contentLikeBlocks, 20) * 35 +
    Math.min(punctuationCount, 80) * 3 +
    Math.min(imageCount, 4) * 20 -
    linkDensity * 450 -
    boilerplatePenalty;

  return { score, text, html: cleaned.html() || "" };
}

function selectBestArticleRoot($, selectors = [], articleUrl = "") {
  let best = null;
  for (const selector of selectors) {
    let found = null;
    try {
      found = $(selector);
    } catch (_error) {
      continue;
    }
    found.each((_, element) => {
      const candidate = $(element);
      const result = scoreArticleCandidate($, candidate);
      if (!result.text && !result.html.trim()) return;
      if (isLikelyInvalidArticleContent({ articleUrl, text: result.text, html: result.html })) return;
      if (!best || result.score > best.score) {
        best = { root: candidate, ...result };
      }
    });
  }
  return best?.root || null;
}

function isLikelyContentImage($image) {
  const src = String($image.attr("src") || $image.attr("data-src") || "").trim();
  if (!src || /^data:/i.test(src)) return false;
  const attrText = normalizeText([$image.attr("class"), $image.attr("id"), $image.attr("alt"), src].join(" "));
  if (/avatar|icon|logo|sprite|tracking|pixel|spacer|badge|emoji|advert|banner|share/i.test(attrText)) return false;
  const width = Number.parseInt($image.attr("width") || "", 10);
  const height = Number.parseInt($image.attr("height") || "", 10);
  if ((width && width < 160) || (height && height < 100)) return false;
  return true;
}

function extractMainImageUrl($, articleRoot, articleUrl = "") {
  const metaCandidates = [
    $("meta[property='og:image:secure_url']").attr("content"),
    $("meta[property='og:image']").attr("content"),
    $("meta[name='twitter:image']").attr("content")
  ];
  for (const candidate of metaCandidates) {
    const safe = toSafeAbsoluteUrl(candidate || "", articleUrl, { allowRelative: true });
    if (safe) return safe;
  }

  const image = articleRoot.find("img").toArray().map((element) => $(element)).find(isLikelyContentImage);
  if (!image) return "";
  return toSafeAbsoluteUrl(image.attr("src") || image.attr("data-src") || "", articleUrl, { allowRelative: true });
}

function addMainImageToArticleHtml(html = "", imageUrl = "", baseUrl = "") {
  const safeImage = toSafeAbsoluteUrl(imageUrl, baseUrl, { allowRelative: true });
  if (!html || !safeImage) return html;

  const $ = cheerio.load(`<div data-article-root="1">${html}</div>`, null, false);
  const root = $("[data-article-root='1']").first();
  const existingFirstImage = root.find("img").toArray().find((element) => isLikelyContentImage($(element)));
  const existingSrc = existingFirstImage
    ? toSafeAbsoluteUrl($(existingFirstImage).attr("src") || "", baseUrl, { allowRelative: true })
    : "";
  if (existingSrc === safeImage) {
    return root.html() || html;
  }

  root.prepend(
    `<figure class="article-main-image"><img src="${safeImage}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>`
  );
  return root.html() || html;
}

function htmlToStructuredText(html = "") {
  if (!String(html || "").trim()) return "";
  const $ = cheerio.load(`<div data-text-root="1">${html}</div>`, null, false);
  return extractStructuredText($, $("[data-text-root='1']").first());
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

function applyHtmlRange(body = "", { htmlStart = "", htmlEnd = "" } = {}) {
  const source = String(body || "");
  const startMarker = String(htmlStart || "").trim();
  const endMarker = String(htmlEnd || "").trim();
  if (!source || (!startMarker && !endMarker)) {
    return source;
  }

  let startIndex = 0;
  if (startMarker) {
    const matchedIndex = source.indexOf(startMarker);
    if (matchedIndex < 0) {
      throw badGateway("HTML 开始标记未找到", { code: "article_html_start_not_found" });
    }
    startIndex = matchedIndex + startMarker.length;
  }

  let endIndex = source.length;
  if (endMarker) {
    const matchedIndex = source.indexOf(endMarker, startIndex);
    if (matchedIndex < 0) {
      throw badGateway("HTML 结束标记未找到", { code: "article_html_end_not_found" });
    }
    endIndex = matchedIndex;
  }

  if (endIndex <= startIndex) {
    throw badGateway("HTML 开始/结束标记范围为空", { code: "article_html_range_empty" });
  }

  return source.slice(startIndex, endIndex);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const raw = typeof value === "number" ? value : String(value || "").trim();
  const numeric = typeof raw === "number" ? raw : /^\d{10,13}$/.test(raw) ? Number(raw) : null;
  const date = numeric === null ? new Date(raw) : new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
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

function normalizeRequestMethod(value = "") {
  const candidate = String(value || "").trim().toUpperCase();
  return candidate === "POST" ? "POST" : "GET";
}

function buildRequestBody(value = "", method = "GET") {
  if (method !== "POST") return undefined;
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  return raw;
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
  { kind = "feed", profile = "bot", userAgent = "", browserUserAgent = "", cookie = "", etag = "", lastModified = "", method = "GET", body = "" } = {}
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
      ...(etag ? { "if-none-match": etag } : {}),
      ...(lastModified ? { "if-modified-since": lastModified } : {}),
      ...(cookie ? { cookie } : {}),
      ...(method === "POST" && body ? { "content-type": "application/json" } : {}),
      ...(referer ? { referer } : {})
    };
  }

  return {
    "user-agent": userAgent || DEFAULT_BOT_USER_AGENT,
    accept,
    ...(etag ? { "if-none-match": etag } : {}),
    ...(lastModified ? { "if-modified-since": lastModified } : {}),
    ...(method === "POST" && body ? { "content-type": "application/json" } : {}),
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

function looksLikeAccessChallengeResponse(response, body = "", contentType = "") {
  const mitigated = String(response?.headers?.get("cf-mitigated") || "").trim();
  if (/challenge/i.test(mitigated)) {
    return true;
  }
  return looksLikeAccessChallenge(body, contentType);
}

async function requestWithBrowserFallback(resourceUrl, options = {}, handlers = {}) {
  const kind = options.kind === "article" ? "article" : "feed";
  const method = normalizeRequestMethod(options.requestMethod);
  const requestBody = buildRequestBody(options.requestBody, method);
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
        method,
        headers: buildRequestHeaders(resourceUrl, {
          kind,
          profile,
          userAgent: options.userAgent,
          browserUserAgent: options.browserUserAgent,
          etag: options.etag,
          lastModified: options.lastModified,
          cookie: runtimeCookie,
          method,
          body: requestBody
        }),
        ...(requestBody ? { body: requestBody } : {}),
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
      if (kind === "feed" && response.status === 304) {
        return {
          notModified: true,
          profile,
          etag: response.headers.get("etag") || String(options.etag || "").trim(),
          lastModified: response.headers.get("last-modified") || String(options.lastModified || "").trim()
        };
      }

      let body = "";
      try {
        ({ body } = await readResponseBody(response));
      } catch (_error) {
        body = "";
      }
      const contentType = response.headers.get("content-type") || "";
      const isAccessChallenge = looksLikeAccessChallengeResponse(response, body, contentType);
      const error = badGateway(
        isAccessChallenge
          ? kind === "feed"
            ? FEED_ACCESS_CHALLENGE_MESSAGE
            : ARTICLE_ACCESS_CHALLENGE_MESSAGE
          : `${kind === "feed" ? "Feed" : "Article"} request failed: ${response.status} ${response.statusText}`,
        {
          code: isAccessChallenge ? `${kind}_request_access_challenge` : `${kind}_request_failed`
        }
      );

      if (profile === "bot" && BROWSER_FALLBACK_STATUS_CODES.has(response.status)) {
        lastError = error;
        continue;
      }

      throw error;
    }

    const { body, contentType } = await readResponseBody(response);
    const responseMeta = {
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || ""
    };
    if (typeof handlers.onBody !== "function") {
      return { body, contentType, profile, ...responseMeta };
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
    if (outcome.value && typeof outcome.value === "object") {
      return {
        ...outcome.value,
        ...responseMeta
      };
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

function joinJsonPath(segments = []) {
  return segments.map((segment) => String(segment || "").trim()).filter(Boolean).join(".");
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

function coerceJsonLink(value, feedUrl = "") {
  const direct = coerceJsonText(value);
  let feedHost = "";
  try {
    feedHost = new URL(feedUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_error) {
    feedHost = "";
  }
  const isJuejinFeed = feedHost === "juejin.cn" || feedHost === "api.juejin.cn";
  if (direct) {
    if (isJuejinFeed && /^[0-9]{8,}$/.test(direct)) return `https://juejin.cn/post/${direct}`;
    return direct;
  }
  if (value && typeof value === "object") {
    const contentId = value.content_id || value.article_id || value.item_id || value.id;
    if (isJuejinFeed && contentId) return `https://juejin.cn/post/${contentId}`;
  }
  return "";
}

function parseJsonPayload(value = "") {
  try {
    return JSON.parse(String(value || "").trim());
  } catch (_error) {
    return null;
  }
}

function extractBalancedJsonObject(source = "", markerIndex = 0) {
  const text = String(source || "");
  const start = text.indexOf("{", markerIndex);
  if (start < 0) return "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
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
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function extractJsonPayloadsFromHtml(body = "") {
  const $ = cheerio.load(body);
  const payloads = [];
  const addPayload = (payload, source = "") => {
    if (payload && typeof payload === "object") payloads.push({ payload, source });
  };

  $("script").each((_, element) => {
    const node = $(element);
    const text = node.html() || "";
    const type = String(node.attr("type") || "").toLowerCase();
    const id = String(node.attr("id") || "").toLowerCase();
    const trimmed = text.trim();
    if (!trimmed) return;

    if (/json|ld\+json/.test(type) || id === "__next_data__" || /^\s*[\[{]/.test(trimmed)) {
      addPayload(parseJsonPayload(trimmed), id || type || "script-json");
    }
    for (const marker of ["window.__INITIAL_STATE__", "window.__INITIAL_DATA__", "window.__NUXT__"]) {
      const markerIndex = text.indexOf(marker);
      if (markerIndex >= 0) addPayload(parseJsonPayload(extractBalancedJsonObject(text, markerIndex)), marker);
    }
  });

  return payloads;
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

function isLikelyUrlText(value = "") {
  const raw = String(value || "").trim();
  return /^https?:\/\//i.test(raw) || /^\//.test(raw) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw);
}

function scoreJsonFieldName(path = [], kind = "") {
  const key = String(path[path.length - 1] || "").toLowerCase();
  const full = path.join(".").toLowerCase();
  const scores = {
    title: /(^|\.|_)(title|headline|name|subject)$/.test(full) || ["title", "headline", "name", "subject"].includes(key) ? 12 : 0,
    link: /(^|\.|_)(url|link|href|permalink|external_url)$/.test(full) || ["url", "link", "href", "permalink", "external_url"].includes(key) ? 12 : 0,
    summary: /summary|description|excerpt|intro|abstract|detail_text/.test(full) ? 10 : 0,
    content: /content|body|article|text|html|excerpt|description/.test(full) ? 9 : 0,
    date: /date|time|published|created|updated/.test(full) ? 10 : 0
  };
  return scores[kind] || 0;
}

function collectScalarFields(value, prefix = [], fields = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 4 || fields.length > 160) return fields;
  for (const [key, nested] of Object.entries(value)) {
    const path = [...prefix, key];
    if (nested === null || nested === undefined) continue;
    if (["string", "number", "boolean"].includes(typeof nested)) {
      fields.push({ path, value: nested, text: coerceJsonText(nested) });
      continue;
    }
    if (typeof nested === "object" && !Array.isArray(nested)) {
      collectScalarFields(nested, path, fields, depth + 1);
    }
  }
  return fields;
}

function pickBestField(fields = [], kind = "") {
  let best = null;
  for (const field of fields) {
    const text = normalizeText(field.text);
    if (!text) continue;
    let score = scoreJsonFieldName(field.path, kind);
    if (kind === "title") {
      if (text.length >= 4 && text.length <= 160) score += 6;
      if (isLikelyUrlText(text)) score -= 8;
    } else if (kind === "link") {
      if (isLikelyUrlText(text)) score += 10;
      if (text.length > 500) score -= 5;
    } else if (kind === "summary" || kind === "content") {
      if (text.length >= 20) score += Math.min(10, Math.floor(text.length / 80));
      if (isLikelyUrlText(text)) score -= 10;
    } else if (kind === "date") {
      if (toIsoOrNull(text)) score += 8;
    }
    if (!best || score > best.score) best = { ...field, score };
  }
  return best && best.score > 0 ? best : null;
}

function isPotentialJsonItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = collectScalarFields(value);
  return Boolean(pickBestField(fields, "title") && pickBestField(fields, "link"));
}

function findJsonArrayCandidates(value, path = [], candidates = [], visited = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 8 || candidates.length > 120) return candidates;
  if (visited.has(value)) return candidates;
  visited.add(value);

  if (Array.isArray(value)) {
    const objectItems = value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    const sample = objectItems.slice(0, 8);
    const itemLikeCount = sample.filter(isPotentialJsonItem).length;
    if (objectItems.length >= 2 && itemLikeCount >= Math.min(2, sample.length)) {
      candidates.push({ path, items: objectItems, itemLikeCount });
    }
    for (let index = 0; index < Math.min(value.length, 8); index += 1) {
      findJsonArrayCandidates(value[index], [...path, String(index)], candidates, visited, depth + 1);
    }
    return candidates;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!nested || typeof nested !== "object") continue;
    findJsonArrayCandidates(nested, [...path, key], candidates, visited, depth + 1);
  }
  return candidates;
}

function mapJsonItems(payload, feedUrl, options = {}) {
  const itemsRoot = options.jsonItemsPath ? getPathValue(payload, options.jsonItemsPath) : findJsonItems(payload);
  const items = Array.isArray(itemsRoot) ? itemsRoot : [];

  return items.map((item, index) => {
    const rawLink = options.jsonLinkPath
      ? coerceJsonLink(getPathValue(item, options.jsonLinkPath), feedUrl)
      : coerceJsonLink(item.url || item.external_url || item.link || item.permalink || item.id || item.content, feedUrl);
    const rawTitle =
      coerceJsonText(options.jsonTitlePath ? getPathValue(item, options.jsonTitlePath) : item.title || item.name || item.headline) ||
      "Untitled";
    const rawSummary = coerceJsonText(
      options.jsonSummaryPath ? getPathValue(item, options.jsonSummaryPath) : item.summary || item.description || item.excerpt
    );
    const rawContent = coerceJsonText(
      options.jsonContentPath
        ? getPathValue(item, options.jsonContentPath)
        : item.content || item.content_html || item.content_text || item.body || rawSummary
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
      contentText: coerceJsonText(item.content_text) || htmlToStructuredText(contentHtml) || normalizeParagraphText(stripHtml(contentHtml || rawSummary)),
      publishedAt: toIsoOrNull(
        coerceJsonText(
          options.jsonDatePath
            ? getPathValue(item, options.jsonDatePath)
            : item.date_published || item.publishedAt || item.published_at || item.pubDate || item.date || item.created_at || item.updated_at
        )
      )
    };
  });
}

function pickElementText($, root, selector = "") {
  const rawSelector = String(selector || "").trim();
  if (!rawSelector) return "";
  const element = root.find(rawSelector).first();
  if (!element.length) return "";
  return normalizeText(element.text());
}

function pickElementHtml($, root, selector = "", baseUrl = "") {
  const rawSelector = String(selector || "").trim();
  if (!rawSelector) return "";
  const element = root.find(rawSelector).first();
  if (!element.length) return "";
  return sanitizeHtmlFragment(element.html() || element.text() || "", baseUrl);
}

function pickElementUrl($, root, selector = "", baseUrl = "") {
  const rawSelector = String(selector || "").trim();
  if (!rawSelector) return "";
  const element = root.find(rawSelector).first();
  if (!element.length) return "";
  const rawUrl = element.attr("href") || element.attr("data-href") || element.attr("src") || element.attr("data-src") || element.text();
  return toSafeAbsoluteUrl(rawUrl || "", baseUrl, { allowRelative: true }) || "";
}

function mapHtmlItems(body = "", feedUrl = "", options = {}) {
  const itemsSelector = String(options.htmlItemsSelector || "").trim();
  if (!itemsSelector) {
    throw badRequest("HTML 抓取缺少列表选择器", { code: "feed_html_selector_missing" });
  }
  const $ = cheerio.load(body);
  const roots = $(itemsSelector).toArray();
  if (!roots.length) {
    throw badRequest("HTML 抓取没有匹配到列表项", { code: "feed_html_items_empty" });
  }

  return roots.map((element, index) => {
    const root = $(element);
    const title = pickElementText($, root, options.htmlTitleSelector) || pickElementText($, root, "h1,h2,h3,a") || "Untitled";
    const link = pickElementUrl($, root, options.htmlLinkSelector, feedUrl) || pickElementUrl($, root, "a[href]", feedUrl) || `${feedUrl}#html-${index}`;
    const summary = pickElementText($, root, options.htmlSummarySelector);
    const contentHtml = pickElementHtml($, root, options.htmlContentSelector, link || feedUrl) || sanitizeHtmlFragment(summary, link || feedUrl);
    const contentText = htmlToStructuredText(contentHtml) || summary || normalizeText(root.text());
    const publishedAt = toIsoOrNull(pickElementText($, root, options.htmlDateSelector));
    return {
      guid: link || stableFallbackGuid("html", [feedUrl, title, index]),
      title,
      link,
      author: "",
      summary,
      contentHtml,
      contentText,
      publishedAt
    };
  }).filter((item) => item.title && item.link);
}

function inferJsonListMapping(payload, baseUrl = "") {
  const candidates = findJsonArrayCandidates(payload);
  let best = null;

  for (const candidate of candidates) {
    const sample = candidate.items.slice(0, 8);
    const fieldVotes = { title: new Map(), link: new Map(), summary: new Map(), content: new Map(), date: new Map() };
    let totalScore = Math.min(candidate.items.length, 50) * 2 + candidate.itemLikeCount * 8;

    for (const item of sample) {
      const fields = collectScalarFields(item);
      for (const kind of Object.keys(fieldVotes)) {
        const bestField = pickBestField(fields, kind);
        if (!bestField) continue;
        const pathKey = joinJsonPath(bestField.path);
        fieldVotes[kind].set(pathKey, (fieldVotes[kind].get(pathKey) || 0) + bestField.score);
        totalScore += bestField.score;
      }
    }

    const pickVote = (kind) => {
      let picked = null;
      for (const [pathKey, score] of fieldVotes[kind].entries()) {
        if (!picked || score > picked.score) picked = { path: pathKey, score };
      }
      return picked?.path || "";
    };

    const mapping = {
      jsonItemsPath: joinJsonPath(candidate.path),
      jsonTitlePath: pickVote("title"),
      jsonLinkPath: pickVote("link"),
      jsonSummaryPath: pickVote("summary"),
      jsonContentPath: pickVote("content"),
      jsonDatePath: pickVote("date")
    };
    if (!mapping.jsonTitlePath || !mapping.jsonLinkPath) continue;

    const previewItems = mapJsonItems(payload, baseUrl, {
      jsonItemsPath: mapping.jsonItemsPath,
      jsonTitlePath: mapping.jsonTitlePath,
      jsonLinkPath: mapping.jsonLinkPath,
      jsonSummaryPath: mapping.jsonSummaryPath,
      jsonContentPath: mapping.jsonContentPath,
      jsonDatePath: mapping.jsonDatePath
    }).filter((item) => item.title && item.link);
    totalScore += Math.min(previewItems.length, 20) * 5;
    if (!best || totalScore > best.score) {
      best = { mapping, items: previewItems, score: totalScore };
    }
  }

  return best;
}

export function discoverJsonFeedMappingFromHtml(body = "", pageUrl = "") {
  let best = null;
  for (const { payload, source } of extractJsonPayloadsFromHtml(body)) {
    const result = inferJsonListMapping(payload, pageUrl);
    if (!result?.items?.length) continue;
    if (!best || result.score > best.score) {
      best = { ...result, payload, source };
    }
  }
  if (!best) return null;
  return {
    source: best.source,
    mapping: best.mapping,
    payload: best.payload,
    items: best.items,
    score: best.score
  };
}

function mapRssItems(channel) {
  return asArray(channel.item).map((item) => {
    const encoded = item["content:encoded"];
    const itemLink = item.link || "";
    const rawContentHtml = typeof encoded === "string" ? encoded : item.description || "";
    const contentHtml = sanitizeHtmlFragment(rawContentHtml, itemLink);
    const contentText = htmlToStructuredText(contentHtml) || normalizeParagraphText(stripHtml(contentHtml));
    const publishedAt = toIsoOrNull(item.pubDate);
    const title = item.title || "Untitled";
    return {
      guid: item.guid?.text || item.guid || itemLink || stableFallbackGuid("rss", [channel.link, title, publishedAt, contentText]),
      title,
      link: toSafeAbsoluteUrl(itemLink, channel.link || "") || "",
      author: item.author || item["dc:creator"] || "",
      summary: item.description || "",
      contentHtml,
      contentText,
      publishedAt
    };
  });
}

function mapAtomEntries(feed) {
  return asArray(feed.entry).map((entry) => {
    const links = asArray(entry.link);
    const alternate = links.find((link) => link.rel === "alternate") || links[0] || {};
    const entryLink = alternate.href || "";
    const html = sanitizeHtmlFragment(pickText(entry.content) || pickText(entry.summary), entryLink);
    const contentText = htmlToStructuredText(html) || normalizeParagraphText(stripHtml(html));
    const title = pickText(entry.title) || "Untitled";
    const publishedAt = toIsoOrNull(entry.published || entry.updated);
    return {
      guid: entry.id || entryLink || stableFallbackGuid("atom", [pickText(feed.title), title, publishedAt, contentText]),
      title,
      link: toSafeAbsoluteUrl(entryLink, feed.link?.href || "") || "",
      author: entry.author?.name || "",
      summary: pickText(entry.summary),
      contentHtml: html,
      contentText,
      publishedAt
    };
  });
}

export async function fetchFeed(feedUrl, options = {}) {
  if (isBuiltinFeedUrl(feedUrl)) {
    return fetchBuiltinFeed(feedUrl, options);
  }

  return requestWithBrowserFallback(
    feedUrl,
    { ...options, kind: "feed" },
    {
      onBody({ body, contentType, profile }) {
        const forcedFormat = String(options.feedFormat || "").trim().toLowerCase() || "auto";
        if (forcedFormat === "html") {
          try {
            const items = mapHtmlItems(body, feedUrl, options);
            return {
              value: {
                meta: {
                  title: feedUrl,
                  description: "",
                  siteUrl: feedUrl
                },
                items
              }
            };
          } catch (error) {
            return { error };
          }
        }
        const looksLikeJson = /application\/json|text\/json/i.test(contentType) || /^[\[{]/.test(String(body || "").trim());
        if (forcedFormat === "json" || (forcedFormat === "auto" && looksLikeJson)) {
          try {
            if (looksLikeHtmlDocument(body, contentType)) {
              const mapping = discoverJsonFeedMappingFromHtml(body, feedUrl);
              if (!mapping?.payload) {
                throw new Error("No JSON feed mapping found in HTML");
              }
              const items = mapJsonItems(mapping.payload, feedUrl, options);
              return {
                value: {
                  meta: {
                    title: feedUrl,
                    description: "",
                    siteUrl: feedUrl
                  },
                  items
                }
              };
            }
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
            error: badGateway(FEED_ACCESS_CHALLENGE_MESSAGE, {
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

function classifyAlternateFeedType(type = "", href = "") {
  const normalizedType = String(type || "").trim().toLowerCase();
  const normalizedHref = String(href || "").trim().toLowerCase();
  if (/application\/(rss|atom|feed|rdf)\+xml|application\/xml|text\/xml/.test(normalizedType)) return "feed";
  if (/application\/feed\+json|application\/json|text\/json/.test(normalizedType)) return "feed";
  if (/\b(rss|atom|feed|rdf|jsonfeed)\b/.test(normalizedHref)) return "maybe";
  return "";
}

function scoreDiscoveredFeed(candidate = {}) {
  let score = 0;
  const type = String(candidate.type || "").toLowerCase();
  const title = String(candidate.title || "").toLowerCase();
  const url = String(candidate.url || "").toLowerCase();
  if (/rss/.test(type) || /rss/.test(title) || /rss/.test(url)) score += 45;
  if (/atom/.test(type) || /atom/.test(title) || /atom/.test(url)) score += 40;
  if (/feed\+json|jsonfeed/.test(type) || /json/.test(url)) score += 30;
  if (/comments|comment|评论/.test(title) || /comments|comment/.test(url)) score -= 30;
  if (/tag|category|author/.test(url)) score -= 8;
  return score;
}

function discoverFeedLinksFromHtml(body = "", pageUrl = "") {
  const $ = cheerio.load(body);
  const seen = new Set();
  const feeds = [];

  $("link[rel]").each((_, element) => {
    const node = $(element);
    const rel = String(node.attr("rel") || "").toLowerCase();
    if (!rel.split(/\s+/).includes("alternate")) return;
    const href = node.attr("href") || "";
    const kind = classifyAlternateFeedType(node.attr("type") || "", href);
    if (!kind) return;
    const resolved = toSafeAbsoluteUrl(href, pageUrl, { allowRelative: true });
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    feeds.push({
      url: resolved,
      title: normalizeText(node.attr("title") || ""),
      type: normalizeText(node.attr("type") || ""),
      source: "html_link",
      confidence: kind === "feed" ? "high" : "medium"
    });
  });

  return feeds.sort((a, b) => scoreDiscoveredFeed(b) - scoreDiscoveredFeed(a));
}

export async function discoverFeedLinks(pageUrl, options = {}) {
  if (!isHttpUrl(pageUrl)) {
    return { pageUrl, siteTitle: "", siteDescription: "", feeds: [] };
  }

  const result = await requestWithBrowserFallback(
    pageUrl,
    { ...options, kind: "article" },
    {
      onBody({ body, contentType, profile }) {
        const feedKind = classifyAlternateFeedType(contentType, pageUrl);
        if (feedKind === "feed" && !looksLikeHtmlDocument(body, contentType)) {
          return {
            value: {
              pageUrl,
              siteTitle: "",
              siteDescription: "",
              feeds: [{ url: pageUrl, title: "", type: contentType, source: "direct", confidence: "high" }]
            }
          };
        }

        if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
          return {
            retry: true,
            error: badGateway(FEED_ACCESS_CHALLENGE_MESSAGE, {
              code: "feed_request_access_challenge"
            })
          };
        }

        if (!looksLikeHtmlDocument(body, contentType)) {
          return {
            value: { pageUrl, siteTitle: "", siteDescription: "", feeds: [] }
          };
        }

        const $ = cheerio.load(body);
        const siteTitle = extractDocumentTitle($, pageUrl);
        const siteDescription = trimText(
          $("meta[name='description']").attr("content") ||
            $("meta[property='og:description']").attr("content") ||
            $("meta[name='twitter:description']").attr("content") ||
            "",
          500
        );

        return {
          value: {
            pageUrl,
            siteTitle,
            siteDescription,
            feeds: discoverFeedLinksFromHtml(body, pageUrl)
          }
        };
      }
    }
  );

  return result || { pageUrl, siteTitle: "", siteDescription: "", feeds: [] };
}

export async function discoverJsonFeedMapping(pageUrl, options = {}) {
  if (!isHttpUrl(pageUrl)) {
    return null;
  }

  return requestWithBrowserFallback(
    pageUrl,
    { ...options, kind: "article" },
    {
      onBody({ body, contentType, profile }) {
        if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
          return {
            retry: true,
            error: badGateway(FEED_ACCESS_CHALLENGE_MESSAGE, {
              code: "feed_request_access_challenge"
            })
          };
        }
        if (!looksLikeHtmlDocument(body, contentType)) {
          return { value: null };
        }
        return {
          value: discoverJsonFeedMappingFromHtml(body, pageUrl)
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
            error: badGateway(ARTICLE_ACCESS_CHALLENGE_MESSAGE, {
              code: "article_request_access_challenge"
            })
          };
        }

        let selectedBody;
        try {
          selectedBody = applyHtmlRange(body, options);
        } catch (error) {
          return {
            retry: profile === "bot",
            error
          };
        }

        const $ = cheerio.load(selectedBody);
        const metadata$ = selectedBody === body ? $ : cheerio.load(body);
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
        const root = customSelector
          ? selectBestArticleRoot($, [customSelector], articleUrl) || selectBestArticleRoot($, candidates, articleUrl)
          : selectBestArticleRoot($, candidates, articleUrl);
        const selected = root || $("body");
        const cleaned = cleanArticleRoot($, selected);
        const text = extractStructuredText($, cleaned);
        const selectedHtml = cleaned.html() || "";

        if (isLikelyInvalidArticleContent({ articleUrl, text, html: selectedHtml })) {
          if (profile === "bot" && looksLikeAccessChallenge(body, contentType)) {
            return {
              retry: true,
              error: badGateway(ARTICLE_ACCESS_CHALLENGE_MESSAGE, {
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

        const mainImageUrl =
          extractMainImageUrl($, cleaned, articleUrl) ||
          (metadata$ === $ ? "" : extractMainImageUrl(metadata$, metadata$("body"), articleUrl));
        const contentHtml = addMainImageToArticleHtml(sanitizeHtmlFragment(selectedHtml, articleUrl), mainImageUrl, articleUrl);
        const originalUrl = extractCanonicalUrl(metadata$, articleUrl);
        const title = extractDocumentTitle(metadata$, articleUrl);

        return {
          value: { html: contentHtml, text, originalUrl, title }
        };
      }
    }
  );
}
