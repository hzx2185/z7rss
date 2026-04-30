import assert from "node:assert/strict";
import test from "node:test";
import { fetchArticleContent, fetchFeed } from "../src/services/fetcher.js";

test("fetchFeed retries blocked feeds with browser-like headers", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: options.headers || {}
    });

    if (requests.length === 1) {
      return new Response("Forbidden", {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/plain" }
      });
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Naixi RSS</title>
          <link>https://forum.naixi.net/</link>
          <description>Forum feed</description>
          <item>
            <title>Post A</title>
            <link>https://forum.naixi.net/thread-1-1-1.html</link>
            <guid>post-a</guid>
            <description><![CDATA[<p>Hello</p>]]></description>
            <pubDate>Sun, 26 Apr 2026 08:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`,
      {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchFeed("https://forum.naixi.net/forum.php?mod=rss", {
    userAgent: "Z7RSSBot/0.1"
  });

  assert.equal(result.meta.title, "Naixi RSS");
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["user-agent"], "Z7RSSBot/0.1");
  assert.match(String(requests[1].headers["user-agent"] || ""), /Mozilla\/5\.0/);
  assert.equal(requests[1].headers.referer, "https://forum.naixi.net/");
  assert.match(String(requests[1].headers.accept || ""), /application\/rss\+xml/);
});

test("fetchFeed retries html access challenge pages with browser-like headers", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: options.headers || {}
    });

    if (requests.length === 1) {
      return new Response(
        `<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing the RSS feed. Cloudflare</body></html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example Atom</title>
        <subtitle>Atom description</subtitle>
        <link rel="alternate" href="https://example.com/" />
        <entry>
          <id>tag:example.com,2026:1</id>
          <title>Entry One</title>
          <link href="https://example.com/posts/1" />
          <summary>Example summary</summary>
          <updated>2026-04-26T08:00:00Z</updated>
        </entry>
      </feed>`,
      {
        status: 200,
        headers: { "content-type": "application/atom+xml; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchFeed("https://example.com/feed");

  assert.equal(result.meta.title, "Example Atom");
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 2);
  assert.match(String(requests[1].headers["user-agent"] || ""), /Mozilla\/5\.0/);
});

test("fetchFeed retries timed out bot requests with browser-like headers", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: options.headers || {}
    });

    if (requests.length === 1) {
      const error = new Error("The operation was aborted due to timeout");
      error.code = 23;
      throw error;
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Recovered Feed</title>
          <link>https://example.com/</link>
          <description>Recovered after timeout</description>
          <item>
            <title>Recovered Item</title>
            <link>https://example.com/posts/1</link>
            <guid>recovered-1</guid>
            <description>Hello</description>
          </item>
        </channel>
      </rss>`,
      {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchFeed("https://example.com/feed");

  assert.equal(result.meta.title, "Recovered Feed");
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 2);
  assert.match(String(requests[1].headers["user-agent"] || ""), /Mozilla\/5\.0/);
});

test("fetchArticleContent retries blocked article pages with browser-like headers", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      headers: options.headers || {}
    });

    if (requests.length === 1) {
      return new Response("Forbidden", {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/plain" }
      });
    }

    return new Response(
      `<!doctype html>
      <html>
        <head>
          <title>Article Title</title>
          <link rel="canonical" href="https://example.com/posts/1" />
        </head>
        <body>
          <article><p>Hello world</p><p>More text</p></article>
        </body>
      </html>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchArticleContent("https://example.com/posts/1", {
    userAgent: "Z7RSSBot/0.1"
  });

  assert.match(result.text, /Hello world\s*More text/);
  assert.equal(result.originalUrl, "https://example.com/posts/1");
  assert.equal(result.title, "Article Title");
  assert.equal(requests.length, 2);
  assert.match(String(requests[1].headers["user-agent"] || ""), /Mozilla\/5\.0/);
  assert.equal(requests[1].headers.referer, "https://example.com/");
});

test("fetchFeed parses large entity-heavy XML feeds without reporting unsupported format", async (t) => {
  const originalFetch = globalThis.fetch;
  const repeatedEntityText = "&amp;".repeat(12050);
  globalThis.fetch = async () =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Heavy Feed</title>
          <link>https://example.com/</link>
          <description>Entity heavy</description>
          <item>
            <title>Heavy Item</title>
            <link>https://example.com/posts/1</link>
            <guid>heavy-1</guid>
            <description><![CDATA[<p>${repeatedEntityText}</p>]]></description>
          </item>
        </channel>
      </rss>`,
      {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchFeed("https://example.com/heavy.xml");

  assert.equal(result.meta.title, "Heavy Feed");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Heavy Item");
  assert.match(result.items[0].summary, /&amp;|&/);
});

test("fetchFeed parses JSON feeds with custom field paths", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        title: "JSON Feed",
        home_page_url: "https://example.com/",
        data: {
          posts: [
            {
              id: "post-1",
              headline: "JSON Item",
              links: { web: "/posts/1" },
              deck: "Short summary",
              body: { html: "<p>Hello JSON</p>" },
              meta: { published: "2026-04-26T08:00:00Z" }
            }
          ]
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchFeed("https://example.com/feed.json", {
    feedFormat: "json",
    jsonItemsPath: "data.posts",
    jsonTitlePath: "headline",
    jsonLinkPath: "links.web",
    jsonDatePath: "meta.published",
    jsonSummaryPath: "deck",
    jsonContentPath: "body.html"
  });

  assert.equal(result.meta.title, "JSON Feed");
  assert.equal(result.meta.siteUrl, "https://example.com/");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "JSON Item");
  assert.equal(result.items[0].link, "https://example.com/posts/1");
  assert.match(result.items[0].contentHtml, /Hello JSON/);
  assert.equal(result.items[0].publishedAt, "2026-04-26T08:00:00.000Z");
});

test("fetchArticleContent logs in first and reuses merged cookies for the article request", async (t) => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body ? String(options.body) : ""
    });

    if (requests.length === 1) {
      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "set-cookie": "session=abc123; Path=/; HttpOnly"
        }
      });
    }

    return new Response(
      `<!doctype html>
      <html>
        <head><title>Protected Article</title></head>
        <body><article><p>Private content</p></article></body>
      </html>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchArticleContent("https://example.com/posts/secure", {
    loginUrl: "https://example.com/login",
    username: "user@example.com",
    password: "super-secret",
    usernameField: "email",
    passwordField: "pass",
    cookie: "pref=1"
  });

  assert.equal(result.title, "Protected Article");
  assert.match(result.text, /Private content/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://example.com/login");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, "email=user%40example.com&pass=super-secret");
  assert.match(String(requests[1].headers.cookie || ""), /pref=1/);
  assert.match(String(requests[1].headers.cookie || ""), /session=abc123/);
});

test("fetchArticleContent honors custom article selectors", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<!doctype html>
      <html>
        <head><title>Selector Test</title></head>
        <body>
          <main>
            <div class="teaser">Ignore this teaser</div>
            <section class="post-body"><p>Only this should be extracted</p></section>
          </main>
        </body>
      </html>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await fetchArticleContent("https://example.com/posts/selector", {
    articleSelector: ".post-body"
  });

  assert.equal(result.title, "Selector Test");
  assert.equal(result.text, "Only this should be extracted");
  assert.doesNotMatch(result.text, /Ignore this teaser/);
});
