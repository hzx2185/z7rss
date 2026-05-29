import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { checkSqliteFile, SqliteHealthError } from "../src/lib/sqlite-health.js";

test("checkSqliteFile accepts a healthy sqlite database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-sqlite-health-"));
  const dbPath = path.join(dir, "healthy.db");
  const db = new Database(dbPath);

  try {
    db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO smoke (value) VALUES (?)").run("ok");
  } finally {
    db.close();
  }

  assert.equal(checkSqliteFile(dbPath), "ok");
});

test("checkSqliteFile rejects a malformed sqlite file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-sqlite-health-"));
  const dbPath = path.join(dir, "broken.db");
  fs.writeFileSync(dbPath, "this is not sqlite");

  assert.throws(
    () => checkSqliteFile(dbPath),
    (error) => error instanceof SqliteHealthError && error.code === "sqlite_health_check_failed"
  );
});

test("database durability config defaults to conservative sqlite settings", () => {
  const config = createConfig({});

  assert.equal(config.databaseSynchronous, "FULL");
  assert.equal(config.databaseBusyTimeoutMs, 10000);
});

test("createDb applies durability pragmas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-pragmas-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath, {
    synchronous: "FULL",
    busyTimeoutMs: 12000
  });

  try {
    assert.equal(String(db.pragma("journal_mode", { simple: true })).toLowerCase(), "wal");
    assert.equal(Number(db.pragma("synchronous", { simple: true })), 2);
    assert.equal(Number(db.pragma("busy_timeout", { simple: true })), 12000);
  } finally {
    db.close();
  }
});

test("createDb seeds billing plan prices from injected options", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-plan-prices-"));
  const dbPath = path.join(dir, "rss.db");
  const previousPro = process.env.STRIPE_PRICE_PRO_MONTHLY;
  const previousTeam = process.env.STRIPE_PRICE_TEAM_MONTHLY;
  process.env.STRIPE_PRICE_PRO_MONTHLY = "env_pro_price";
  process.env.STRIPE_PRICE_TEAM_MONTHLY = "env_team_price";

  const db = createDb(dbPath, {
    stripePriceProMonthly: "config_pro_price",
    stripePriceTeamMonthly: "config_team_price"
  });

  try {
    const prices = Object.fromEntries(
      db.prepare("SELECT code, stripe_price_id FROM plans WHERE code IN ('pro', 'team')").all()
        .map((row) => [row.code, row.stripe_price_id])
    );
    assert.deepEqual(prices, {
      pro: "config_pro_price",
      team: "config_team_price"
    });
  } finally {
    db.close();
    if (previousPro === undefined) {
      delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_PRO_MONTHLY = previousPro;
    }
    if (previousTeam === undefined) {
      delete process.env.STRIPE_PRICE_TEAM_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_TEAM_MONTHLY = previousTeam;
    }
  }
});

test("createDb seeds special route entitlement for paid plans", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-plan-routes-"));
  const dbPath = path.join(dir, "rss.db");
  const db = createDb(dbPath);

  try {
    const entitlements = Object.fromEntries(
      db.prepare("SELECT code, special_routes_enabled FROM plans ORDER BY code ASC").all()
        .map((row) => [row.code, row.special_routes_enabled])
    );
    assert.deepEqual(entitlements, {
      free: 0,
      pro: 1,
      team: 1
    });
  } finally {
    db.close();
  }
});
