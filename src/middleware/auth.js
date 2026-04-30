import { forbidden, unauthorized } from "../lib/errors.js";
import { parseCookies } from "../lib/http.js";
import { getRequestIp } from "../lib/request.js";

export function createAuthMiddleware({ authService, config }) {
  function attachCurrentUser(req, _res, next) {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[config.sessionCookieName];
    const auth = authService.getUserFromToken(token, {
      touch: req.path.startsWith("/api/"),
      requestIp: getRequestIp(req),
      userAgent: req.headers["user-agent"] || ""
    });
    req.auth = auth;
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.auth?.user) {
      return next(unauthorized("请先登录", { code: "auth_required" }));
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.auth?.user) {
      return next(unauthorized("请先登录", { code: "auth_required" }));
    }
    if (!req.auth.user.isAdmin) {
      return next(forbidden("需要管理员权限", { code: "admin_required" }));
    }
    next();
  }

  return {
    attachCurrentUser,
    requireAuth,
    requireAdmin
  };
}
