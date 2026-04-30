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
