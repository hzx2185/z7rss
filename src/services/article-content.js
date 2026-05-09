import { normalizeText as normalizeReadableText } from "../lib/http.js";

const RELEVANCE_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "amid",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "but",
  "by",
  "can",
  "could",
  "for",
  "from",
  "has",
  "have",
  "her",
  "his",
  "how",
  "into",
  "its",
  "may",
  "more",
  "new",
  "not",
  "of",
  "off",
  "on",
  "one",
  "or",
  "our",
  "out",
  "over",
  "said",
  "say",
  "says",
  "she",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "was",
  "were",
  "when",
  "will",
  "with",
  "would",
  "you",
  "your"
]);

function getRelevanceTokens(value = "") {
  const normalized = normalizeReadableText(value)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ");
  const latinTokens = normalized.match(/[a-z][a-z0-9'-]{2,}/g) || [];
  const hanTokens = normalized.match(/\p{Script=Han}{2,}/gu) || [];
  return [...new Set([...latinTokens, ...hanTokens].filter((token) => token.length >= 4 && !RELEVANCE_STOPWORDS.has(token)))];
}

function countTokenMatches(tokens, haystack = "") {
  const normalizedHaystack = ` ${normalizeReadableText(haystack).toLowerCase()} `;
  return tokens.filter((token) => normalizedHaystack.includes(token)).length;
}

function getHostname(articleUrl = "") {
  try {
    return new URL(String(articleUrl || "").trim()).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

export function isV2exHost(articleUrl = "") {
  return /(^|\.)v2ex\.com$/i.test(getHostname(articleUrl));
}

export function isSmzdmHost(articleUrl = "") {
  return /(^|\.)smzdm\.com$/i.test(getHostname(articleUrl));
}

function isLikelyInvalidSmzdmContent({ text = "", author = "", summary = "" } = {}) {
  const normalizedText = normalizeReadableText(text);
  const normalizedAuthor = normalizeReadableText(author);
  const normalizedSummary = normalizeReadableText(summary);
  if (!normalizedText) {
    return false;
  }

  if (/^本文来自\s*什么值得买网站/u.test(normalizedText) && normalizedText.length <= 40) {
    return true;
  }

  if (normalizedAuthor && normalizedText === normalizedAuthor && normalizedText.length <= 24) {
    return true;
  }

  const containsSentencePunctuation = /[，。！？；：,.!?;:]/u.test(normalizedText);
  if (!containsSentencePunctuation && normalizedText.length <= 16 && normalizedSummary.length >= Math.max(30, normalizedText.length * 2)) {
    return true;
  }

  return false;
}

export function isLikelyInvalidArticleContent({ articleUrl = "", text = "", html = "", author = "", summary = "" } = {}) {
  const normalizedText = normalizeReadableText(text);
  const normalizedHtml = String(html || "");

  if (isV2exHost(articleUrl)) {
    const hasLoginShellText = /^首页\s*注册\s*登录(?:\s|$)/u.test(normalizedText);
    const hasLoginShellHtml =
      /class=(["'])site-nav\1/i.test(normalizedHtml) ||
      /href=(["'])https:\/\/www\.v2ex\.com\/signin\1/i.test(normalizedHtml) ||
      /href=(["'])\/signin\1/i.test(normalizedHtml);
    const hasArticleMarker = /topic_content|markdown_body/i.test(normalizedHtml);

    if ((hasLoginShellText && normalizedText.length <= 80) || (hasLoginShellHtml && !hasArticleMarker && normalizedText.length <= 200)) {
      return true;
    }
  }

  if (isSmzdmHost(articleUrl) && isLikelyInvalidSmzdmContent({ text: normalizedText, author, summary })) {
    return true;
  }

  return false;
}

export function isLikelyUnrelatedArticleContent({
  sourceTitle = "",
  sourceSummary = "",
  text = "",
  html = ""
} = {}) {
  const normalizedText = normalizeReadableText(text || html);
  if (normalizedText.length < 80) {
    return false;
  }

  const sourceTokens = getRelevanceTokens(`${sourceTitle} ${sourceSummary}`);
  if (sourceTokens.length < 3) {
    return false;
  }

  const titleTokens = getRelevanceTokens(sourceTitle);
  const sourceMatches = countTokenMatches(sourceTokens, normalizedText);
  const titleMatches = countTokenMatches(titleTokens, normalizedText);
  const sourceRatio = sourceMatches / sourceTokens.length;
  const titleRatio = titleTokens.length ? titleMatches / titleTokens.length : 1;

  return sourceMatches === 0 || (sourceRatio < 0.15 && titleRatio < 0.25 && titleMatches < 2);
}

function hasUsableStoredContent({ articleUrl = "", text = "", html = "", author = "", summary = "" } = {}) {
  const normalizedText = normalizeReadableText(text);
  const normalizedHtml = String(html || "").trim();
  if (!normalizedText && !normalizedHtml) {
    return false;
  }

  return !isLikelyInvalidArticleContent({
    articleUrl,
    text: normalizedText,
    html: normalizedHtml,
    author,
    summary
  });
}

export function hasUsableStoredArticleContent(item) {
  return hasUsableStoredContent({
    articleUrl: item?.original_url || item?.link || "",
    text: item?.content_text || "",
    html: item?.content_html || "",
    author: item?.author || "",
    summary: item?.summary || ""
  });
}

export function hasUsableStoredPageContent(item) {
  return hasUsableStoredContent({
    articleUrl: item?.original_url || item?.link || "",
    text: item?.page_text || "",
    html: item?.page_html || "",
    author: item?.author || "",
    summary: item?.summary || ""
  });
}

export function getReadableTextLength(value = "") {
  return normalizeReadableText(value).length;
}
