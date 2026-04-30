import { badGateway, badRequest, forbidden } from "../lib/errors.js";

function normalizeConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    baseUrl: String(config.baseUrl || "").replace(/\/$/, ""),
    apiKey: String(config.apiKey || "").trim(),
    model: String(config.model || "").trim() || "gpt-4.1-mini",
    translatePrompt:
      String(config.translatePrompt || "").trim() ||
      "Translate the article into Simplified Chinese. Preserve structure and proper nouns where appropriate.",
    summaryPrompt:
      String(config.summaryPrompt || "").trim() ||
      "Summarize the article in Simplified Chinese with key points, risks, and actionable takeaways."
  };
}

export function createAiClient() {
  function describeFetchError(error) {
    const code = String(error?.cause?.code || error?.code || "").trim().toUpperCase();
    if (code === "ENOTFOUND") return "域名无法解析";
    if (code === "ECONNREFUSED") return "连接被拒绝";
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "连接超时";
    return String(error?.message || "连接失败").trim();
  }

  async function runTask(runtimeConfig, systemPrompt, content) {
    const config = normalizeConfig(runtimeConfig);
    if (!config.enabled) {
      throw forbidden("AI 功能已关闭", { code: "ai_disabled" });
    }
    if (!config.baseUrl || !config.apiKey) {
      throw badRequest("AI 接口未配置，请先在后台或会员中心填写接口地址和 API Key", { code: "ai_provider_unconfigured" });
    }

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
            { role: "user", content }
          ]
        })
      });
    } catch (error) {
      throw badGateway(`AI 接口连接失败: ${describeFetchError(error)}`, {
        code: "ai_request_failed"
      });
    }

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
