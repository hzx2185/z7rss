import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createSecretBox } from "../src/lib/secrets.js";
import { createAccountService } from "../src/services/account-service.js";
import { createAdminService } from "../src/services/admin-service.js";

function createHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-admin-template-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);
  const store = createStore(db);
  const config = { billingProvider: "demo", aiEnabled: true, dbPath };
  const secretBox = createSecretBox("test-secret");
  const accountService = createAccountService({ store, config, secretBox });
  return { db, store, accountService, config, secretBox };
}

test("admin template test reuses saved shared cookie when the form leaves it blank", async () => {
  const { db, store, accountService, config, secretBox } = createHarness();
  try {
    const calls = [];
    const feedService = {
      async testFetchAdapterTemplate(template, inputUrl) {
        calls.push({ template, inputUrl });
        return { ok: true, feedUrl: template.feedUrl, items: [] };
      }
    };
    const adminService = createAdminService({ store, accountService, config, secretBox, feedService });
    adminService.setFeedAdapterTemplates([
      {
        id: "zhihu-hot-json",
        name: "知乎热榜",
        enabled: true,
        match: "^https://www\\.zhihu\\.com/hot/?$",
        feedUrl: "builtin://zhihu/hot",
        feedFormat: "auto",
        requestProfile: "browser",
        cookie: "SESSION=abc"
      }
    ]);

    await adminService.testFeedAdapterTemplate({
      id: "zhihu-hot-json",
      name: "知乎热榜",
      enabled: true,
      match: "^https://www\\.zhihu\\.com/hot/?$",
      feedUrl: "builtin://zhihu/hot",
      feedFormat: "auto",
      requestProfile: "browser",
      cookie: ""
    }, "https://www.zhihu.com/hot");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].template.cookie, "SESSION=abc");
    assert.equal(calls[0].inputUrl, "https://www.zhihu.com/hot");
  } finally {
    db.close();
  }
});

test("admin can ask AI to suggest a feed adapter template draft", async () => {
  const { db, store, accountService, config, secretBox } = createHarness();
  const originalFetch = globalThis.fetch;
  try {
    store.setSetting("ai_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([
      {
        id: "ai-1",
        name: "AI One",
        baseUrl: "https://ai.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
        enabled: true,
        priority: 1
      }
    ])));
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://example.com/news");
      return new Response(`<!doctype html><article class="post"><h2><a href="/a">标题</a></h2><p class="summary">摘要</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    };
    const adminService = createAdminService({
      store,
      accountService,
      config,
      secretBox,
      feedService: null,
      ai: {
        async summarize(runtime, prompt) {
          assert.equal(runtime.baseUrl, "https://ai.example.test/v1");
          assert.match(prompt, /https:\/\/example\.com\/news/);
          return JSON.stringify({
            name: "Example News",
            match: "^https://example\\.com/news/?$",
            feedUrl: "{rawUrl}",
            feedFormat: "html",
            requestProfile: "browser",
            htmlItemsSelector: "article.post",
            htmlTitleSelector: "h2 a",
            htmlLinkSelector: "h2 a",
            htmlSummarySelector: ".summary",
            notes: "列表结构清晰"
          });
        }
      }
    });

    const result = await adminService.suggestFeedAdapterTemplate({ url: "https://example.com/news" });

    assert.equal(result.template.name, "Example News");
    assert.equal(result.template.feedFormat, "html");
    assert.equal(result.template.feedUrl, "{rawUrl}");
    assert.equal(result.template.htmlItemsSelector, "article.post");
    assert.equal(result.template.htmlTitleSelector, "h2 a");
    assert.equal(result.notes, "列表结构清晰");
    assert.equal(store.getSetting("feed_adapter_templates", "templates_json"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("admin AI template suggestion fills Juejin hot JSON rules when AI omits fields", async () => {
  const { db, store, accountService, config, secretBox } = createHarness();
  const originalFetch = globalThis.fetch;
  try {
    store.setSetting("ai_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([
      {
        id: "ai-1",
        name: "AI One",
        baseUrl: "https://ai.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
        enabled: true,
        priority: 1
      }
    ])));
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://juejin.cn/hot/articles/1");
      return new Response(`<!doctype html><main><div class="hot-list"></div><script>window.__NUXT__={route:{path:"/hot/articles/1"}}</script></main>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    };
    const adminService = createAdminService({
      store,
      accountService,
      config,
      secretBox,
      feedService: null,
      ai: {
        async summarize() {
          return JSON.stringify({
            template: {
              name: "掘金热榜"
            },
            notes: "页面列表由接口加载"
          });
        }
      }
    });

    const result = await adminService.suggestFeedAdapterTemplate({ url: "https://juejin.cn/hot/articles/1" });

    assert.equal(result.template.name, "掘金热榜");
    assert.equal(result.template.feedFormat, "json");
    assert.equal(result.template.feedUrl, "https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot");
    assert.equal(result.template.jsonItemsPath, "data");
    assert.equal(result.template.jsonTitlePath, "content.title");
    assert.equal(result.template.jsonLinkPath, "content.content_id");
    assert.equal(result.template.jsonSummaryPath, "content.brief");
    assert.match(result.template.match, /juejin/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("admin AI template suggestion falls back to local Juejin rules when AI input is too long", async () => {
  const { db, store, accountService, config, secretBox } = createHarness();
  const originalFetch = globalThis.fetch;
  try {
    store.setSetting("ai_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([
      {
        id: "ai-1",
        name: "AI One",
        baseUrl: "https://ai.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
        enabled: true,
        priority: 1
      }
    ])));
    globalThis.fetch = async () => new Response(`<!doctype html><main><div class="hot-list"></div><script>${"window.__NUXT__={};".repeat(5000)}</script></main>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
    const adminService = createAdminService({
      store,
      accountService,
      config,
      secretBox,
      feedService: null,
      ai: {
        async summarize(_runtime, prompt) {
          assert.ok(prompt.length < 18000);
          throw new Error('AI 请求失败: 400 {"code":20015,"message":"number of input tokens has exceeded max_seq_len limit."}');
        }
      }
    });

    const result = await adminService.suggestFeedAdapterTemplate({ url: "https://juejin.cn/hot/articles/1" });

    assert.equal(result.provider, "本地识别");
    assert.match(result.notes, /AI 生成失败/);
    assert.equal(result.template.feedFormat, "json");
    assert.equal(result.template.feedUrl, "https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot");
    assert.equal(result.template.jsonLinkPath, "content.content_id");
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("admin AI template suggestion fills Juejin recommended POST JSON rules when AI fails", async () => {
  const { db, store, accountService, config, secretBox } = createHarness();
  const originalFetch = globalThis.fetch;
  try {
    store.setSetting("ai_provider_pool", "configs_secret", secretBox.encrypt(JSON.stringify([
      {
        id: "ai-1",
        name: "AI One",
        baseUrl: "https://ai.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
        enabled: true,
        priority: 1
      }
    ])));
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://juejin.cn/recommended?sort=weekly_hottest");
      return new Response(`<!doctype html><main><div id="juejin"></div><script>window.__NUXT__={route:{path:"/recommended"}}</script></main>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    };
    const adminService = createAdminService({
      store,
      accountService,
      config,
      secretBox,
      feedService: null,
      ai: {
        async summarize() {
          throw new Error("AI 请求超时");
        }
      }
    });

    const result = await adminService.suggestFeedAdapterTemplate({ url: "https://juejin.cn/recommended?sort=weekly_hottest" });
    const requestBody = JSON.parse(result.template.requestBody);

    assert.equal(result.provider, "本地识别");
    assert.match(result.notes, /AI 生成失败/);
    assert.equal(result.template.feedFormat, "json");
    assert.equal(result.template.feedUrl, "https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed");
    assert.equal(result.template.requestMethod, "POST");
    assert.equal(requestBody.sort_type, 7);
    assert.equal(result.template.jsonItemsPath, "data");
    assert.equal(result.template.jsonTitlePath, "item_info.article_info.title");
    assert.equal(result.template.jsonLinkPath, "item_info.article_info.article_id");
    assert.equal(result.template.jsonSummaryPath, "item_info.article_info.brief_content");
    assert.match(result.template.match, /weekly_hottest/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
