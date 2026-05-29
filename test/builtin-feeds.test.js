import assert from "node:assert/strict";
import test from "node:test";
import { fetchBuiltinFeed, matchBuiltinFeedInput, normalizeBuiltinFeedUrl } from "../src/services/builtin-feeds.js";

test("matchBuiltinFeedInput maps Zhihu hot page to an internal feed", () => {
  assert.deepEqual(matchBuiltinFeedInput("https://www.zhihu.com/hot"), {
    url: "builtin://zhihu/hot",
    source: "builtin",
    confidence: "high",
    title: "知乎热榜"
  });
  assert.equal(normalizeBuiltinFeedUrl("builtin://zhihu/hot"), "builtin://zhihu/hot");
});

test("fetchBuiltinFeed converts Zhihu hot API data into feed items", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true");
    return new Response(JSON.stringify({
      data: [
        {
          target: {
            id: 42,
            type: "question",
            title: "测试热榜问题",
            url: "https://api.zhihu.com/questions/42",
            excerpt: "这是一段摘要",
            created_time: 1710000000
          },
          detail_text: "123 万热度"
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await fetchBuiltinFeed("builtin://zhihu/hot", { timeoutMs: 1000 });
    assert.equal(result.meta.title, "知乎热榜");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "测试热榜问题");
    assert.equal(result.items[0].link, "https://www.zhihu.com/question/42");
    assert.equal(result.items[0].summary, "这是一段摘要");
    assert.equal(result.items[0].contentText, "这是一段摘要");
    assert.equal(result.items[0].contentHtml, "<p>这是一段摘要</p>");
    assert.doesNotMatch(result.items[0].contentText, /123 万热度/);
    assert.doesNotMatch(result.items[0].contentHtml, /123 万热度/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchBuiltinFeed does not use Zhihu hot metrics as article body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      {
        target: {
          id: 43,
          type: "question",
          title: "只有热度的问题",
          url: "https://api.zhihu.com/questions/43"
        },
        detail_text: "102 万热度"
      }
    ]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await fetchBuiltinFeed("builtin://zhihu/hot", { timeoutMs: 1000 });
    assert.equal(result.items[0].title, "只有热度的问题");
    assert.equal(result.items[0].summary, "");
    assert.equal(result.items[0].contentText, "");
    assert.equal(result.items[0].contentHtml, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
