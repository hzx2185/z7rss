import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";

function createTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-read-state-"));
  const db = createDb(path.join(dir, "rss.db"));
  const store = createStore(db);
  return { db, store };
}

test("upsertItems keeps read state when a feed changes guid for the same article link", () => {
  const { store } = createTempStore();
  const user = store.createUser({
    email: "reader@example.com",
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

  const firstInsert = store.upsertItems(feed.id, [
    {
      guid: "old-guid",
      title: "Same article",
      link: "https://example.com/post?utm_source=newsletter#comments",
      summary: "First",
      contentHtml: "",
      contentText: "",
      publishedAt: "2026-05-13T00:00:00.000Z"
    }
  ]);
  assert.equal(firstInsert, 1);

  const item = store.listUserItems(user.id, feed.id, 10)[0];
  store.setUserItemReadState(user.id, item.id, true, "2026-05-13T00:01:00.000Z");

  const secondInsert = store.upsertItems(feed.id, [
    {
      guid: "new-guid",
      title: "Same article updated",
      link: "https://example.com/post",
      summary: "Updated",
      contentHtml: "",
      contentText: "",
      publishedAt: "2026-05-13T00:00:00.000Z"
    }
  ]);
  assert.equal(secondInsert, 0);

  const items = store.listUserItems(user.id, feed.id, 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, item.id);
  assert.equal(items[0].is_read, 1);
  assert.equal(store.countUserItems(user.id, feed.id, { readState: 0 }), 0);
});

test("bulk read state returns only items whose read state changed", () => {
  const { store } = createTempStore();
  const user = store.createUser({
    email: "bulk@example.com",
    passwordHash: "hash",
    displayName: "Bulk Reader",
    isAdmin: 0,
    status: "active"
  });
  const feed = store.getOrCreateFeed({
    title: "Feed",
    url: "https://example.com/bulk.xml",
    siteUrl: "https://example.com",
    description: ""
  });
  store.linkUserFeed(user.id, feed.id, "Feed");
  store.upsertItems(feed.id, [
    {
      guid: "item-1",
      title: "One",
      link: "https://example.com/one",
      publishedAt: "2026-05-13T00:00:00.000Z"
    },
    {
      guid: "item-2",
      title: "Two",
      link: "https://example.com/two",
      publishedAt: "2026-05-13T00:01:00.000Z"
    }
  ]);

  const ids = store.listUserItems(user.id, feed.id, 10).map((item) => item.id);

  assert.equal(store.setUserItemReadStateBulk(user.id, ids, true, "2026-05-13T00:02:00.000Z"), 2);
  assert.equal(store.setUserItemReadStateBulk(user.id, ids, true, "2026-05-13T00:03:00.000Z"), 0);
  assert.equal(store.setUserItemReadStateBulk(user.id, [ids[0]], false, null), 1);
  assert.equal(store.countUserItems(user.id, feed.id, { readState: 0 }), 1);
});
