import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDb } from "../src/db.js";
import { createStore } from "../src/repositories/store.js";
import { createAccountService } from "../src/services/account-service.js";
import { createAdminService } from "../src/services/admin-service.js";
import { createAuthService } from "../src/services/auth-service.js";

function createTestContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-redeem-code-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);
  const store = createStore(db);
  const config = { billingProvider: "demo", aiEnabled: true, dbPath };
  const secretBox = { encrypt: (value) => value, decrypt: (value) => value };
  const accountService = createAccountService({ store, config, secretBox });
  const adminService = createAdminService({
    store,
    accountService,
    config,
    secretBox,
    feedService: null
  });
  const authService = createAuthService({
    store,
    config: {
      appSecret: "test-secret",
      sessionTtlDays: 30
    }
  });

  return { db, adminService, authService };
}

test("admin generated redeem codes are sellable one-time codes with usage details", () => {
  const { db, adminService, authService } = createTestContext();

  try {
    const created = adminService.createRedeemCode({
      planCode: "pro",
      quantity: 2,
      prefix: "sale",
      note: "shop batch"
    });

	    assert.equal(created.redeemCodes.length, 2);
	    assert.match(created.batchId, /^batch_/);
	    assert.equal(created.redeemCodes[0].batch_id, created.batchId);
	    assert.equal(created.redeemCodes[1].batch_id, created.batchId);
	    assert.equal(created.redeemCodes[0].max_uses, 1);
	    assert.match(created.redeemCodes[0].code, /^SALE-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const { user } = authService.register({
      email: "buyer@example.com",
      password: "password123",
      displayName: "Buyer"
    });

    adminService.redeemCodeForUser(user.id, created.redeemCodes[0].code);
    assert.throws(
      () => adminService.redeemCodeForUser(user.id, created.redeemCodes[0].code),
      (error) => error.code === "redeem_code_exhausted"
    );

	    const usedCode = adminService.getDashboard().redeemCodes.find((entry) => entry.code === created.redeemCodes[0].code);
	    assert.equal(usedCode.used_count, 1);
	    assert.equal(usedCode.resolved_batch_id, created.batchId);
	    assert.equal(usedCode.redeemed_user_email, "buyer@example.com");
	    assert.ok(usedCode.redeemed_at);
	  } finally {
	    db.close();
	  }
	});

test("admin can delete unused redeem code batches while retaining redeemed codes", () => {
  const { db, adminService, authService } = createTestContext();

  try {
    const created = adminService.createRedeemCode({
      planCode: "team",
      quantity: 3,
      prefix: "bulk",
      note: "bulk batch"
    });
    const { user } = authService.register({
      email: "batch-buyer@example.com",
      password: "password123",
      displayName: "Batch Buyer"
    });

    adminService.redeemCodeForUser(user.id, created.redeemCodes[0].code);

    assert.throws(
      () => adminService.deleteRedeemCode(created.redeemCodes[0].id),
      (error) => error.code === "redeem_code_used"
    );

    const result = adminService.deleteRedeemCodeBatch(created.batchId);
    assert.equal(result.deletedCount, 2);
    assert.equal(result.retainedUsedCount, 1);

    const remainingBatchCodes = adminService.getDashboard().redeemCodes.filter((entry) => entry.resolved_batch_id === created.batchId);
    assert.equal(remainingBatchCodes.length, 1);
    assert.equal(remainingBatchCodes[0].code, created.redeemCodes[0].code);
    assert.equal(remainingBatchCodes[0].used_count, 1);
  } finally {
    db.close();
  }
});
