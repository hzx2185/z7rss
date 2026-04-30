import assert from "node:assert/strict";
import test from "node:test";
import { createMaintenanceService } from "../src/services/maintenance-service.js";

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("maintenance service prunes data and records a summary", async () => {
  let optimized = false;
  const service = createMaintenanceService({
    store: {
      deleteExpiredSessions() {
        return 3;
      },
      cleanupOrphans() {
        return {
          beforeTotal: 6,
          afterTotal: 0,
          changes: {
            orphanFeedsDeleted: 2,
            itemsDeleted: 1,
            userItemStatesDeleted: 2,
            userItemStatesDeletedAfterItems: 1,
            totalDeleted: 6,
            totalChanged: 6
          }
        };
      },
      pruneAuditLogs(options) {
        assert.equal(options.retentionDays, 21);
        assert.equal(options.maxEntries, 1200);
        return 4;
      },
      pruneRefreshRuns(options) {
        assert.equal(options.retentionDays, 9);
        assert.equal(options.maxEntries, 320);
        return 5;
      },
      optimize() {
        optimized = true;
      }
    },
    feedService: {
      pruneAllFeeds() {
        return {
          feedsProcessed: 7,
          itemsDeleted: 11
        };
      }
    },
    config: {
      maintenanceIntervalMinutes: 360,
      auditLogRetentionDays: 21,
      auditLogMaxEntries: 1200,
      refreshRunRetentionDays: 9,
      refreshRunMaxEntries: 320
    }
  });

  const trigger = service.triggerRun({ trigger: "manual" });
  assert.equal(trigger.started, true);
  assert.equal(trigger.alreadyRunning, false);

  const completed = await service.waitForIdle();
  assert.equal(completed.status, "success");
  assert.equal(completed.trigger, "manual");
  assert.equal(completed.details.expiredSessionsDeleted, 3);
  assert.equal(completed.details.feedsProcessed, 7);
  assert.equal(completed.details.itemsDeleted, 11);
  assert.equal(completed.details.orphanFeedsDeleted, 2);
  assert.equal(completed.details.orphanItemsDeleted, 1);
  assert.equal(completed.details.orphanUserItemStatesDeleted, 3);
  assert.equal(completed.details.orphanRecordsDeleted, 6);
  assert.equal(completed.details.orphanRecordsBefore, 6);
  assert.equal(completed.details.orphanRecordsAfter, 0);
  assert.equal(completed.details.auditLogsDeleted, 4);
  assert.equal(completed.details.refreshRunsDeleted, 5);
  assert.equal(completed.details.optimized, true);
  assert.deepEqual(completed.details.errors, []);
  assert.equal(optimized, true);

  const status = service.getStatus();
  assert.equal(status.isRunning, false);
  assert.equal(status.latestRun?.id, completed.id);
  assert.equal(status.recentRuns.length, 1);
});

test("maintenance service does not overlap concurrent runs", async () => {
  const gate = createDeferred();
  let runCount = 0;

  const service = createMaintenanceService({
    store: {
      deleteExpiredSessions() {
        return 0;
      },
      cleanupOrphans() {
        return {
          beforeTotal: 0,
          afterTotal: 0,
          changes: {
            totalDeleted: 0,
            totalChanged: 0
          }
        };
      },
      pruneAuditLogs() {
        return 0;
      },
      pruneRefreshRuns() {
        return 0;
      },
      optimize() {}
    },
    feedService: {
      async pruneAllFeeds() {
        runCount += 1;
        await gate.promise;
        return {
          feedsProcessed: 1,
          itemsDeleted: 0
        };
      }
    },
    config: {
      maintenanceIntervalMinutes: 60,
      auditLogRetentionDays: 30,
      auditLogMaxEntries: 5000,
      refreshRunRetentionDays: 14,
      refreshRunMaxEntries: 1000
    }
  });

  const first = service.triggerRun({ trigger: "manual" });
  const second = service.triggerRun({ trigger: "schedule" });

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(second.alreadyRunning, true);
  await Promise.resolve();
  assert.equal(runCount, 1);

  gate.resolve();
  await service.waitForIdle();
  assert.equal(service.getStatus().isRunning, false);
  assert.equal(runCount, 1);
});
