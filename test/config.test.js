import assert from "node:assert/strict";
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
