export function createSecurityHeadersMiddleware(config) {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data: https: http:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https: http:",
    "manifest-src 'self'",
    "media-src 'self' data: blob: https: http:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'"
  ].join("; ");

  function isPotentiallyTrustworthyOrigin(req) {
    if (req.secure || req.protocol === "https") return true;
    const hostname = String(req.hostname || "").toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  }

  return function securityHeaders(req, res, next) {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (isPotentiallyTrustworthyOrigin(req)) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Origin-Agent-Cluster", "?1");
    }
    res.setHeader(
      "Permissions-Policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
    );
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-DNS-Prefetch-Control", "off");

    if (config.secureCookies) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }

    next();
  };
}
