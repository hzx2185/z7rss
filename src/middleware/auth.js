import { forbidden, unauthorized } from "../lib/errors.js";
import { parseCookies } from "../lib/http.js";
import { getRequestIp } from "../lib/request.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getHeader(req, name) {
  return req.get?.(name) || req.headers?.[name.toLowerCase()] || "";
}

function getOriginFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null") return "";
  try {
    return new URL(raw).origin;
  } catch (_error) {
    return "";
  }
}

function getRequestOrigin(req, config) {
  const host = String(getHeader(req, "host") || "").trim();
  if (host) {
    const protocol = req.protocol || (req.secure ? "https" : "http");
    return `${protocol}://${host}`;
  }
  return getOriginFromUrl(config.appUrl);
}

function getAllowedOrigins(req, config) {
  return new Set([
    getRequestOrigin(req, config),
    getOriginFromUrl(config.appUrl)
  ].filter(Boolean));
}

export function createAccessControlLayer({ authService, adminService = null, config }) {
  function identify(req, _res, next) {
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

  function denyBlockedIp(req, _res, next) {
    const requestIp = getRequestIp(req);
    if (adminService?.isBlockedIp?.(requestIp)) {
      return next(forbidden("当前 IP 已被系统屏蔽", { code: "ip_blocked" }));
    }
    next();
  }

  function requireSameOriginForCookieWrites(req, _res, next) {
    if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
      return next();
    }
    if (!String(req.path || "").startsWith("/api/")) {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie || "");
    if (!cookies[config.sessionCookieName]) {
      return next();
    }

    const requestOrigin = getOriginFromUrl(getHeader(req, "origin")) || getOriginFromUrl(getHeader(req, "referer"));
    if (!requestOrigin || !getAllowedOrigins(req, config).has(requestOrigin)) {
      return next(forbidden("请求来源无效，请刷新页面后重试", { code: "csrf_origin_mismatch" }));
    }

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
    identify,
    denyBlockedIp,
    requireSameOriginForCookieWrites,
    requireAuth,
    requireAdmin
  };
}
