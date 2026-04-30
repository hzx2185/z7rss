const SharedSettings = (function () {
  async function saveTranslation(settings, api, setStatus) {
    const { provider, target, auto, display, googleBaseUrl, googleApiKey, bingBaseUrl, bingApiKey, bingRegion, deeplxBaseUrl, deeplxApiKey } = settings;
    await api("/api/account/preferences/translation", {
      method: "POST",
      body: JSON.stringify({
        provider: provider?.value || undefined,
        targetLanguage: target?.value || undefined,
        autoTranslate: auto?.checked || false,
        displayTranslated: display?.checked || false
      })
    });

    const selected = provider?.value || "google";
    if (selected === "google") {
      await api("/api/account/preferences/translation-provider/google", {
        method: "POST",
        body: JSON.stringify({ baseUrl: googleBaseUrl?.value || "", apiKey: googleApiKey?.value || "" })
      });
    } else if (selected === "bing") {
      await api("/api/account/preferences/translation-provider/bing", {
        method: "POST",
        body: JSON.stringify({ baseUrl: bingBaseUrl?.value || "", apiKey: bingApiKey?.value || "", region: bingRegion?.value || "" })
      });
    } else if (selected === "deeplx") {
      await api("/api/account/preferences/translation-provider/deeplx", {
        method: "POST",
        body: JSON.stringify({ baseUrl: deeplxBaseUrl?.value || "", apiKey: deeplxApiKey?.value || "" })
      });
    }
  }

  async function resetTranslationProvider(provider, api) {
    const path = {
      google: "/api/account/preferences/translation-provider/google/reset",
      bing: "/api/account/preferences/translation-provider/bing/reset",
      deeplx: "/api/account/preferences/translation-provider/deeplx/reset"
    }[provider];
    if (path) await api(path, { method: "POST" });
    return { google: "Google 已恢复系统默认", bing: "必应翻译已恢复系统默认", deeplx: "DeepLX 已恢复系统默认" }[provider] || "";
  }

  async function saveAi(settings, api) {
    const { baseUrl, apiKey, model, translatePrompt, summaryPrompt } = settings;
    await api("/api/account/preferences/ai", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: baseUrl?.value || "",
        apiKey: apiKey?.value || "",
        model: model?.value || "",
        translatePrompt: translatePrompt?.value || "",
        summaryPrompt: summaryPrompt?.value || ""
      })
    });
  }

  async function resetAi(api) {
    await api("/api/account/preferences/ai/reset", { method: "POST" });
  }

  function getSelectedTranslationProvider(providerEl) {
    return providerEl?.value || "google";
  }

  function toggleTranslationProviderConfigs(configs, selected) {
    const map = { google: "google", bing: "bing", deeplx: "deeplx" };
    Object.entries(configs).forEach(([key, el]) => {
      if (el) el.classList.toggle("hidden", map[key] !== selected);
    });
  }

  function bindTranslationProviderChange(providerEl, configs) {
    if (providerEl) {
      providerEl.addEventListener("change", () => {
        toggleTranslationProviderConfigs(configs, providerEl.value);
      });
    }
  }

  function applyTranslationState(state, els, prefs) {
    const google = prefs?.translation_google || {};
    const bing = prefs?.translation_bing || {};
    const deeplx = prefs?.translation_deeplx || {};

    if (els.googleBaseUrl) els.googleBaseUrl.value = google.base_url || "";
    if (els.googleApiKey) {
      els.googleApiKey.value = "";
      els.googleApiKey.placeholder = google.api_key_unavailable
        ? "旧密钥不可用，请重新保存"
        : google.api_key_configured
          ? "已配置，留空表示保留原值"
          : "留空则使用 Google 免 Key 模式";
    }
    if (els.bingBaseUrl) els.bingBaseUrl.value = bing.base_url || "";
    if (els.bingApiKey) {
      els.bingApiKey.value = "";
      els.bingApiKey.placeholder = bing.api_key_unavailable
        ? "旧密钥不可用，请重新保存"
        : bing.api_key_configured
          ? "已配置，留空表示保留原值"
          : "";
    }
    if (els.bingRegion) els.bingRegion.value = bing.region || "";
    if (els.deeplxBaseUrl) els.deeplxBaseUrl.value = deeplx.base_url || "";
    if (els.deeplxApiKey) {
      els.deeplxApiKey.value = "";
      els.deeplxApiKey.placeholder = deeplx.api_key_unavailable
        ? "旧密钥不可用，请重新保存"
        : deeplx.api_key_configured
          ? "已配置，留空表示保留原值"
          : "";
    }
  }

  function applyAiState(els, ai) {
    if (els.baseUrl) els.baseUrl.value = ai.base_url || "";
    if (els.apiKey) {
      els.apiKey.value = "";
      els.apiKey.placeholder = ai.api_key_unavailable
        ? "旧密钥不可用，请重新保存"
        : ai.api_key_configured
          ? "已配置，留空表示保留原值"
          : "";
    }
    if (els.model) els.model.value = ai.model || "";
    if (els.translatePrompt) els.translatePrompt.value = ai.translate_prompt || "";
    if (els.summaryPrompt) els.summaryPrompt.value = ai.summary_prompt || "";
  }

  return {
    saveTranslation,
    resetTranslationProvider,
    saveAi,
    resetAi,
    getSelectedTranslationProvider,
    toggleTranslationProviderConfigs,
    bindTranslationProviderChange,
    applyTranslationState,
    applyAiState
  };
})();
