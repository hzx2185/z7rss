import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";

test("createConfig rejects placeholder APP_SECRET in production", () => {
  assert.throws(
    () => createConfig({ NODE_ENV: "production", APP_SECRET: "change-me-before-production" }),
    (error) => error.code === "app_secret_required"
  );
});

test("createConfig allows explicit non-default APP_SECRET in production", () => {
  const config = createConfig({
    NODE_ENV: "production",
    APP_SECRET: "z7rss-production-secret-with-enough-entropy"
  });

  assert.equal(config.appSecret, "z7rss-production-secret-with-enough-entropy");
});

test("createConfig creates and reuses APP_SECRET_FILE in production", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-secret-"));
  const secretFile = path.join(dir, "app-secret");

  const config = createConfig({
    NODE_ENV: "production",
    APP_SECRET_FILE: secretFile
  });

  assert.match(config.appSecret, /^[a-f0-9]{96}$/);
  assert.equal(fs.readFileSync(secretFile, "utf8").trim(), config.appSecret);

  const reused = createConfig({
    NODE_ENV: "production",
    APP_SECRET: "change-me-before-production",
    APP_SECRET_FILE: secretFile
  });

  assert.equal(reused.appSecret, config.appSecret);
});

test("createConfig can boot production from image defaults without APP_SECRET env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "z7rss-compose-defaults-"));
  const secretFile = path.join(dir, "app-secret");

  const config = createConfig({
    NODE_ENV: "production",
    PORT: "80",
    DB_PATH: "/app/data/rss.db",
    APP_SECRET_FILE: secretFile
  });

  assert.equal(config.port, 80);
  assert.equal(config.dbPath, "/app/data/rss.db");
  assert.match(config.appSecret, /^[a-f0-9]{96}$/);
});
