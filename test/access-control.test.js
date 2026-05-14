import assert from "node:assert/strict";
import test from "node:test";
import { createAccessControlLayer } from "../src/middleware/auth.js";

function runMiddleware(middleware, req = {}) {
  return new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error || null));
  });
}

test("access control identifies the current user from the session cookie", async () => {
  const calls = [];
  const accessControl = createAccessControlLayer({
    config: { sessionCookieName: "sid" },
    adminService: { isBlockedIp: () => false },
    authService: {
      getUserFromToken(token, options) {
        calls.push({ token, options });
        return { user: { id: 7, isAdmin: false }, session: { token } };
      }
    }
  });
  const req = {
    path: "/api/feeds",
    headers: {
      cookie: "sid=test-token",
      "user-agent": "Test Agent"
    },
    ip: "203.0.113.10"
  };

  const error = await runMiddleware(accessControl.identify, req);

  assert.equal(error, null);
  assert.equal(req.auth.user.id, 7);
  assert.equal(calls[0].token, "test-token");
  assert.equal(calls[0].options.touch, true);
  assert.equal(calls[0].options.userAgent, "Test Agent");
});

test("access control rejects blocked IPs before route handlers", async () => {
  const accessControl = createAccessControlLayer({
    config: { sessionCookieName: "sid" },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => true }
  });
  const req = {
    path: "/api/feeds",
    headers: {},
    ip: "198.51.100.4"
  };

  const error = await runMiddleware(accessControl.denyBlockedIp, req);

  assert.equal(error.status, 403);
  assert.equal(error.code, "ip_blocked");
});

test("access control keeps user and admin route guards in one layer", async () => {
  const accessControl = createAccessControlLayer({
    config: { sessionCookieName: "sid" },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => false }
  });

  assert.equal((await runMiddleware(accessControl.requireAuth, {})).code, "auth_required");
  assert.equal((await runMiddleware(accessControl.requireAdmin, { auth: { user: { isAdmin: false } } })).code, "admin_required");
  assert.equal(await runMiddleware(accessControl.requireAdmin, { auth: { user: { isAdmin: true } } }), null);
});

test("access control allows same-origin cookie API writes", async () => {
  const accessControl = createAccessControlLayer({
    config: {
      appUrl: "https://rss.example.test",
      sessionCookieName: "sid"
    },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => false }
  });
  const req = {
    method: "POST",
    path: "/api/feeds",
    protocol: "https",
    headers: {
      cookie: "sid=test-token",
      host: "rss.example.test",
      origin: "https://rss.example.test"
    }
  };

  assert.equal(await runMiddleware(accessControl.requireSameOriginForCookieWrites, req), null);
});

test("access control rejects cross-origin cookie API writes", async () => {
  const accessControl = createAccessControlLayer({
    config: {
      appUrl: "https://rss.example.test",
      sessionCookieName: "sid"
    },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => false }
  });
  const req = {
    method: "POST",
    path: "/api/items/1/read-state",
    protocol: "https",
    headers: {
      cookie: "sid=test-token",
      host: "rss.example.test",
      origin: "https://evil.example.test"
    }
  };

  const error = await runMiddleware(accessControl.requireSameOriginForCookieWrites, req);

  assert.equal(error.status, 403);
  assert.equal(error.code, "csrf_origin_mismatch");
});

test("access control skips same-origin checks for non-cookie API clients", async () => {
  const accessControl = createAccessControlLayer({
    config: {
      appUrl: "https://rss.example.test",
      sessionCookieName: "sid"
    },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => false }
  });
  const req = {
    method: "POST",
    path: "/api/items/1/read-state",
    protocol: "https",
    headers: {
      authorization: "Bearer api-token",
      host: "rss.example.test",
      origin: "https://evil.example.test"
    }
  };

  assert.equal(await runMiddleware(accessControl.requireSameOriginForCookieWrites, req), null);
});

test("access control skips same-origin checks outside the /api surface", async () => {
  const accessControl = createAccessControlLayer({
    config: {
      appUrl: "https://rss.example.test",
      sessionCookieName: "sid"
    },
    authService: { getUserFromToken: () => null },
    adminService: { isBlockedIp: () => false }
  });
  const req = {
    method: "POST",
    path: "/reader/api/0/edit-tag",
    protocol: "https",
    headers: {
      cookie: "sid=test-token",
      host: "rss.example.test",
      origin: "https://evil.example.test"
    }
  };

  assert.equal(await runMiddleware(accessControl.requireSameOriginForCookieWrites, req), null);
});
