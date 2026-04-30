import { XMLParser } from "fast-xml-parser";
import { badRequest } from "../lib/errors.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

function escapeXmlAttribute(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeImportUrl(candidate) {
  const value = String(candidate || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function collectOpmlOutlines(node, items = []) {
  if (!node) return items;
  const outlines = Array.isArray(node) ? node : [node];
  for (const entry of outlines) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.xmlUrl) {
      items.push({
        url: String(entry.xmlUrl || "").trim(),
        title: String(entry.title || entry.text || "").trim()
      });
    }
    if (entry.outline) {
      collectOpmlOutlines(entry.outline, items);
    }
  }
  return items;
}

export function parseImportPayload(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw badRequest("请先输入订阅源内容", { code: "import_content_required" });
  }

  if (raw.startsWith("<")) {
    try {
      const parsed = xmlParser.parse(raw);
      const outlines = collectOpmlOutlines(parsed?.opml?.body?.outline);
      if (!outlines.length) {
        throw badRequest("未在 OPML 中找到可导入的订阅源", { code: "import_opml_empty" });
      }
      return outlines;
    } catch (error) {
      if (/未在 OPML/.test(error.message)) throw error;
      throw badRequest("OPML/XML 解析失败", { code: "import_opml_invalid" });
    }
  }

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw badRequest("JSON 导入内容必须是数组", { code: "import_json_invalid_type" });
      }
      return parsed.map((entry) => {
        if (typeof entry === "string") {
          return { url: entry, title: "" };
        }
        return {
          url: String(entry.url || entry.xmlUrl || "").trim(),
          title: String(entry.title || entry.text || entry.name || "").trim()
        };
      });
    } catch (error) {
      if (/JSON 导入内容必须是数组/.test(error.message)) throw error;
      throw badRequest("JSON 导入内容解析失败", { code: "import_json_invalid" });
    }
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(/[,\t]/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (parts.length >= 2 && normalizeImportUrl(parts[parts.length - 1])) {
        return {
          title: parts.slice(0, -1).join(" "),
          url: parts[parts.length - 1]
        };
      }
      return { title: "", url: line };
    });
}

export function buildOpml(feeds, ownerName = "Z7 RSS User") {
  const escapedOwner = escapeXmlAttribute(ownerName || "Z7 RSS User");
  const outlines = feeds
    .map((feed) => {
      const title = escapeXmlAttribute(feed.title || "");
      const url = escapeXmlAttribute(feed.url || "");
      const htmlUrl = escapeXmlAttribute(feed.site_url || "");
      return `    <outline text="${title}" title="${title}" type="rss" xmlUrl="${url}" htmlUrl="${htmlUrl}" />`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Z7 RSS Export</title>\n    <ownerName>${escapedOwner}</ownerName>\n  </head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`;
}
