import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createAccountService } from "../src/services/account-service.js";
import { createFeedService } from "../src/services/feed-service.js";

function createHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-prefer-stored-"));
  const db = createDb(path.join(dir, "rss.db"));
  const store = createStore(db);
  const user = store.createUser({
    email: `reader-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "hash",
    displayName: "Reader",
    isAdmin: 0,
    status: "active"
  });
  const feed = store.getOrCreateFeed({
    title: "Feed",
    url: "https://example.com/feed.xml",
    siteUrl: "https://example.com",
    description: ""
  });
  store.linkUserFeed(user.id, feed.id, "Feed");
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
      userAgent: "z7rss-test"
    }
  });

  return { feed, feedService, store, user };
}

test("getItemContent preferStored returns existing short content without fetching the article page", async () => {
  const { feed, feedService, store, user } = createHarness();
  store.upsertItems(feed.id, [
    {
      guid: "stored-short-content",
      title: "Stored short content",
      link: "ftp://example.com/article",
      summary: "",
      contentHtml: "<p>Short stored body.</p>",
      contentText: "Short stored body.",
      publishedAt: "2026-05-17T00:00:00.000Z"
    }
  ]);
  const item = store.listUserItems(user.id, feed.id, 10)[0];

  const result = await feedService.getItemContent(user.id, item.id, { preferStored: true });

  assert.equal(result.content_loaded, true);
  assert.equal(result.content_text, "Short stored body.");
  assert.equal(result.fetch_error, undefined);
});
