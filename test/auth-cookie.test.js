import assert from "node:assert/strict";
import test from "node:test";
import { createAuthRouter } from "../src/routes/auth.js";

function createResponseCapture() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test("auth router marks session cookies secure behind an https reverse proxy", async () => {
  const router = createAuthRouter({
    config: {
      rateLimitAuthWindowMs: 60_000,
      rateLimitAuthMax: 100,
      secureCookies: false,
      sessionCookieName: "sid",
      sessionTtlDays: 30
    },
    accountService: {
      getAccount() {
        return {};
      }
    },
    authService: {
      login() {
        return {
          user: { id: 1, email: "reader@example.test" },
          session: { token: "test-token" }
        };
      }
    }
  });
  const layer = router.stack.find((entry) => entry.route?.path === "/login")?.route?.stack.at(-1)?.handle;
  const req = {
    body: { email: "reader@example.test", password: "password" },
    headers: {
      "x-forwarded-proto": "https"
    },
    ip: "127.0.0.1",
    method: "POST",
    path: "/login"
  };
  const res = createResponseCapture();

  await layer(req, res, (error) => {
    throw error;
  });

  assert.match(res.headers["set-cookie"], /Secure/);
});

test("auth router keeps local http session cookies non-secure by default", async () => {
  const router = createAuthRouter({
    config: {
      rateLimitAuthWindowMs: 60_000,
      rateLimitAuthMax: 100,
      secureCookies: false,
      sessionCookieName: "sid",
      sessionTtlDays: 30
    },
    accountService: {
      getAccount() {
        return {};
      }
    },
    authService: {
      login() {
        return {
          user: { id: 1, email: "reader@example.test" },
          session: { token: "test-token" }
        };
      }
    }
  });
  const layer = router.stack.find((entry) => entry.route?.path === "/login")?.route?.stack.at(-1)?.handle;
  const req = {
    body: { email: "reader@example.test", password: "password" },
    headers: {},
    ip: "127.0.0.1",
    method: "POST",
    path: "/login"
  };
  const res = createResponseCapture();

  await layer(req, res, (error) => {
    throw error;
  });

  assert.doesNotMatch(res.headers["set-cookie"], /Secure/);
});
