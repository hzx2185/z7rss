export function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const index = entry.indexOf("=");
      if (index === -1) return acc;
      const key = decodeURIComponent(entry.slice(0, index));
      const value = decodeURIComponent(entry.slice(index + 1));
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
