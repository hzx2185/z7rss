export function createAiConfigService({ accountService, ai, translator }) {
  return {
    async testAi(userId) {
      const runtimes = accountService.getEffectiveAiRuntimes(userId);
      const errors = [];
      for (const runtime of runtimes) {
        try {
          const output = await ai.summarize(runtime, "Please respond with OK.");
          return { ok: true, output, source: runtime.source, label: runtime.label };
        } catch (error) {
          errors.push(`${runtime.label || runtime.source}: ${error?.message || String(error)}`);
        }
      }
      if (!errors.length) {
        return { ok: false, output: "", error: userId === 0 ? "系统未配置任何有效的 AI 接口" : "未配置任何有效的 AI 接口" };
      }
      return { ok: false, output: "", error: `AI 测试失败。详情：${errors.join(" | ")}` };
    },
    async testAiRuntime(runtimeConfig, poolId) {
      const runtime = { ...runtimeConfig };
      if (runtime.apiKey === "__KEEP__" && poolId) {
        const pool = accountService.getSystemAiProviderPool();
        const stored = pool.find((entry) => String(entry?.id || "") === String(poolId));
        runtime.apiKey = stored?.apiKey || "";
        if (!runtime.baseUrl) runtime.baseUrl = stored?.baseUrl || "";
        if (!runtime.model) runtime.model = stored?.model || "";
      }
      try {
        const output = await ai.summarize(runtime, "Please respond with OK.");
        return { ok: true, output };
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    },
    async testSystemTranslation() {
      const settings = accountService.getEffectiveTranslationSettings(0);
      const primaryProvider = settings.provider || "ai";
      const fallbackProviders = accountService.getTranslationFallbackProviders();
      const allProviders = [primaryProvider, ...fallbackProviders].filter((p, i, a) => a.indexOf(p) === i);
      const sampleText = "Hello, this is a system translation test.";
      const errors = [];
      for (const provider of allProviders) {
        const runtimes = accountService.getEffectiveTranslationRuntimes(0, { provider, targetLanguage: settings.targetLanguage });
        for (const runtime of runtimes) {
          try {
            const output = await translator.translate(runtime, sampleText);
            return { ok: true, provider: runtime.provider, output, source: runtime.source || "system" };
          } catch (error) {
            errors.push(`${runtime.provider}: ${error?.message || String(error)}`);
          }
        }
      }
      if (!errors.length) {
        return { ok: false, provider: primaryProvider, output: "", error: "系统未配置任何有效的翻译 API" };
      }
      return { ok: false, provider: primaryProvider, output: "", error: `翻译测试失败。详情：${errors.join(" | ")}` };
    },
    async testTranslationRuntime(runtimeConfig, poolId) {
      const runtime = { ...runtimeConfig };
      if (runtime.apiKey === "__KEEP__" && poolId) {
        const targetLanguage = runtime.targetLanguage || "zh-CN";
        const runtimes = accountService.getEffectiveTranslationRuntimes(0, {
          provider: runtime.provider,
          targetLanguage
        });
        const storedRuntime = runtimes.find((entry) => String(entry?.id || "") === String(poolId));
        runtime.apiKey = storedRuntime?.apiKey || "";
        if (!runtime.baseUrl) runtime.baseUrl = storedRuntime?.baseUrl || "";
        if (!runtime.region) runtime.region = storedRuntime?.region || "";
        if (!runtime.model) runtime.model = storedRuntime?.model || "";
      }
      const sampleText = "Hello, this is a translation test.";
      try {
        const output = await translator.translate(runtime, sampleText);
        return { ok: true, provider: runtime.provider, output };
      } catch (error) {
        return { ok: false, provider: runtime.provider, error: error?.message || String(error) };
      }
    }
  };
}
