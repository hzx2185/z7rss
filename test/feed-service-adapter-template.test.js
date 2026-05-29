import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createAccountService } from "../src/services/account-service.js";
import { createFeedService } from "../src/services/feed-service.js";

function createHarness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-feed-template-"));
  const db = createDb(path.join(dir, "rss.db"));
  const store = createStore(db);
  const user = store.createUser({
    email: `reader-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "hash",
    displayName: "Reader",
    isAdmin: 0,
    status: "active"
  });
  const accountService = createAccountService({
    store,
    config: { aiEnabled: true },
    secretBox: {
      decrypt(value) {
        return value;
      }
    }
  });
  const feedService = createFeedService({
    store,
    accountService,
    config: {
      crawlTimeoutMs: 1000,
      userAgent: "z7rss-test",
      rssHubBaseUrls: [],
      ...(options.config || {})
    }
  });
  return { feedService, store, user };
}

function rssFixture({ title, link, itemTitle = "One" }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>${link}</link>
    <description>${title}</description>
    <item>
      <title>${itemTitle}</title>
      <link>${link}article.html</link>
      <guid>${link}article.html</guid>
      <description>正文</description>
    </item>
  </channel>
</rss>`;
}

async function activatePlanForUser(store, userId, planCode) {
  const plan = store.getPlanByCode(planCode);
  store.setUserSubscription({
    userId,
    planId: plan.id,
    status: "active",
    provider: "test",
    providerCustomerId: null,
    providerSubscriptionId: `test-${userId}-${planCode}`,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: null
  });
}

test("addFeed keeps distinct direct RSS URLs from the same site separate", async () => {
  const { feedService, store, user } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url || "");
    if (target === "https://www.stats.gov.cn/sj/zxfb/rss.xml") {
      return new Response(rssFixture({ title: "数据发布", link: "https://www.stats.gov.cn/sj/zxfb/" }), {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
    if (target === "https://www.stats.gov.cn/sj/sjjd/rss.xml") {
      return new Response(rssFixture({ title: "数据解读", link: "https://www.stats.gov.cn/sj/sjjd/" }), {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
    return new Response("Not found", { status: 404, statusText: "Not Found" });
  };

  try {
    const first = await feedService.addFeed(user.id, { url: "https://www.stats.gov.cn/sj/zxfb/rss.xml", isPublic: true });
    const second = await feedService.addFeed(user.id, { url: "https://www.stats.gov.cn/sj/sjjd/rss.xml", isPublic: true });

    assert.notEqual(first.feed.feed_id, second.feed.feed_id);
    assert.equal(first.feed.url, "https://www.stats.gov.cn/sj/zxfb/rss.xml");
    assert.equal(second.feed.url, "https://www.stats.gov.cn/sj/sjjd/rss.xml");
    assert.deepEqual(store.listUserFeeds(user.id).map((feed) => feed.url).sort(), [
      "https://www.stats.gov.cn/sj/sjjd/rss.xml",
      "https://www.stats.gov.cn/sj/zxfb/rss.xml"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed can return an existing direct RSS subscription for manual adds", async () => {
  const { feedService, user } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(rssFixture({ title: "数据发布", link: "https://www.stats.gov.cn/sj/zxfb/" }), {
    status: 200,
    headers: { "content-type": "application/rss+xml" }
  });

  try {
    const first = await feedService.addFeed(user.id, { url: "https://www.stats.gov.cn/sj/zxfb/rss.xml", isPublic: true });
    const second = await feedService.addFeed(user.id, {
      url: "https://www.stats.gov.cn/sj/zxfb/rss.xml",
      isPublic: true,
      allowExisting: true
    });

    assert.equal(second.existing, true);
    assert.equal(second.feed.feed_id, first.feed.feed_id);
    assert.equal(second.feed.url, "https://www.stats.gov.cn/sj/zxfb/rss.xml");
    assert.equal(second.warning, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed still rejects an existing direct RSS subscription by default", async () => {
  const { feedService, user } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(rssFixture({ title: "数据发布", link: "https://www.stats.gov.cn/sj/zxfb/" }), {
    status: 200,
    headers: { "content-type": "application/rss+xml" }
  });

  try {
    await feedService.addFeed(user.id, { url: "https://www.stats.gov.cn/sj/zxfb/rss.xml", isPublic: true });
    await assert.rejects(
      () => feedService.addFeed(user.id, { url: "https://www.stats.gov.cn/sj/zxfb/rss.xml", isPublic: true }),
      (error) => error.code === "feed_already_subscribed"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed stores matched adapter template settings even when the first fetch fails", async () => {
  const { feedService, store, user } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "身份未经过验证" } }), {
    status: 401,
    statusText: "Authorization Required",
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await feedService.addFeed(user.id, { url: "https://www.zhihu.com/hot", isPublic: true });

    assert.equal(result.discovered.source, "adapter_template");
    assert.equal(result.feed.url, "https://www.zhihu.com/hot");
    assert.equal(result.feed.fetch_feed_url, "builtin://zhihu/hot");
    assert.equal(result.feed.fetch_feed_format, "auto");
    assert.match(result.warning, /已自动套用抓取模板/);

    const settings = store.listUserSettingsByCategory(user.id, `feed_fetch:${result.feed.feed_id}`);
    assert.ok(settings.some((entry) => entry.key === "feed_url" && entry.value === "builtin://zhihu/hot"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adapter template test asks for an input URL before fetching tokenized feed URLs", async () => {
  const { feedService } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const result = await feedService.testFetchAdapterTemplate({
      id: "tokenized",
      name: "Tokenized",
      enabled: true,
      match: "^https://example\\.com/news/?$",
      feedUrl: "{rawUrl}",
      feedFormat: "html",
      requestProfile: "browser",
      htmlItemsSelector: ".item"
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "feed_adapter_template_input_required");
    assert.match(result.error, /测试输入地址/);
    assert.equal(result.feedUrl, "{rawUrl}");
    assert.equal(result.itemCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adapter template test rejects mismatched input URLs before fetching tokenized feed URLs", async () => {
  const { feedService } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const result = await feedService.testFetchAdapterTemplate({
      id: "tokenized",
      name: "Tokenized",
      enabled: true,
      match: "^https://example\\.com/news/?$",
      feedUrl: "{rawUrl}",
      feedFormat: "html",
      requestProfile: "browser",
      htmlItemsSelector: ".item"
    }, "https://other.example.com/news");

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "feed_adapter_template_input_not_matched");
    assert.match(result.error, /未匹配当前模板/);
    assert.equal(result.feedUrl, "{rawUrl}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed updates adapter template settings when the user is already subscribed", async () => {
  const { feedService, store, user } = createHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "身份未经过验证" } }), {
    status: 401,
    statusText: "Authorization Required",
    headers: { "content-type": "application/json" }
  });
  const feed = store.getOrCreateFeed({
    title: "知乎热榜",
    url: "https://www.zhihu.com/hot",
    siteUrl: "https://www.zhihu.com/hot",
    description: ""
  });
  store.linkUserFeed(user.id, feed.id, "知乎热榜");

  try {
    const result = await feedService.addFeed(user.id, { url: "https://www.zhihu.com/hot", isPublic: true });

    assert.equal(result.feed.feed_id, feed.id);
    assert.equal(result.feed.fetch_feed_url, "builtin://zhihu/hot");
    assert.equal(result.feed.fetch_feed_format, "auto");
    assert.match(result.warning, /已更新高级抓取配置/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed skips RSSHub special routes when the plan does not allow them", async () => {
  const { feedService, user } = createHarness({
    config: { rssHubBaseUrls: ["https://rsshub.example.com"] }
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("rsshub.example.com")) {
      return new Response(rssFixture({
        title: "Bilibili 视频",
        link: "https://space.bilibili.com/12345/",
        itemTitle: "Video"
      }), {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
    return new Response("<!doctype html><html><body>no feed</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  try {
    await assert.rejects(
      () => feedService.addFeed(user.id, { url: "https://space.bilibili.com/12345", isPublic: true }),
      (error) => error.code === "feed_discovery_failed"
    );
    assert.ok(!calls.some((url) => url.includes("rsshub.example.com")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed uses RSSHub special routes when the plan allows them", async () => {
  const { feedService, store, user } = createHarness({
    config: { rssHubBaseUrls: ["https://rsshub.example.com"] }
  });
  store.updatePlanSettings("free", { specialRoutesEnabled: 1 });
  await activatePlanForUser(store, user.id, "free");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://rsshub.example.com/bilibili/user/video/12345") {
      return new Response(rssFixture({
        title: "Bilibili 视频",
        link: "https://space.bilibili.com/12345/",
        itemTitle: "Video"
      }), {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
    return new Response("<!doctype html><html><body>no feed</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  try {
    const result = await feedService.addFeed(user.id, { url: "https://space.bilibili.com/12345", isPublic: true });

    assert.equal(result.discovered.source, "rsshub");
    assert.equal(result.feed.url, "https://rsshub.example.com/bilibili/user/video/12345");
    assert.ok(calls.includes("https://rsshub.example.com/bilibili/user/video/12345"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("addFeed can use admin configured RSSHub base URLs", async () => {
  const { feedService, store, user } = createHarness({
    config: { rssHubBaseUrls: [] }
  });
  store.setSetting("rsshub", "base_urls", "http://rsshub:1200");
  store.updatePlanSettings("free", { specialRoutesEnabled: 1 });
  await activatePlanForUser(store, user.id, "free");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "http://rsshub:1200/gelonghui/hot-article") {
      return new Response(rssFixture({
        title: "格隆汇最热文章",
        link: "https://www.gelonghui.com/",
        itemTitle: "Hot Article"
      }), {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
    return new Response("<!doctype html><html><body>no feed</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };

  try {
    const result = await feedService.addFeed(user.id, { url: "https://www.gelonghui.com", isPublic: true });

    assert.equal(result.discovered.source, "rsshub");
    assert.equal(result.feed.url, "http://rsshub:1200/gelonghui/hot-article");
    assert.ok(calls.includes("http://rsshub:1200/gelonghui/hot-article"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("previewSpecialRoutes returns matching RSSHub candidates for the user's plan", async () => {
  const { feedService, store, user } = createHarness({
    config: { rssHubBaseUrls: ["https://rsshub.example.com"] }
  });

  let result = feedService.previewSpecialRoutes(user.id, "https://www.zhihu.com/hot");
  assert.equal(result.enabled, false);
  assert.deepEqual(result.candidates, []);

  store.updatePlanSettings("free", { specialRoutesEnabled: 1 });
  await activatePlanForUser(store, user.id, "free");
  result = feedService.previewSpecialRoutes(user.id, "https://www.zhihu.com/hot");

  assert.equal(result.enabled, true);
  assert.deepEqual(result.candidates, [
    {
      baseUrl: "https://rsshub.example.com",
      feedUrl: "https://rsshub.example.com/zhihu/hot",
      route: "zhihu/hot",
      title: "知乎热榜"
    }
  ]);
});
