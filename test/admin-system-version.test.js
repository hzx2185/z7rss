import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createAccountService } from "../src/services/account-service.js";
import { createAdminService } from "../src/services/admin-service.js";

function createSystemHarness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-admin-system-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);
  const store = createStore(db);
  const config = {
    billingProvider: "demo",
    aiEnabled: true,
    dbPath,
    appVersion: "1.2.3",
    buildCommit: "abcdef1234567890",
    buildTime: "2026-05-20T01:00:00.000Z",
    dockerImage: "hzx2185/z7rss",
    dockerImageTag: "latest",
    dockerUpdateCheckTimeoutMs: 1000,
    dockerHubApiBaseUrl: "https://hub.docker.com/v2"
  };
  const secretBox = { encrypt: (value) => value, decrypt: (value) => value };
  const accountService = createAccountService({ store, config, secretBox });
  const adminService = createAdminService({
    store,
    accountService,
    config,
    secretBox,
    feedService: null,
    dockerHubFetch: options.dockerHubFetch
  });

  return { db, adminService };
}

test("admin dashboard includes application version and image metadata", () => {
  const { db, adminService } = createSystemHarness();

  try {
    const dashboard = adminService.getDashboard();
    assert.equal(dashboard.system.appVersion, "1.2.3");
    assert.equal(dashboard.system.buildCommit, "abcdef1234567890");
    assert.equal(dashboard.system.docker.image, "hzx2185/z7rss");
    assert.equal(dashboard.system.docker.tag, "latest");
  } finally {
    db.close();
  }
});

test("admin Docker update check reports latest image metadata", async () => {
  const { db, adminService } = createSystemHarness({
    dockerHubFetch: async (url) => {
      assert.equal(String(url), "https://hub.docker.com/v2/namespaces/hzx2185/repositories/z7rss/tags/latest");
      return {
        ok: true,
        json: async () => ({
          tag_last_pushed: "2026-05-20T02:00:00.000Z",
          digest: "sha256:1234567890abcdef",
          full_size: 123456,
          tag_status: "active"
        })
      };
    }
  });

  try {
    const result = await adminService.checkDockerImageUpdate();
    assert.equal(result.appVersion, "1.2.3");
    assert.equal(result.remoteUpdatedAt, "2026-05-20T02:00:00.000Z");
    assert.equal(result.remoteDigest, "sha256:1234567890abcdef");
    assert.equal(result.remoteSizeBytes, 123456);
    assert.equal(result.updateAvailable, true);
  } finally {
    db.close();
  }
});
