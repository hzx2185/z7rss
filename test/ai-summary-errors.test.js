import assert from "node:assert/strict";
import test from "node:test";
import { badGateway } from "../src/lib/errors.js";
import { createItemService } from "../src/services/item-service.js";

function createSummaryHarness(options = {}) {
  const user = { id: 7 };
  const item = {
    id: 42,
    title: "AI summary source",
    content_text: "This article has enough content for an AI summary request."
  };
  const runtimes = options.runtimes ?? [
    {
      baseUrl: "https://ai.example.test/v1",
      apiKey: "test-key",
      label: "User AI",
      source: "user"
    }
  ];
  const store = {
    getUserItem(userId, itemId) {
      assert.equal(userId, user.id);
      assert.equal(itemId, item.id);
      return item;
    },
    updateSummary: options.updateSummary || (() => {})
  };
  const itemService = createItemService({
    feedService: {},
    translator: {},
    accountService: {
      getAccount() {
        return { features: { summary: true } };
      },
      getEffectiveAiRuntimes() {
        return runtimes;
      }
    },
    store,
    ai: options.ai
  });

  return { item, itemService, user };
}

test("summarizeItem preserves AI provider errors for the client", async () => {
  const { itemService, user } = createSummaryHarness({
    ai: {
      async summarize() {
        throw badGateway("AI 请求失败: 401 invalid_api_key", {
          code: "ai_request_failed"
        });
      }
    }
  });

  await assert.rejects(
    () => itemService.summarizeItem(user, 42),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.code, "ai_request_failed");
      assert.match(error.message, /AI 总结失败/);
      assert.match(error.message, /User AI: AI 请求失败: 401 invalid_api_key/);
      return true;
    }
  );
});

test("summarizeItem reports missing AI configuration as a client-visible setup error", async () => {
  const { itemService, user } = createSummaryHarness({
    runtimes: [],
    ai: {
      async summarize() {
        throw new Error("unexpected call");
      }
    }
  });

  await assert.rejects(
    () => itemService.summarizeItem(user, 42),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "ai_provider_unconfigured");
      assert.match(error.message, /AI 接口未配置/);
      return true;
    }
  );
});
