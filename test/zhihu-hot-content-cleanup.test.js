import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-zhihu-hot-cleanup-"));
  const db = createDb(path.join(dir, "rss.db"));
  const store = createStore(db);
  return { store };
}

test("clearMetricOnlyContentForFeed clears only Zhihu hot metric bodies", () => {
  const { store } = createTempStore();
  const user = store.createUser({
    email: "zhihu-cleanup@example.com",
    passwordHash: "hash",
    displayName: "Reader",
    isAdmin: 0,
    status: "active"
  });
  const feed = store.getOrCreateFeed({
    title: "知乎热榜",
    url: "https://www.zhihu.com/hot",
    siteUrl: "https://www.zhihu.com/hot",
    description: ""
  });
  store.linkUserFeed(user.id, feed.id, "知乎热榜");

  store.upsertItems(feed.id, [
    {
      guid: "metric-only",
      title: "只有热度",
      link: "https://www.zhihu.com/question/1",
      summary: "102 万热度",
      contentHtml: "<p>102 万热度</p>",
      contentText: "102 万热度",
      publishedAt: "2026-05-29T00:00:00.000Z"
    },
    {
      guid: "real-summary",
      title: "真实摘要",
      link: "https://www.zhihu.com/question/2",
      summary: "这是一段摘要",
      contentHtml: "<p>这是一段摘要</p>",
      contentText: "这是一段摘要",
      publishedAt: "2026-05-28T00:00:00.000Z"
    }
  ]);

  assert.equal(store.clearMetricOnlyContentForFeed(feed.id), 1);

  const items = store.listUserItems(user.id, feed.id, 10);
  const metricOnly = items.find((item) => item.title === "只有热度");
  const realSummary = items.find((item) => item.title === "真实摘要");
  assert.equal(metricOnly.summary, "");
  assert.equal(metricOnly.content_excerpt, "");
  assert.equal(metricOnly.content_loaded, 0);
  assert.equal(realSummary.summary, "这是一段摘要");
  assert.equal(realSummary.content_loaded, 1);
});
