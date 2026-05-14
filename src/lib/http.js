function decodeCookiePart(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return String(value || "");
  }
}

export function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const index = entry.indexOf("=");
      if (index === -1) return acc;
      const key = decodeCookiePart(entry.slice(0, index));
      const value = decodeCookiePart(entry.slice(index + 1));
      if (!key) return acc;
      acc[key] = value;
      return acc;
    }, {});
}

function buildSessionCookie(name, value, maxAgeSeconds, options = {}) {
  const sameSite = options.sameSite || "Lax";
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function setSessionCookie(res, name, value, maxAgeSeconds, options = {}) {
  res.setHeader(
    "Set-Cookie",
    buildSessionCookie(name, value, maxAgeSeconds, options)
  );
}

export function clearSessionCookie(res, name, options = {}) {
  res.setHeader("Set-Cookie", buildSessionCookie(name, "", 0, options));
}

export function describeFetchError(error) {
  const code = String(error?.cause?.code || error?.code || "").trim().toUpperCase();
  if (code === "ENOTFOUND") return "域名无法解析";
  if (code === "ECONNREFUSED") return "连接被拒绝";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "连接超时";
  return String(error?.message || "连接失败").trim();
}

export function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}
