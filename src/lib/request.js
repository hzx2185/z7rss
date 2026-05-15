export function normalizeIp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("::ffff:")) {
    return raw.slice("::ffff:".length);
  }

  return raw;
}

export function getRequestIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || "");
}

export function getForwardedHeaderValue(req, name) {
  const raw = req.get?.(name) || req.headers?.[String(name || "").toLowerCase()] || "";
  return String(raw || "").split(",")[0].trim();
}

export function getRequestProtocol(req) {
  const forwardedProto = getForwardedHeaderValue(req, "x-forwarded-proto").toLowerCase();
  if (forwardedProto === "https" || forwardedProto === "http") return forwardedProto;
  return req.protocol || (req.secure ? "https" : "http");
}

export function isSecureRequest(req) {
  return getRequestProtocol(req) === "https";
}
