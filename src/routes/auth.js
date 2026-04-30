import express from "express";
import { clearSessionCookie, setSessionCookie } from "../lib/http.js";
import { getRequestIp } from "../lib/request.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import { expectObject, parseEmail, parsePassword, parseTrimmedString } from "../lib/validation.js";

export function createAuthRouter({ authService, accountService, config }) {
  const router = express.Router();
  const getSessionContext = (req) => ({
    requestIp: getRequestIp(req),
    userAgent: req.headers["user-agent"] || ""
  });
  const authWriteLimiter = createRateLimiter({
    name: "auth",
    windowMs: config.rateLimitAuthWindowMs,
    max: config.rateLimitAuthMax,
    code: "auth_rate_limited",
    message: "登录或注册尝试过于频繁，请稍后再试"
  });

  router.post("/register", authWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = authService.register({
      email: parseEmail(body.email),
      password: parsePassword(body.password),
      displayName: parseTrimmedString(body.displayName, "昵称", { required: true, maxLength: 80 })
    }, getSessionContext(req));
    setSessionCookie(res, config.sessionCookieName, result.session.token, config.sessionTtlDays * 24 * 60 * 60, {
      secure: config.secureCookies
    });
    res.status(201).json({
      user: result.user,
      account: accountService.getAccount(result.user)
    });
  }));

  router.post("/login", authWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = authService.login({
      email: parseEmail(body.email),
      password: parsePassword(body.password, "密码", { minLength: 1 })
    }, getSessionContext(req));
    setSessionCookie(res, config.sessionCookieName, result.session.token, config.sessionTtlDays * 24 * 60 * 60, {
      secure: config.secureCookies
    });
    res.json({
      user: result.user,
      account: accountService.getAccount(result.user)
    });
  }));

  router.post("/logout", (req, res) => {
    const token = req.auth?.session?.token;
    authService.logout(token);
    clearSessionCookie(res, config.sessionCookieName, { secure: config.secureCookies });
    res.status(204).end();
  });

  router.get("/me", (req, res) => {
    if (!req.auth?.user) {
      return res.json({ authenticated: false, user: null, account: null });
    }

    res.json({
      authenticated: true,
      user: req.auth.user,
      account: accountService.getAccount(req.auth.user),
      preferences: accountService.getUserPreferences(req.auth.user.id)
    });
  });

  return router;
}
