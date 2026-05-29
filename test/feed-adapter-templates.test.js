import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFeedAdapterTemplates,
  findFeedAdapterTemplate,
  getFeedAdapterTemplates,
  normalizeFeedAdapterTemplate,
  resolveFeedAdapterTemplate,
  setFeedAdapterTemplates,
  templateToFetchSettings
} from "../src/services/feed-adapter-templates.js";

test("default adapter template maps Zhihu hot to the built-in feed", () => {
  const template = findFeedAdapterTemplate("https://www.zhihu.com/hot", defaultFeedAdapterTemplates);

  assert.equal(template.id, "zhihu-hot-json");
  assert.equal(template.feedFormat, "auto");
  assert.equal(template.requestProfile, "browser");
  assert.equal(template.feedUrl, "builtin://zhihu/hot");
  assert.equal(templateToFetchSettings(template).feedUrl, "builtin://zhihu/hot");
});

test("default adapter template maps Hani China pseudo RSS pages to HTML lists", () => {
  const template = findFeedAdapterTemplate("https://china.hani.co.kr/arti/RSS", defaultFeedAdapterTemplates);

  assert.equal(template.id, "hani-china-list-html");
  assert.equal(template.feedFormat, "html");
  assert.equal(template.feedUrl, "https://china.hani.co.kr/arti/RSS");
  assert.equal(template.htmlItemsSelector, ".comm-fixed.fixed-left > ul > li");
  assert.equal(templateToFetchSettings(template).fetchHtmlTitleSelector, ".article-tit");
});

test("saved legacy Zhihu hot template is upgraded to the built-in feed", () => {
  const settings = new Map();
  const store = {
    getSetting(category, key) {
      return settings.get(`${category}.${key}`) || null;
    },
    setSetting(category, key, value) {
      settings.set(`${category}.${key}`, { value });
    }
  };
  settings.set("feed_adapter_templates.templates_json", {
    value: JSON.stringify([
      {
        id: "zhihu-hot-json",
        name: "知乎热榜 JSON",
        enabled: true,
        match: "^https://www\\.zhihu\\.com/hot/?$|^https://zhihu\\.com/hot/?$",
        feedUrl: "https://www.zhihu.com/hot",
        feedFormat: "html",
        requestProfile: "browser",
        cookie: "session=abc",
        htmlItemsSelector: ".HotItem"
      }
    ])
  });

  const [template] = getFeedAdapterTemplates(store);
  assert.equal(template.feedUrl, "builtin://zhihu/hot");
  assert.equal(template.feedFormat, "auto");
  assert.equal(template.cookie, "session=abc");
});

test("saved custom adapter templates are merged with new default templates", () => {
  const settings = new Map();
  const store = {
    getSetting(category, key) {
      return settings.get(`${category}.${key}`) || null;
    },
    setSetting(category, key, value) {
      settings.set(`${category}.${key}`, { value });
    }
  };
  settings.set("feed_adapter_templates.templates_json", {
    value: JSON.stringify([
      {
        id: "custom-news",
        name: "Custom News",
        enabled: true,
        match: "^https://example\\.com/news/?$",
        feedUrl: "{rawUrl}",
        feedFormat: "html",
        requestProfile: "browser",
        htmlItemsSelector: ".item"
      }
    ])
  });

  const templates = getFeedAdapterTemplates(store);
  assert.ok(templates.some((template) => template.id === "custom-news"));
  assert.ok(templates.some((template) => template.id === "zhihu-hot-json"));
  assert.ok(templates.some((template) => template.id === "hani-china-list-html"));
});

test("adapter templates expand capture groups and input URL placeholders", () => {
  const template = normalizeFeedAdapterTemplate({
    id: "site-user",
    name: "Site User",
    match: "^https://example\\.com/u/([^/?#]+)/?$",
    feedUrl: "https://example.com/api/$1?source={url}",
    feedFormat: "json",
    requestProfile: "browser"
  });

  const resolved = resolveFeedAdapterTemplate("https://example.com/u/alice", template);
  assert.equal(resolved.feedUrl, "https://example.com/api/alice?source=https%3A%2F%2Fexample.com%2Fu%2Falice");
});

test("adapter templates keep request method and body settings", () => {
  const settings = new Map();
  const store = {
    getSetting(category, key) {
      return settings.get(`${category}.${key}`) || null;
    },
    setSetting(category, key, value) {
      settings.set(`${category}.${key}`, { value });
    }
  };
  const saved = setFeedAdapterTemplates(store, [{
    id: "json-post",
    name: "JSON Post",
    match: "^https://example\\.com/recommended/?$",
    feedUrl: "https://example.com/api/feed",
    feedFormat: "json",
    requestProfile: "browser",
    requestMethod: "POST",
    requestBody: "{\"cursor\":\"0\",\"limit\":20}",
    jsonItemsPath: "data"
  }]);

  assert.equal(saved[0].requestMethod, "POST");
  assert.equal(saved[0].requestBody, "{\"cursor\":\"0\",\"limit\":20}");

  const [loaded] = getFeedAdapterTemplates(store);
  assert.equal(loaded.requestMethod, "POST");
  assert.equal(loaded.requestBody, "{\"cursor\":\"0\",\"limit\":20}");
  assert.deepEqual(templateToFetchSettings(loaded), {
    feedUrl: "https://example.com/api/feed",
    requestMethod: "POST",
    requestBody: "{\"cursor\":\"0\",\"limit\":20}",
    feedFormat: "json",
    fetchRequestProfile: "browser",
    fetchCookie: undefined,
    fetchHtmlItemsSelector: "",
    fetchHtmlTitleSelector: "",
    fetchHtmlLinkSelector: "",
    fetchHtmlDateSelector: "",
    fetchHtmlSummarySelector: "",
    fetchHtmlContentSelector: "",
    fetchJsonItemsPath: "data",
    fetchJsonTitlePath: "",
    fetchJsonLinkPath: "",
    fetchJsonDatePath: "",
    fetchJsonSummaryPath: "",
    fetchJsonContentPath: ""
  });
});

test("adapter templates reject invalid regex patterns", () => {
  assert.throws(
    () => normalizeFeedAdapterTemplate({ name: "Bad", match: "[", feedUrl: "https://example.com/api" }),
    (error) => error.code === "feed_adapter_template_invalid"
  );
});

test("adapter templates can store encrypted shared cookies", () => {
  const settings = new Map();
  const store = {
    getSetting(category, key) {
      return settings.get(`${category}.${key}`) || null;
    },
    setSetting(category, key, value) {
      settings.set(`${category}.${key}`, { value });
    }
  };
  const secretBox = {
    encrypt(value) {
      return `enc:${value}`;
    },
    decrypt(value) {
      return String(value || "").replace(/^enc:/, "");
    }
  };

  const saved = setFeedAdapterTemplates(store, [{
    id: "html-feed",
    name: "HTML Feed",
    match: "^https://example\\.com/$",
    feedUrl: "{rawUrl}",
    feedFormat: "html",
    requestProfile: "browser",
    cookie: "session=abc",
    htmlItemsSelector: ".item"
  }], secretBox);
  assert.equal(saved[0].cookie, "session=abc");
  assert.match(settings.get("feed_adapter_templates.templates_json").value, /enc:session=abc/);

  const loaded = getFeedAdapterTemplates(store, secretBox);
  assert.equal(loaded[0].cookie, "session=abc");
});
