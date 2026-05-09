import { badGateway, badRequest, forbidden } from "../lib/errors.js";
import { describeFetchError } from "../lib/http.js";

function normalizeConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    baseUrl: String(config.baseUrl || "").replace(/\/$/, ""),
    apiKey: String(config.apiKey || "").trim(),
    model: String(config.model || "").trim() || "gpt-4.1-mini",
    maxInputChars: Number.isFinite(Number(config.maxInputChars)) ? Number(config.maxInputChars) : 0,
    translatePrompt:
      String(config.translatePrompt || "").trim() ||
      "Translate the article into Simplified Chinese. Preserve structure and proper nouns where appropriate.",
    summaryPrompt:
      String(config.summaryPrompt || "").trim() ||
      "Summarize the article in Simplified Chinese. Cover the core facts, context, key arguments, risks, and actionable takeaways. Keep it concise but complete; do not over-compress important details."
  };
}

export function createAiClient() {
  async function runTask(runtimeConfig, systemPrompt, content) {
    const config = normalizeConfig(runtimeConfig);
    if (!config.enabled) {
      throw forbidden("AI 功能已关闭", { code: "ai_disabled" });
    }
    if (!config.baseUrl || !config.apiKey) {
      throw badRequest("AI 接口未配置，请先在后台或会员中心填写接口地址和 API Key", { code: "ai_provider_unconfigured" });
    }

    const maxChars = config.maxInputChars > 0 ? config.maxInputChars : 0;
    const inputText = maxChars > 0 && content.length > maxChars
      ? `${content.slice(0, Math.max(0, maxChars - 1))}…`
      : content;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: inputText }
          ]
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        throw badGateway("AI 请求超时（30 秒），模型响应过慢或服务不可用", { code: "ai_request_timeout" });
      }
      throw badGateway(`AI 接口连接失败: ${describeFetchError(error)}`, {
        code: "ai_request_failed"
      });
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw badGateway(`AI 请求失败: ${response.status}${errorText ? ` ${errorText}` : ""}`, {
        code: "ai_request_failed"
      });
    }

    const data = await response.json().catch(() => null);
    if (!data?.choices?.[0]?.message?.content) {
      throw badGateway("AI 返回内容格式无效，缺少可用文本", { code: "ai_response_invalid" });
    }
    return data.choices?.[0]?.message?.content?.trim() || "";
  }

  return {
    translate(runtimeConfig, text) {
      const config = normalizeConfig(runtimeConfig);
      return runTask(config, config.translatePrompt, text);
    },
    summarize(runtimeConfig, text) {
      const config = normalizeConfig(runtimeConfig);
      return runTask(config, config.summaryPrompt, text);
    }
  };
}
