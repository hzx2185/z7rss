import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createRuntime } from "../src/bootstrap.js";
import { createDb } from "../src/db.js";

test("migrates sessions.last_seen_at without unsupported sqlite defaults", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-test-"));
  const dbPath = path.join(tempDir, "rss.db");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO sessions (token, user_id, expires_at, created_at)
    VALUES ('legacy-token', 1, '2099-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  `);
  legacyDb.close();

  const migratedDb = createDb(dbPath);
  t.after(() => migratedDb.close());

  const session = migratedDb
    .prepare(`SELECT created_at, last_seen_at FROM sessions WHERE token = ?`)
    .get("legacy-token");

  assert.equal(session.last_seen_at, session.created_at);
});

test("migrates user_feeds feed title translation columns", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-test-"));
  const dbPath = path.join(tempDir, "rss.db");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feed_id INTEGER NOT NULL,
      custom_title TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, feed_id)
    );
  `);
  legacyDb.close();

  const migratedDb = createDb(dbPath);
  t.after(() => migratedDb.close());

  const columns = migratedDb.prepare(`PRAGMA table_info(user_feeds)`).all();
  const columnNames = new Set(columns.map((column) => column.name));

  assert.equal(columnNames.has("translated_title"), true);
  assert.equal(columnNames.has("translated_language"), true);
  assert.equal(columnNames.has("translated_source_title"), true);
});

test("runtime shutdown closes the database cleanly for reuse", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-db-test-"));
  const dbPath = path.join(tempDir, "rss.db");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = {
    APP_SECRET: "test-secret",
    APP_URL: "http://127.0.0.1",
    DB_PATH: dbPath,
    AI_ENABLED: "false"
  };

  const runtime = createRuntime(env);
  runtime.services.refreshService.startSchedule();
  runtime.services.maintenanceService.startSchedule();
  await runtime.shutdown();

  const reopenedRuntime = createRuntime(env);
  await reopenedRuntime.shutdown();

  assert.equal(fs.existsSync(dbPath), true);
});
