import express from "express";
import { clearSessionCookie, setSessionCookie } from "../lib/http.js";
import { getRequestIp, isSecureRequest } from "../lib/request.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import { route } from "../lib/routes.js";
import { expectObject, parseEmail, parsePassword, parseTrimmedString } from "../lib/validation.js";
import { hashPassword } from "../lib/security.js";

export function createAuthRouter({ authService, accountService, config, store, mailService }) {
  const router = express.Router();
  const passwordResetCodes = new Map();
  const getSessionContext = (req) => ({
    requestIp: getRequestIp(req),
    userAgent: req.headers["user-agent"] || ""
  });
  const getCookieOptions = (req) => ({
    secure: Boolean(config.secureCookies || isSecureRequest(req))
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
    setSessionCookie(res, config.sessionCookieName, result.session.token, config.sessionTtlDays * 24 * 60 * 60, getCookieOptions(req));
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
    setSessionCookie(res, config.sessionCookieName, result.session.token, config.sessionTtlDays * 24 * 60 * 60, getCookieOptions(req));
    res.json({
      user: result.user,
      account: accountService.getAccount(result.user)
    });
  }));

  router.post("/logout", (req, res) => {
    const token = req.auth?.session?.token;
    authService.logout(token);
    clearSessionCookie(res, config.sessionCookieName, getCookieOptions(req));
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

  router.post("/send-reset-code", authWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const email = parseEmail(body.email).toLowerCase();
    
    const user = store.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "该邮箱未注册" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    passwordResetCodes.set(email, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    await mailService.sendMail({
      to: email,
      subject: "Z7 RSS 重置密码验证码",
      text: `您的验证码是 ${code}。请在 10 分钟内完成密码重置。`,
      html: `<p>您的重置密码验证码是 <strong>${code}</strong>。请在 10 分钟内完成密码重置。</p>`
    });

    res.json({ ok: true });
  }));

  router.post("/reset-password", authWriteLimiter, route(async (req, res) => {
    const body = expectObject(req.body || {});
    const email = parseEmail(body.email).toLowerCase();
    const code = parseTrimmedString(body.code, "验证码", { required: true });
    const newPassword = parsePassword(body.newPassword);

    const record = passwordResetCodes.get(email);
    if (!record || record.expiresAt < Date.now() || record.code !== code) {
      return res.status(400).json({ error: "验证码错误或已过期" });
    }

    const user = store.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "用户不存在" });
    }

    store.setUserPassword(user.id, hashPassword(newPassword));
    store.deleteUserSessions(user.id);
    passwordResetCodes.delete(email);

    res.json({ ok: true });
  }));

  return router;
}
