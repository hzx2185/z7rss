import { badGateway, badRequest } from "../lib/errors.js";

const SERVER_TRANSLATION_PROVIDERS = new Set(["ai", "google", "bing", "deeplx"]);
const PROVIDER_LABELS = {
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

function readGoogleWebTranslation(payload) {
  if (!Array.isArray(payload)) return "";
  const segments = Array.isArray(payload[0]) ? payload[0] : [];
  return segments
    .map((entry) => (Array.isArray(entry) ? String(entry[0] || "") : ""))
    .join("")
    .trim();
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
  function describeFetchError(error) {
    const code = String(error?.cause?.code || error?.code || "").trim().toUpperCase();
    if (code === "ENOTFOUND") return "域名无法解析";
    if (code === "ECONNREFUSED") return "连接被拒绝";
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "连接超时";
    return String(error?.message || "连接失败").trim();
  }

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
        throw badGateway(`谷歌翻译请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}`, {
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

    const baseUrl = String(runtimeConfig?.baseUrl || "").trim().replace(/\/$/, "") || "https://api.cognitive.microsofttranslator.com";
    const target = getProviderTargetCode("bing", runtimeConfig?.targetLanguage);
    let response;
    try {
      response = await fetch(`${baseUrl}/translate?api-version=3.0&to=${encodeURIComponent(target)}&textType=plain`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Ocp-Apim-Subscription-Key": apiKey,
          ...(String(runtimeConfig?.region || "").trim()
            ? { "Ocp-Apim-Subscription-Region": String(runtimeConfig.region).trim() }
            : {})
        },
        body: JSON.stringify([{ text: String(text || "") }])
      });
    } catch (error) {
      throw badGateway(`必应翻译连接失败: ${describeFetchError(error)}`, {
        code: "translation_request_failed"
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorText = parseResponseError(payload);
      throw badGateway(`必应翻译请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}`, {
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

    const target = getProviderTargetCode("deeplx", runtimeConfig?.targetLanguage);
    let response;
    try {
      response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
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
