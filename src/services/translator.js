import { badGateway, badRequest } from "../lib/errors.js";
import { describeFetchError } from "../lib/http.js";

const SERVER_TRANSLATION_PROVIDERS = new Set(["ai", "google", "bing", "deeplx"]);
const PROVIDER_LABELS = {
  local: "本地转换",
  ai: "AI 翻译",
  google: "谷歌翻译",
  bing: "必应翻译",
  deeplx: "DeepLX 翻译",
  sogou: "搜狗翻译"
};
const PROVIDER_TARGET_CODES = {
  ai: {
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    en: "en",
    ja: "ja",
    ko: "ko"
  },
  google: {
    "zh-CN": "zh-CN",
    "zh-TW": "zh-TW",
    en: "en",
    ja: "ja",
    ko: "ko"
  },
  bing: {
    "zh-CN": "zh-Hans",
    "zh-TW": "zh-Hant",
    en: "en",
    ja: "ja",
    ko: "ko"
  },
  deeplx: {
    "zh-CN": "ZH",
    "zh-TW": "ZH-HANT",
    en: "EN",
    ja: "JA",
    ko: "KO"
  },
  sogou: {
    "zh-CN": "zh-CHS",
    "zh-TW": "zh-CHT",
    en: "en",
    ja: "ja",
    ko: "ko"
  }
};

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function parseResponseError(payload, fallbackText = "") {
  if (!payload) return String(fallbackText || "").trim();
  if (typeof payload === "string") return payload.trim();
  if (typeof payload.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (Array.isArray(payload.error?.details) && payload.error.details.length) {
    return payload.error.details
      .map((entry) => String(entry?.message || "").trim())
      .filter(Boolean)
      .join("; ");
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.msg === "string" && payload.msg.trim()) {
    return payload.msg.trim();
  }
  return String(fallbackText || "").trim();
}

function parseResponseErrorCode(payload) {
  const code = payload?.error?.code ?? payload?.code ?? "";
  return String(code || "").trim();
}

function readGoogleWebTranslation(payload) {
  if (!Array.isArray(payload)) return "";
  const segments = Array.isArray(payload[0]) ? payload[0] : [];
  return segments
    .map((entry) => (Array.isArray(entry) ? String(entry[0] || "") : ""))
    .join("")
    .trim();
}

function normalizeAzureRegion(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function buildBingTranslateUrl(baseUrl, target) {
  const normalizedBaseUrl =
    String(baseUrl || "").trim().replace(/[,\/]+$/, "") || "https://api.cognitive.microsofttranslator.com";
  const params = `api-version=3.0&to=${encodeURIComponent(target)}&textType=plain`;
  let parsed;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch (_error) {
    return `${normalizedBaseUrl}/translate?${params}`;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/translate")) {
    parsed.search = parsed.search ? `${parsed.search}&to=${encodeURIComponent(target)}&textType=plain` : `?${params}`;
    return parsed.toString();
  }

  if (path.endsWith("/translator/text/v3.0")) {
    parsed.pathname = `${path}/translate`;
  } else if (parsed.hostname === "api.cognitive.microsofttranslator.com") {
    parsed.pathname = `${path}/translate`;
  } else if (parsed.hostname.endsWith(".cognitiveservices.azure.com")) {
    parsed.pathname = `${path}/translator/text/v3.0/translate`;
  } else {
    parsed.pathname = `${path}/translate`;
  }
  parsed.search = `?${params}`;
  return parsed.toString();
}

export function getTranslationProviderLabel(provider) {
  return PROVIDER_LABELS[String(provider || "").trim()] || "翻译";
}

export function getProviderTargetCode(provider, targetLanguage) {
  const normalizedProvider = String(provider || "ai").trim().toLowerCase();
  const normalizedLanguage = String(targetLanguage || "zh-CN").trim();
  return (
    PROVIDER_TARGET_CODES[normalizedProvider]?.[normalizedLanguage] ||
    PROVIDER_TARGET_CODES[normalizedProvider]?.["zh-CN"] ||
    normalizedLanguage
  );
}

export function supportsServerTranslation(provider) {
  return SERVER_TRANSLATION_PROVIDERS.has(String(provider || "").trim().toLowerCase());
}

export function createTranslator({ ai }) {
  async function translateWithGoogle(runtimeConfig, text) {
    const apiKey = String(runtimeConfig?.apiKey || "").trim();
    const target = getProviderTargetCode("google", runtimeConfig?.targetLanguage);
    let response;
    if (apiKey) {
      const params = new URLSearchParams({ key: apiKey });
      try {
        response = await fetch(`https://translation.googleapis.com/language/translate/v2?${params}`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            q: [String(text || "")],
            target,
            format: "text"
          })
        });
      } catch (error) {
        throw badGateway(`谷歌翻译连接失败: ${describeFetchError(error)}`, {
          code: "translation_request_failed"
        });
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorText = parseResponseError(payload);
        const authHint =
          response.status === 400 && /api key not valid|api_key_invalid|key not valid/i.test(errorText)
            ? " 请确认这是已启用 Cloud Translation API 的 Google Cloud API Key；如果想使用免 Key 翻译，请清空谷歌翻译 API Key。"
            : "";
        throw badGateway(`谷歌翻译请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}${authHint}`, {
          code: "translation_request_failed"
        });
      }

      return decodeHtmlEntities(payload?.data?.translations?.[0]?.translatedText || "");
    }

    const params = new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: target,
      dt: "t",
      q: String(text || "")
    });
    try {
      response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
    } catch (error) {
      throw badGateway(`谷歌翻译免 Key 连接失败: ${describeFetchError(error)}`, {
        code: "translation_request_failed"
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorText = parseResponseError(payload);
      throw badGateway(`谷歌翻译免 Key 请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}`, {
        code: "translation_request_failed"
      });
    }

    return decodeHtmlEntities(readGoogleWebTranslation(payload));
  }

  async function translateWithBing(runtimeConfig, text) {
    const apiKey = String(runtimeConfig?.apiKey || "").trim();
    if (!apiKey) {
      throw badRequest("系统未配置必应翻译 API Key", { code: "translation_provider_unconfigured" });
    }

    const target = getProviderTargetCode("bing", runtimeConfig?.targetLanguage);
    const url = buildBingTranslateUrl(runtimeConfig?.baseUrl, target);
    const region = normalizeAzureRegion(runtimeConfig?.region);
    const createHeaders = (includeRegion = true) => ({
      "content-type": "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
      ...(includeRegion && region
        ? { "Ocp-Apim-Subscription-Region": region }
        : {})
    });
    const body = JSON.stringify([{ Text: String(text || "") }]);
    let response;
    let sentRegion = Boolean(region);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: createHeaders(true),
        body
      });
      if (response.status === 401 && region) {
        response = await fetch(url, {
          method: "POST",
          headers: createHeaders(false),
          body
        });
        sentRegion = false;
      }
    } catch (error) {
      throw badGateway(`必应翻译连接失败: ${describeFetchError(error)}`, {
        code: "translation_request_failed"
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorText = parseResponseError(payload);
      const errorCode = parseResponseErrorCode(payload);
      const errorDetail = errorCode ? ` 错误码: ${errorCode}.` : "";
      const authHint =
        response.status === 401
          ? ` 微软返回认证失败，这不是额度用完；请确认 API Key 来自 Translator 资源、Region 与资源一致，Endpoint 使用资源页的地址或 https://api.cognitive.microsofttranslator.com。${
              !region ? " 当前未配置 Region，大多数 Azure Translator 资源是区域资源，需要在后台填写 Region（如 eastasia、southeastasia）。" : sentRegion ? "" : " 已自动尝试不带 Region 的全局资源认证。"
            }`
          : response.status === 403
            ? " 微软拒绝访问，通常是订阅、权限、资源类型或配额状态不允许当前请求。"
            : response.status === 429
              ? " 微软返回限流或额度耗尽，请稍后重试或检查 Azure Translator 配额。"
              : "";
      throw badGateway(`必应翻译请求失败: ${response.status}${errorCode ? ` ${errorCode}` : ""}${errorText ? ` ${errorText}` : ""}${errorDetail}${authHint}`, {
        code: "translation_request_failed"
      });
    }

    return String(payload?.[0]?.translations?.[0]?.text || "").trim();
  }

  async function translateWithDeepLX(runtimeConfig, text) {
    const baseUrl = String(runtimeConfig?.baseUrl || "").trim().replace(/\/$/, "");
    if (!baseUrl) {
      throw badRequest("系统未配置 DeepLX 接口地址", { code: "translation_provider_unconfigured" });
    }

    const apiKey = String(runtimeConfig?.apiKey || "").trim();
    const target = getProviderTargetCode("deeplx", runtimeConfig?.targetLanguage);
    let response;
    try {
      response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          text: String(text || ""),
          source_lang: "auto",
          target_lang: target
        })
      });
    } catch (error) {
      throw badGateway(`DeepLX 接口连接失败: ${describeFetchError(error)}`, {
        code: "translation_request_failed"
      });
    }

    const payload = await response.json().catch(() => null);
    const payloadCode = Number(payload?.code || 0);
    if (!response.ok || (payloadCode && payloadCode >= 400)) {
      const errorText = parseResponseError(payload);
      const hint =
        response.status === 418
          ? " 当前接口主动拒绝请求，通常是地址或密钥路径无效、公共实例限流，或服务端风控。"
          : "";
      throw badGateway(`DeepLX 翻译请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}${hint}`, {
        code: "translation_request_failed"
      });
    }

    return String(payload?.data || "").trim();
  }

  return {
    async translate(runtimeConfig, text) {
      const provider = String(runtimeConfig?.provider || "ai").trim().toLowerCase();
      const sourceText = String(text || "").trim();
      if (!sourceText) return "";

      if (provider === "google") {
        return translateWithGoogle(runtimeConfig, sourceText);
      }
      if (provider === "bing") {
        return translateWithBing(runtimeConfig, sourceText);
      }
      if (provider === "deeplx") {
        return translateWithDeepLX(runtimeConfig, sourceText);
      }
      if (provider === "sogou") {
        throw badRequest("搜狗翻译暂不支持站内翻译，请改用谷歌、必应或 AI 翻译。", {
          code: "translation_provider_unsupported"
        });
      }
      return ai.translate(runtimeConfig, sourceText);
    }
  };
}
