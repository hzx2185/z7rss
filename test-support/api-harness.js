import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/bootstrap.js";

export async function createHarness(t, env = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-test-"));
  const dbPath = path.join(tempDir, "rss.db");
  const runtime = createRuntime({
    APP_SECRET: "test-secret",
    APP_URL: "http://127.0.0.1",
    DB_PATH: dbPath,
    BILLING_PROVIDER: "demo",
    AI_ENABLED: "false",
    ...env
  });

  const server = await new Promise((resolve) => {
    const instance = runtime.app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await runtime.shutdown?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  function createClient(defaultHeaders = {}) {
    let cookieHeader = "";

    return {
      async request(urlPath, options = {}) {
        const headers = { ...defaultHeaders, ...(options.headers || {}) };
        let body = options.body;

        if (options.json !== undefined) {
          body = JSON.stringify(options.json);
          headers["content-type"] = "application/json";
        }

        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        const response = await fetch(`${baseUrl}${urlPath}`, {
          method: options.method || "GET",
          headers,
          body
        });

        const setCookie = response.headers.get("set-cookie");
        if (setCookie) {
          cookieHeader = setCookie.split(";", 1)[0];
        }

        const contentType = response.headers.get("content-type") || "";
        const payload = response.status === 204
          ? null
          : contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        return {
          status: response.status,
          headers: response.headers,
          body: payload
        };
      }
    };
  }

  const defaultClient = createClient();
  return { request: defaultClient.request, createClient, runtime };
}

export async function createFeedSource(t, options = {}) {
  let delayMs = Number(options.delayMs || 0);
  let shouldFail = Boolean(options.shouldFail);
  let requestCount = 0;
  const title = options.title || "Test Feed";
  const itemTitle = options.itemTitle || "Hello Feed";

  const server = http.createServer(async (_req, res) => {
    requestCount += 1;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (shouldFail) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("feed failed");
      return;
    }

    res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>http://127.0.0.1/</link>
    <description>Test feed</description>
    <item>
      <guid>${title}-${requestCount}</guid>
      <title>${itemTitle} ${requestCount}</title>
      <link>http://127.0.0.1/items/${requestCount}</link>
      <description>Entry ${requestCount}</description>
      <pubDate>Wed, 24 Apr 2024 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/feed.xml`,
    getRequestCount() {
      return requestCount;
    },
    setDelay(nextDelayMs) {
      delayMs = Number(nextDelayMs || 0);
    },
    setFailing(nextShouldFail) {
      shouldFail = Boolean(nextShouldFail);
    }
  };
}

export function buildFeedPreferencePayload(overrides = {}) {
  return {
    customTitle: "",
    category: "",
    isArchived: false,
    isCollapsed: false,
    isPublic: false,
    targetLanguage: null,
    autoTranslate: null,
    displayTranslated: null,
    translationMode: null,
    fetchRequestProfile: "auto",
    fetchFeedFormat: "auto",
    fetchTimeoutMs: null,
    fetchFeedUrl: null,
    fetchLoginUrl: null,
    fetchUsername: null,
    fetchPassword: "",
    fetchUsernameField: "username",
    fetchPasswordField: "password",
    fetchCookie: "",
    fetchArticleSelector: null,
    fetchPageSelector: null,
    fetchJsonItemsPath: null,
    fetchJsonTitlePath: null,
    fetchJsonLinkPath: null,
    fetchJsonDatePath: null,
    fetchJsonSummaryPath: null,
    fetchJsonContentPath: null,
    ...overrides
  };
}
