import assert from "node:assert/strict";
import test from "node:test";
import { defaultFeedAdapterTemplates } from "../src/services/feed-adapter-templates.js";
import {
  buildRssHubCandidates,
  inferRssHubBaseUrlsFromFeeds,
  normalizeRssHubBaseUrls,
  resolveFeedInput
} from "../src/services/feed-discovery.js";

function unsupportedFeedError() {
  const error = new Error("Unsupported feed format");
  error.code = "unsupported_feed_format";
  return error;
}

function feedRequestFailedError() {
  const error = new Error("Feed request failed: 403 Forbidden");
  error.code = "feed_request_failed";
  return error;
}

test("resolveFeedInput uses discovered feed links before saving a web page URL", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://example.com/articles", {
    async fetchFeed(url) {
      calls.push(url);
      if (url === "https://example.com/articles") throw unsupportedFeedError();
      if (url === "https://example.com/rss.xml") {
        return {
          meta: { title: "Example Feed", siteUrl: "https://example.com/", description: "Example posts" },
          items: [{ title: "One" }]
        };
      }
      throw new Error(`unexpected ${url}`);
    },
    async discoverFeedLinks() {
      return {
        siteTitle: "Example",
        siteDescription: "Readable site",
        feeds: [{ url: "/rss.xml", source: "html_link", confidence: "high", title: "RSS" }]
      };
    }
  });

  assert.deepEqual(calls, ["https://example.com/articles", "https://example.com/rss.xml"]);
  assert.equal(resolved.feedUrl, "https://example.com/rss.xml");
  assert.equal(resolved.source, "html_link");
  assert.equal(resolved.meta.title, "Example Feed");
});

test("resolveFeedInput tries RSSHub candidates when configured", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://space.bilibili.com/12345", {
    rssHubBaseUrls: ["https://rsshub.example.com"],
    async fetchFeed(url) {
      calls.push(url);
      if (url === "https://space.bilibili.com/12345") throw unsupportedFeedError();
      if (url === "https://rsshub.example.com/bilibili/user/video/12345") {
        return { meta: { title: "UP 主视频" }, items: [{ title: "Video" }] };
      }
      throw unsupportedFeedError();
    },
    async discoverFeedLinks() {
      return { feeds: [] };
    }
  });

  assert.equal(resolved.feedUrl, "https://rsshub.example.com/bilibili/user/video/12345");
  assert.equal(resolved.source, "rsshub");
  assert.ok(calls.includes("https://rsshub.example.com/bilibili/user/video/12345"));
});

test("resolveFeedInput uses RSSHub for blocked Zhihu hot pages", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://www.zhihu.com/hot", {
    rssHubBaseUrls: ["https://rsshub.example.com"],
    async fetchFeed(url) {
      calls.push(url);
      if (url === "https://www.zhihu.com/hot") throw feedRequestFailedError();
      if (url === "https://rsshub.example.com/zhihu/hot") {
        return { meta: { title: "知乎热榜" }, items: [{ title: "Hot" }] };
      }
      throw unsupportedFeedError();
    },
    async discoverFeedLinks() {
      throw feedRequestFailedError();
    }
  });

  assert.equal(resolved.feedUrl, "https://rsshub.example.com/zhihu/hot");
  assert.equal(resolved.source, "rsshub");
  assert.ok(calls.includes("https://rsshub.example.com/zhihu/hot"));
});

test("resolveFeedInput maps Gelonghui homepage to RSSHub hot articles", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://www.gelonghui.com", {
    rssHubBaseUrls: ["http://rsshub:1200"],
    async fetchFeed(url) {
      calls.push(url);
      if (url === "https://www.gelonghui.com/") throw unsupportedFeedError();
      if (url === "http://rsshub:1200/gelonghui/hot-article") {
        return { meta: { title: "格隆汇最热文章" }, items: [{ title: "Hot Article" }] };
      }
      throw unsupportedFeedError();
    },
    async discoverFeedLinks() {
      return { feeds: [] };
    }
  });

  assert.equal(resolved.feedUrl, "http://rsshub:1200/gelonghui/hot-article");
  assert.equal(resolved.source, "rsshub");
  assert.ok(calls.includes("http://rsshub:1200/gelonghui/hot-article"));
});

test("resolveFeedInput prefers editable built-in mapping for Zhihu hot before RSSHub", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://www.zhihu.com/hot", {
    rssHubBaseUrls: ["https://rsshub.example.com"],
    feedAdapterTemplates: defaultFeedAdapterTemplates,
    async fetchFeed(url, options = {}) {
      calls.push(url);
      if (url === "builtin://zhihu/hot") {
        assert.equal(options.feedFormat, "auto");
        return { meta: { title: "知乎热榜" }, items: [{ title: "Hot" }] };
      }
      throw feedRequestFailedError();
    },
    async discoverFeedLinks() {
      return { feeds: [] };
    }
  });

  assert.deepEqual(calls, ["builtin://zhihu/hot"]);
  assert.equal(resolved.feedUrl, "https://www.zhihu.com/hot");
  assert.equal(resolved.source, "adapter_template");
  assert.equal(resolved.fetchSettings.feedUrl, "builtin://zhihu/hot");
  assert.equal(resolved.fetchSettings.feedFormat, "auto");
});

test("resolveFeedInput keeps adapter template settings when the target fetch fails", async () => {
  const resolved = await resolveFeedInput("https://www.zhihu.com/hot", {
    feedAdapterTemplates: defaultFeedAdapterTemplates,
    async fetchFeed(url, options = {}) {
      assert.equal(url, "builtin://zhihu/hot");
      assert.equal(options.feedFormat, "auto");
      throw feedRequestFailedError();
    }
  });

  assert.equal(resolved.source, "adapter_template");
  assert.equal(resolved.feedUrl, "https://www.zhihu.com/hot");
  assert.equal(resolved.fetchSettings.feedUrl, "builtin://zhihu/hot");
  assert.equal(resolved.fetchSettings.feedFormat, "auto");
  assert.equal(resolved.discoveryError, "Feed request failed: 403 Forbidden");
});

test("resolveFeedInput falls back to RSSHub when an adapter template fails", async () => {
  const calls = [];
  const resolved = await resolveFeedInput("https://www.zhihu.com/hot", {
    rssHubBaseUrls: ["https://rsshub-one.example.com", "https://rsshub-two.example.com"],
    feedAdapterTemplates: defaultFeedAdapterTemplates,
    async fetchFeed(url) {
      calls.push(url);
      if (url === "https://rsshub-two.example.com/zhihu/hot") {
        return { meta: { title: "知乎热榜" }, items: [{ title: "Hot" }] };
      }
      throw feedRequestFailedError();
    }
  });

  assert.deepEqual(calls, [
    "builtin://zhihu/hot",
    "https://rsshub-one.example.com/zhihu/hot",
    "https://rsshub-two.example.com/zhihu/hot"
  ]);
  assert.equal(resolved.feedUrl, "https://rsshub-two.example.com/zhihu/hot");
  assert.equal(resolved.source, "rsshub");
});

test("resolveFeedInput applies the Hani China HTML adapter template", async () => {
  const resolved = await resolveFeedInput("https://china.hani.co.kr/arti/RSS", {
    feedAdapterTemplates: defaultFeedAdapterTemplates,
    async fetchFeed(url, options = {}) {
      assert.equal(url, "https://china.hani.co.kr/arti/RSS");
      assert.equal(options.feedFormat, "html");
      assert.equal(options.htmlItemsSelector, ".comm-fixed.fixed-left > ul > li");
      assert.equal(options.htmlTitleSelector, ".article-tit");
      return { meta: { title: "韩民族日报中文网" }, items: [{ title: "新闻标题" }] };
    }
  });

  assert.equal(resolved.source, "adapter_template");
  assert.equal(resolved.feedUrl, "https://china.hani.co.kr/arti/RSS");
  assert.equal(resolved.fetchSettings.feedFormat, "html");
  assert.equal(resolved.fetchSettings.fetchHtmlSummarySelector, ".article-txt");
});

test("resolveFeedInput expands editable adapter template capture groups", async () => {
  const resolved = await resolveFeedInput("https://example.com/users/alice", {
    feedAdapterTemplates: [
      {
        id: "example-user",
        name: "Example User",
        enabled: true,
        match: "^https://example\\.com/users/([^/]+)/?$",
        feedUrl: "https://example.com/api/users/$1/posts",
        feedFormat: "json",
        requestProfile: "browser",
        jsonItemsPath: "items",
        jsonTitlePath: "title",
        jsonLinkPath: "url"
      }
    ],
    async fetchFeed(url, options = {}) {
      assert.equal(url, "https://example.com/api/users/alice/posts");
      assert.equal(options.jsonItemsPath, "items");
      return { meta: { title: "Alice" }, items: [{ title: "Hello" }] };
    }
  });

  assert.equal(resolved.source, "adapter_template");
  assert.equal(resolved.fetchSettings.feedUrl, "https://example.com/api/users/alice/posts");
});

test("resolveFeedInput rejects unsupported pages when no candidate works", async () => {
  await assert.rejects(
    () =>
      resolveFeedInput("https://example.com/page", {
        async fetchFeed() {
          throw unsupportedFeedError();
        },
        async discoverFeedLinks() {
          return { feeds: [] };
        }
      }),
    (error) => error.code === "feed_discovery_failed" && Array.isArray(error.details?.tried)
  );
});

test("RSSHub helpers normalize configured and inferred bases", () => {
  assert.deepEqual(normalizeRssHubBaseUrls("https://rsshub.example.com/ https://rsshub.example.com"), [
    "https://rsshub.example.com"
  ]);
  assert.deepEqual(
    inferRssHubBaseUrlsFromFeeds([
      { url: "https://rsshub.example.com/bilibili/user/video/1" },
      { url: "https://example.com/rsshub/twitter/user/openai" }
    ]),
    ["https://rsshub.example.com", "https://example.com/rsshub"]
  );
  assert.deepEqual(buildRssHubCandidates("https://weibo.com/u/123456", ["https://rsshub.example.com"]).map((c) => c.url), [
    "https://rsshub.example.com/weibo/user/123456"
  ]);
  assert.deepEqual(buildRssHubCandidates("https://www.zhihu.com/hot", ["https://rsshub.example.com"]).map((c) => c.url), [
    "https://rsshub.example.com/zhihu/hot"
  ]);
  assert.equal(buildRssHubCandidates("https://www.zhihu.com/hot", ["https://rsshub.example.com"])[0].baseUrl, "https://rsshub.example.com");
});
