export function createAiConfigService({ store, accountService, ai }) {
  function getSystemAiConfig() {
    const rows = store.listSettings().filter((entry) => entry.category === "ai");
    const map = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    return {
      enabled: true,
      baseUrl: map.base_url || "",
      apiKey: map.api_key || "",
      model: map.model || "gpt-4.1-mini",
      translatePrompt: map.translate_prompt || "",
      summaryPrompt: map.summary_prompt || ""
    };
  }

  return {
    getSystemAiConfig,
    async testSystemAi() {
      const config = accountService.getEffectiveAiConfig(0);
      const output = await ai.summarize(config, "Please respond with OK.");
      return { ok: true, output };
    },
    async testUserAi(user) {
      const config = accountService.getEffectiveAiConfig(user.id);
      const output = await ai.summarize(config, "Please respond with OK.");
      return { ok: true, output, source: config.source };
    }
  };
}
