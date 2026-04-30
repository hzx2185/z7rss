const TRANSLATION_TARGET_LABELS = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어"
}

const TRANSLATION_TARGET_CODES = {
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
}

export function getTranslationProviderLabel(provider) {
  if (provider === "google") return "谷歌翻译"
  if (provider === "bing") return "必应翻译"
  if (provider === "deeplx") return "DeepLX 翻译"
  if (provider === "sogou") return "搜狗翻译"
  return "AI 翻译"
}

export function supportsAutoTranslate(provider) {
  return provider === "ai" || provider === "google" || provider === "bing" || provider === "deeplx"
}

export function getTranslationTargetLabel(target) {
  return TRANSLATION_TARGET_LABELS[String(target || "").trim()] || String(target || "-")
}

export function getProviderTargetCode(provider, targetLanguage) {
  const normalizedProvider = String(provider || "google").trim().toLowerCase()
  const normalizedTarget = String(targetLanguage || "zh-CN").trim()
  return (
    TRANSLATION_TARGET_CODES[normalizedProvider]?.[normalizedTarget] ||
    TRANSLATION_TARGET_CODES[normalizedProvider]?.["zh-CN"] ||
    normalizedTarget
  )
}
