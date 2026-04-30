import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { buildFeedPreferencePayload, createFeedSource, createHarness } from "../test-support/api-harness.js";

test("returns consistent JSON errors for malformed JSON bodies", async (t) => {
  const { request } = await createHarness(t);
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_json");
  assert.match(response.body.error, /JSON/);
});

test("protects admin routes with structured auth errors", async (t) => {
  const { request } = await createHarness(t);
  const response = await request("/api/admin/dashboard");

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "auth_required");
  assert.equal(response.body.error, "请先登录");
});

test("records admin audit logs for privileged mutations", async (t) => {
  const { request } = await createHarness(t);

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin@example.com",
      password: "12345678",
      displayName: "Admin"
    }
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.isAdmin, true);

  const updated = await request("/api/admin/settings/general", {
    method: "POST",
    json: {
      site_name: "Z7 Audit"
    }
  });

  assert.equal(updated.status, 200);

  const dashboard = await request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.ok(Array.isArray(dashboard.body.auditLogs));
  assert.ok(dashboard.body.auditLogs.length >= 1);

  const latest = dashboard.body.auditLogs[0];
  assert.equal(latest.action, "admin.settings.updated");
  assert.equal(latest.target_type, "settings");
  assert.equal(latest.target_id, "general");
  assert.equal(latest.actor_email, "admin@example.com");
  assert.deepEqual(latest.details.changedKeys, ["site_name"]);
});

test("exposes shared feeds in the public plaza with latest items", async (t) => {
  const { request, createClient } = await createHarness(t);
  const sharerClient = createClient({ "user-agent": "Plaza Sharer" });
  const viewerClient = createClient({ "user-agent": "Plaza Viewer" });
  const feedSource = await createFeedSource(t, {
    title: "Shared Source",
    itemTitle: "Shared Entry"
  });

  const sharerRegistered = await sharerClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "plaza-sharer@example.com",
      password: "12345678",
      displayName: "Plaza Sharer"
    }
  });

  assert.equal(sharerRegistered.status, 201);

  const addedFeed = await sharerClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Shared Source",
      url: feedSource.url
    }
  });

  assert.equal(addedFeed.status, 201);

  const shared = await sharerClient.request(`/api/feeds/${addedFeed.body.feed.feed_id}/preferences`, {
    method: "POST",
    json: buildFeedPreferencePayload({ isPublic: true })
  });

  assert.equal(shared.status, 200);
  assert.equal(shared.body.is_public, true);

  const guestPlaza = await request("/api/plaza?limit=10&itemLimit=2");
  assert.equal(guestPlaza.status, 200);
  assert.equal(guestPlaza.body.feeds.length, 1);
  assert.equal(guestPlaza.body.feeds[0].title, "Shared Source");
  assert.equal(guestPlaza.body.feeds[0].sharer_count, 1);
  assert.equal(guestPlaza.body.feeds[0].viewer_subscribed, false);
  assert.equal(guestPlaza.body.feeds[0].items.length, 1);
  assert.match(guestPlaza.body.feeds[0].items[0].title, /Shared Entry/);

  const viewerRegistered = await viewerClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "plaza-viewer@example.com",
      password: "12345678",
      displayName: "Plaza Viewer"
    }
  });

  assert.equal(viewerRegistered.status, 201);

  const viewerPlazaBefore = await viewerClient.request("/api/plaza?limit=10&itemLimit=2");
  assert.equal(viewerPlazaBefore.status, 200);
  assert.equal(viewerPlazaBefore.body.feeds[0].viewer_subscribed, false);

  const viewerSubscribed = await viewerClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Shared Source",
      url: feedSource.url
    }
  });

  assert.equal(viewerSubscribed.status, 201);

  const viewerPlazaAfter = await viewerClient.request("/api/plaza?limit=10&itemLimit=2");
  assert.equal(viewerPlazaAfter.status, 200);
  assert.equal(viewerPlazaAfter.body.feeds[0].viewer_subscribed, true);
  assert.equal(viewerPlazaAfter.body.feeds[0].sharer_count, 1);
});

test("supports partial feed preference updates for bulk share toggles", async (t) => {
  const { request } = await createHarness(t);
  const feedSource = await createFeedSource(t, {
    title: "Partial Preference Source"
  });

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "partial-pref@example.com",
      password: "12345678",
      displayName: "Partial Pref"
    }
  });

  assert.equal(registered.status, 201);

  const addedFeed = await request("/api/feeds", {
    method: "POST",
    json: {
      title: "Partial Preference Source",
      url: feedSource.url
    }
  });

  assert.equal(addedFeed.status, 201);

  const shared = await request(`/api/feeds/${addedFeed.body.feed.feed_id}/preferences`, {
    method: "POST",
    json: {
      isPublic: true
    }
  });

  assert.equal(shared.status, 200);
  assert.equal(shared.body.is_public, true);

  const unshared = await request(`/api/feeds/${addedFeed.body.feed.feed_id}/preferences`, {
    method: "POST",
    json: {
      isPublic: false
    }
  });

  assert.equal(unshared.status, 200);
  assert.equal(unshared.body.is_public, false);
});

test("admin can update plan quotas and feature toggles", async (t) => {
  const { request } = await createHarness(t, { AI_ENABLED: "true" });

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "plan-admin@example.com",
      password: "12345678",
      displayName: "Plan Admin"
    }
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.account.plan.code, "free");
  assert.equal(registered.body.account.features.translation, false);
  assert.equal(registered.body.account.features.summary, false);
  assert.equal(registered.body.account.features.customAi, false);

  const aiBlocked = await request("/api/account/preferences/ai", {
    method: "POST",
    json: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      translatePrompt: "",
      summaryPrompt: ""
    }
  });

  assert.equal(aiBlocked.status, 403);
  assert.equal(aiBlocked.body.code, "custom_ai_unavailable");

  const updatedPlan = await request("/api/admin/plans/free", {
    method: "POST",
    json: {
      maxFeeds: 9,
      maxSavedItems: 333,
      maxFavoriteItems: 77,
      aiTranslationEnabled: true,
      aiSummaryEnabled: true,
      customAiEnabled: true
    }
  });

  assert.equal(updatedPlan.status, 200);
  assert.equal(updatedPlan.body.max_feeds, 9);
  assert.equal(updatedPlan.body.max_saved_items, 333);
  assert.equal(updatedPlan.body.max_favorite_items, 77);
  assert.equal(updatedPlan.body.ai_translation_enabled, 1);
  assert.equal(updatedPlan.body.ai_summary_enabled, 1);
  assert.equal(updatedPlan.body.custom_ai_enabled, 1);

  const me = await request("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.account.plan.max_feeds, 9);
  assert.equal(me.body.account.plan.max_saved_items, 333);
  assert.equal(me.body.account.plan.max_favorite_items, 77);
  assert.equal(me.body.account.plan.custom_ai_enabled, 1);
  assert.equal(me.body.account.features.translation, true);
  assert.equal(me.body.account.features.summary, true);
  assert.equal(me.body.account.features.customAi, true);

  const aiSaved = await request("/api/account/preferences/ai", {
    method: "POST",
    json: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      translatePrompt: "",
      summaryPrompt: ""
    }
  });

  assert.equal(aiSaved.status, 200);
  assert.equal(aiSaved.body.account.features.customAi, true);
  assert.equal(aiSaved.body.account.ai.hasConfiguredProvider, true);
});

test("paid members can manage AI email digest rules within plan limits", async (t) => {
  const { createClient } = await createHarness(t, { AI_ENABLED: "true" });
  const adminClient = createClient({ "user-agent": "Digest Admin" });
  const memberClient = createClient({ "user-agent": "Digest Member" });

  const admin = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "digest-admin@example.com",
      password: "12345678",
      displayName: "Digest Admin"
    }
  });
  assert.equal(admin.status, 201);
  assert.equal(admin.body.user.isAdmin, true);

  const member = await memberClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "digest-member@example.com",
      password: "12345678",
      displayName: "Digest Member"
    }
  });
  assert.equal(member.status, 201);

  const freeAttempt = await memberClient.request("/api/account/digest-rules", {
    method: "POST",
    json: {
      name: "免费简报",
      recipientEmails: ["digest-member@example.com"]
    }
  });
  assert.equal(freeAttempt.status, 403);
  assert.equal(freeAttempt.body.code, "digest_unavailable");

  const upgraded = await adminClient.request(`/api/admin/users/${member.body.user.id}/subscription`, {
    method: "POST",
    json: {
      planCode: "pro",
      status: "active"
    }
  });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.body.account.features.digest, true);
  assert.equal(upgraded.body.account.limits.digestRules, 3);

  const created = await memberClient.request("/api/account/digest-rules", {
    method: "POST",
    json: {
      name: "每日科技简报",
      isEnabled: true,
      sendTime: "09:00",
      recipientEmails: [],
      aiSource: "system",
      feedScope: "all",
      lookbackHours: 24,
      unreadOnly: true,
      prompt: "偏重技术和产品。"
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "每日科技简报");
  assert.equal(created.body.lookbackHours, 24);
  assert.equal(created.body.unreadOnly, true);
  assert.deepEqual(created.body.recipientEmails, []);

  const listed = await memberClient.request("/api/account/digest-rules");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.rules.length, 1);
  assert.equal(listed.body.account.usage.digestRules, 1);
  assert.equal(listed.body.mail.configured, false);

  const updated = await memberClient.request(`/api/account/digest-rules/${created.body.id}`, {
    method: "POST",
    json: {
      name: "每日产品简报",
      isEnabled: false,
      recipientEmails: ["product@example.com"],
      unreadOnly: false
    }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "每日产品简报");
  assert.equal(updated.body.isEnabled, false);
  assert.equal(updated.body.unreadOnly, false);
  assert.deepEqual(updated.body.recipientEmails, ["product@example.com"]);
});

test("tracks background refresh runs and prevents overlapping manual starts", async (t) => {
  const { createClient, runtime } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Refresh Console" });
  const feedSource = await createFeedSource(t, {
    delayMs: 200,
    title: "Refresh Source"
  });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-refresh@example.com",
      password: "12345678",
      displayName: "Admin Refresh"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const addedFeed = await adminClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Refresh Source",
      url: feedSource.url
    }
  });

  assert.equal(addedFeed.status, 201);

  const started = await adminClient.request("/api/admin/refresh", {
    method: "POST"
  });

  assert.equal(started.status, 202);
  assert.equal(started.body.started, true);
  assert.equal(started.body.alreadyRunning, false);
  assert.equal(started.body.run.status, "running");
  const runningRunId = started.body.run.id;

  const duplicate = await adminClient.request("/api/admin/refresh", {
    method: "POST"
  });

  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.started, false);
  assert.equal(duplicate.body.alreadyRunning, true);
  assert.equal(duplicate.body.run.id, runningRunId);

  await runtime.services.refreshService.waitForIdle();

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.refresh.isRunning, false);
  assert.equal(dashboard.body.refresh.latestRun.id, runningRunId);
  assert.equal(dashboard.body.refresh.latestRun.status, "success");
  assert.equal(dashboard.body.refresh.latestRun.totalFeeds, 1);
  assert.equal(dashboard.body.refresh.latestRun.succeededCount, 1);
  assert.equal(dashboard.body.refresh.latestRun.failedCount, 0);
  assert.ok(
    dashboard.body.auditLogs.some(
      (entry) => entry.action === "admin.refresh.started" && entry.target_id === String(runningRunId)
    )
  );
});

test("tracks maintenance runs and prevents overlapping manual starts", async (t) => {
  const { createClient, runtime } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Maintenance Console" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-maintenance@example.com",
      password: "12345678",
      displayName: "Admin Maintenance"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const started = await adminClient.request("/api/admin/maintenance", {
    method: "POST"
  });

  assert.equal(started.status, 202);
  assert.equal(started.body.started, true);
  assert.equal(started.body.alreadyRunning, false);
  assert.equal(started.body.run.status, "running");
  const runningRunId = started.body.run.id;

  await runtime.services.maintenanceService.waitForIdle();

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.maintenance.isRunning, false);
  assert.equal(dashboard.body.maintenance.latestRun.id, runningRunId);
  assert.equal(dashboard.body.maintenance.latestRun.status, "success");
  assert.equal(typeof dashboard.body.maintenance.latestRun.details.expiredSessionsDeleted, "number");
  assert.equal(typeof dashboard.body.maintenance.latestRun.details.itemsDeleted, "number");
  assert.ok(
    dashboard.body.auditLogs.some(
      (entry) => entry.action === "admin.maintenance.started" && entry.target_id === String(runningRunId)
    )
  );
});

test("admin can inspect, optimize, vacuum, clean up, and back up the database", async (t) => {
  const { createClient, runtime } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Database Console" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-database@example.com",
      password: "12345678",
      displayName: "Admin Database"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const snapshot = await adminClient.request("/api/admin/database");
  assert.equal(snapshot.status, 200);
  assert.equal(typeof snapshot.body.totalBytes, "number");
  assert.ok(snapshot.body.tableRows.some((entry) => entry.table === "items"));
  assert.equal(typeof snapshot.body.orphanTotal, "number");

  const db = new Database(runtime.config.dbPath);
  db.pragma("foreign_keys = OFF");
  db.prepare(`
    INSERT INTO items (feed_id, guid, title, link)
    VALUES (999999, 'orphan-guid', 'Orphan item', 'https://example.com/orphan')
  `).run();
  db.prepare(`
    INSERT INTO user_item_states (user_id, item_id, is_read)
    VALUES (?, 999999, 1)
  `).run(adminRegistered.body.user.id);
  db.close();

  const dirtySnapshot = await adminClient.request("/api/admin/database");
  assert.equal(dirtySnapshot.status, 200);
  assert.ok(dirtySnapshot.body.orphanTotal >= 2);

  const optimized = await adminClient.request("/api/admin/database/optimize", {
    method: "POST"
  });
  assert.equal(optimized.status, 200);
  assert.equal(typeof optimized.body.freeBytes, "number");

  const vacuumed = await adminClient.request("/api/admin/database/vacuum", {
    method: "POST"
  });
  assert.equal(vacuumed.status, 200);
  assert.equal(typeof vacuumed.body.mainBytes, "number");

  const cleanup = await adminClient.request("/api/admin/database/cleanup", {
    method: "POST"
  });
  assert.equal(cleanup.status, 202);
  await runtime.services.maintenanceService.waitForIdle();
  const cleanedSnapshot = await adminClient.request("/api/admin/database");
  assert.equal(cleanedSnapshot.status, 200);
  assert.equal(cleanedSnapshot.body.orphanTotal, 0);
  assert.equal(cleanedSnapshot.body.backups.enabled, true);
  assert.ok(cleanedSnapshot.body.backups.automaticCount >= 1);

  const backup = await adminClient.request("/api/admin/database/backup");
  assert.equal(backup.status, 200);
  const backupDisposition = backup.headers.get("content-disposition") || "";
  assert.match(backupDisposition, /z7rss-.*\.db/);
  const backupFilename = backupDisposition.match(/filename="?([^";]+)"?/i)?.[1];
  assert.ok(backupFilename);

  const backupDir = path.join(path.dirname(runtime.config.dbPath), "backups");
  assert.ok(fs.readdirSync(backupDir).some((entry) => entry.endsWith(".db")));
  assert.ok(fs.readdirSync(backupDir).some((entry) => entry.startsWith("z7rss-auto-") && entry.endsWith(".db")));

  const backupSnapshot = await adminClient.request("/api/admin/database");
  assert.equal(backupSnapshot.status, 200);
  assert.ok(backupSnapshot.body.backups.files.some((entry) => entry.filename === backupFilename));

  const downloadedBackup = await adminClient.request(`/api/admin/database/backups/${encodeURIComponent(backupFilename)}`);
  assert.equal(downloadedBackup.status, 200);
  assert.match(downloadedBackup.headers.get("content-disposition") || "", new RegExp(backupFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const deletedBackup = await adminClient.request(`/api/admin/database/backups/${encodeURIComponent(backupFilename)}`, {
    method: "DELETE"
  });
  assert.equal(deletedBackup.status, 200);
  assert.equal(deletedBackup.body.deleted, true);
  assert.ok(!fs.existsSync(path.join(backupDir, backupFilename)));
});

test("global refresh skips orphaned feeds without subscribers", async (t) => {
  const { createClient, runtime } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Orphan Refresh Console" });
  const keptFeedSource = await createFeedSource(t, {
    title: "Kept Source",
    itemTitle: "Kept Entry"
  });
  const orphanFeedSource = await createFeedSource(t, {
    title: "Orphan Source",
    itemTitle: "Orphan Entry"
  });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-orphan-refresh@example.com",
      password: "12345678",
      displayName: "Admin Orphan Refresh"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const keptFeed = await adminClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Kept Source",
      url: keptFeedSource.url
    }
  });
  const orphanFeed = await adminClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Orphan Source",
      url: orphanFeedSource.url
    }
  });

  assert.equal(keptFeed.status, 201);
  assert.equal(orphanFeed.status, 201);

  const keptBeforeRefresh = keptFeedSource.getRequestCount();
  const orphanBeforeRefresh = orphanFeedSource.getRequestCount();

  const removed = await adminClient.request(`/api/feeds/${orphanFeed.body.feed.feed_id}`, {
    method: "DELETE"
  });

  assert.equal(removed.status, 204);

  const started = await adminClient.request("/api/admin/refresh", {
    method: "POST"
  });

  assert.equal(started.status, 202);
  assert.equal(started.body.run.totalFeeds, 1);

  await runtime.services.refreshService.waitForIdle();

  assert.equal(keptFeedSource.getRequestCount(), keptBeforeRefresh + 1);
  assert.equal(orphanFeedSource.getRequestCount(), orphanBeforeRefresh);

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  const orphanSnapshot = dashboard.body.feeds.find((entry) => entry.id === orphanFeed.body.feed.feed_id);
  assert.equal(orphanSnapshot, undefined);
});

test("hydrates V2EX-like pages from topic content instead of the login navigation shell", async (t) => {
  const { request } = await createHarness(t);

  const articleServer = http.createServer((req, res) => {
    if (req.url === "/feed.xml") {
      res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>V2EX Mock</title>
    <link>https://www.v2ex.com/</link>
    <description>Mock V2EX feed</description>
    <item>
      <guid>v2ex-mock-1</guid>
      <title>Mock Topic</title>
      <link>http://127.0.0.1:${port}/t/1208580</link>
      <description></description>
      <content:encoded><![CDATA[<p>这是抓取到的真实正文。</p>]]></content:encoded>
      <pubDate>Wed, 24 Apr 2024 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`);
      return;
    }

    if (req.url === "/t/1208580") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <title>Mock Topic - V2EX</title>
  </head>
  <body>
    <div class="content">
      <div class="site-nav">
        <a href="https://www.v2ex.com/">首页</a>
        <a href="https://www.v2ex.com/signup">注册</a>
        <a href="https://www.v2ex.com/signin">登录</a>
      </div>
    </div>
    <div id="Main">
      <div class="box">
        <div class="cell">
          <div class="topic_content">
            这是抓取到的真实正文。
            <p>正文第二段。</p>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise((resolve) => articleServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => articleServer.close(resolve));
  });

  const { port } = articleServer.address();
  const registerResponse = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "v2ex@example.com",
      password: "12345678",
      displayName: "V2EX User"
    }
  });

  assert.equal(registerResponse.status, 201);

  const addFeedResponse = await request("/api/feeds", {
    method: "POST",
    json: {
      title: "V2EX Mock",
      url: `http://127.0.0.1:${port}/feed.xml`
    }
  });

  assert.equal(addFeedResponse.status, 201);

  const itemsResponse = await request(`/api/items?feedId=${addFeedResponse.body.feed.id}&limit=20`);
  assert.equal(itemsResponse.status, 200);
  assert.equal(itemsResponse.body.items.length, 1);
  assert.equal(itemsResponse.body.items[0].summary, "");
  assert.match(itemsResponse.body.items[0].content_excerpt, /真实正文/);

  const itemId = itemsResponse.body.items[0].id;
  const contentResponse = await request(`/api/items/${itemId}/content`);
  assert.equal(contentResponse.status, 200);
  assert.equal(contentResponse.body.content_loaded, true);
  assert.match(contentResponse.body.content_text, /真实正文/);
  assert.doesNotMatch(contentResponse.body.content_text, /^首页 注册 登录/u);

  const pageResponse = await request(`/api/items/${itemId}/page`);
  assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.body.page_loaded, true);
  assert.match(pageResponse.body.page_text, /真实正文/);
  assert.doesNotMatch(pageResponse.body.page_text, /^首页 注册 登录/u);
});

test("records failed feed refreshes in global refresh history", async (t) => {
  const { createClient, runtime } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Refresh Failure Console" });
  const feedSource = await createFeedSource(t, {
    title: "Flaky Source"
  });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-refresh-failed@example.com",
      password: "12345678",
      displayName: "Admin Refresh Failed"
    }
  });

  assert.equal(adminRegistered.status, 201);

  const addedFeed = await adminClient.request("/api/feeds", {
    method: "POST",
    json: {
      title: "Flaky Source",
      url: feedSource.url
    }
  });

  assert.equal(addedFeed.status, 201);

  feedSource.setFailing(true);

  const started = await adminClient.request("/api/admin/refresh", {
    method: "POST"
  });

  assert.equal(started.status, 202);
  await runtime.services.refreshService.waitForIdle();

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.refresh.latestRun.status, "failed");
  assert.equal(dashboard.body.refresh.latestRun.failedCount, 1);
  assert.match(dashboard.body.refresh.latestRun.errorSummary, /1 个订阅源刷新失败/);
  assert.ok(Array.isArray(dashboard.body.refresh.latestRun.details.failures));
  assert.equal(dashboard.body.refresh.latestRun.details.failures[0].title, "Flaky Source");
});

test("changes password and revokes other active sessions", async (t) => {
  const { createClient } = await createHarness(t);
  const primary = createClient({ "user-agent": "Primary Device" });
  const secondary = createClient({ "user-agent": "Secondary Device" });

  const registered = await primary.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "security@example.com",
      password: "12345678",
      displayName: "Security User"
    }
  });

  assert.equal(registered.status, 201);

  const loggedInSecondary = await secondary.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "security@example.com",
      password: "12345678"
    }
  });

  assert.equal(loggedInSecondary.status, 200);

  const securityBefore = await primary.request("/api/account/security");
  assert.equal(securityBefore.status, 200);
  assert.ok(securityBefore.body.sessions.length >= 2);
  assert.ok(securityBefore.body.sessions.some((entry) => entry.isCurrent));

  const changed = await primary.request("/api/account/password", {
    method: "POST",
    json: {
      currentPassword: "12345678",
      newPassword: "87654321",
      revokeOtherSessions: true
    }
  });

  assert.equal(changed.status, 200);
  assert.ok(changed.body.revokedCount >= 1);
  assert.equal(changed.body.sessions.length, 1);
  assert.equal(changed.body.sessions[0].isCurrent, true);

  const secondaryAfter = await secondary.request("/api/account/preferences");
  assert.equal(secondaryAfter.status, 401);
  assert.equal(secondaryAfter.body.code, "auth_required");

  const oldPasswordClient = createClient();
  const oldPasswordLogin = await oldPasswordClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "security@example.com",
      password: "12345678"
    }
  });

  assert.equal(oldPasswordLogin.status, 401);
  assert.equal(oldPasswordLogin.body.code, "invalid_credentials");

  const newPasswordClient = createClient();
  const newPasswordLogin = await newPasswordClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "security@example.com",
      password: "87654321"
    }
  });

  assert.equal(newPasswordLogin.status, 200);
});

test("supports a Google Reader API compatibility flow", async (t) => {
  const { createClient } = await createHarness(t);
  const browserClient = createClient({ "user-agent": "Reader Browser" });
  const apiClient = createClient({ "user-agent": "Reader API Client" });
  const feedSource = await createFeedSource(t, {
    title: "Reader Source",
    itemTitle: "Reader Entry"
  });

  const registered = await browserClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "reader@example.com",
      password: "12345678",
      displayName: "Reader User"
    }
  });

  assert.equal(registered.status, 201);

  const clientLogin = await apiClient.request("/accounts/ClientLogin", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      Email: "reader@example.com",
      Passwd: "12345678",
      service: "reader"
    }).toString()
  });

  assert.equal(clientLogin.status, 200);
  assert.match(clientLogin.body, /Auth=/);
  const authLine = String(clientLogin.body)
    .split("\n")
    .find((line) => line.startsWith("Auth="));
  const authToken = authLine?.slice(5).trim();
  assert.ok(authToken);

  const readerClient = createClient({
    authorization: `GoogleLogin auth=${authToken}`,
    "user-agent": "Reader API Client"
  });

  const subscribe = await readerClient.request("/reader/api/0/subscription/edit", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      ac: "subscribe",
      s: `feed/${feedSource.url}`,
      t: "Reader Feed",
      a: "user/-/label/Tech"
    }).toString()
  });

  assert.equal(subscribe.status, 200);
  assert.equal(subscribe.body, "OK");

  const tokenResponse = await readerClient.request("/reader/api/0/token");
  assert.equal(tokenResponse.status, 200);
  assert.equal(String(tokenResponse.body).trim(), authToken);

  const subscriptionList = await readerClient.request("/reader/api/0/subscription/list?output=json");
  assert.equal(subscriptionList.status, 200);
  assert.equal(subscriptionList.body.subscriptions.length, 1);
  assert.equal(subscriptionList.body.subscriptions[0].title, "Reader Feed");
  assert.equal(subscriptionList.body.subscriptions[0].categories[0].id, "user/-/label/Tech");

  const unreadCounts = await readerClient.request("/reader/api/0/unread-count?output=json");
  assert.equal(unreadCounts.status, 200);
  assert.equal(unreadCounts.body.unreadcounts[0].id, "user/-/state/com.google/reading-list");
  assert.equal(unreadCounts.body.unreadcounts[0].count, 1);

  const itemIdsResponse = await readerClient.request(
    "/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=20&output=json"
  );
  assert.equal(itemIdsResponse.status, 200);
  assert.equal(itemIdsResponse.body.itemRefs.length, 1);
  const readerItemId = itemIdsResponse.body.itemRefs[0].id;

  const streamContents = await readerClient.request(
    "/reader/api/0/stream/contents/user/-/state/com.google/reading-list?xt=user/-/state/com.google/read&n=20&output=json"
  );
  assert.equal(streamContents.status, 200);
  assert.equal(streamContents.body.items.length, 1);
  assert.match(streamContents.body.items[0].title, /Reader Entry/);

  const editStar = await readerClient.request("/reader/api/0/edit-tag", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      i: readerItemId,
      a: "user/-/state/com.google/starred"
    }).toString()
  });
  assert.equal(editStar.status, 200);
  assert.equal(editStar.body, "OK");

  const editRead = await readerClient.request("/reader/api/0/edit-tag", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      i: readerItemId,
      a: "user/-/state/com.google/read"
    }).toString()
  });
  assert.equal(editRead.status, 200);
  assert.equal(editRead.body, "OK");

  const starredContents = await readerClient.request(
    "/reader/api/0/stream/contents/user/-/state/com.google/starred?n=20&output=json"
  );
  assert.equal(starredContents.status, 200);
  assert.equal(starredContents.body.items.length, 1);
  assert.equal(starredContents.body.items[0].id, readerItemId);

  const unreadAfterRead = await readerClient.request("/reader/api/0/unread-count?output=json");
  assert.equal(unreadAfterRead.status, 200);
  assert.equal(unreadAfterRead.body.unreadcounts[0].count, 0);

  const unsubscribe = await readerClient.request("/reader/api/0/subscription/edit", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      ac: "unsubscribe",
      s: `feed/${feedSource.url}`
    }).toString()
  });
  assert.equal(unsubscribe.status, 200);
  assert.equal(unsubscribe.body, "OK");

  const subscriptionListAfter = await readerClient.request("/reader/api/0/subscription/list?output=json");
  assert.equal(subscriptionListAfter.status, 200);
  assert.equal(subscriptionListAfter.body.subscriptions.length, 0);
});
