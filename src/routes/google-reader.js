import express from "express";
import { verifyPassword } from "../lib/security.js";
import { route } from "../lib/routes.js";

const READING_LIST_STATE = "user/-/state/com.google/reading-list";
const READ_STATE = "user/-/state/com.google/read";
const STARRED_STATE = "user/-/state/com.google/starred";
const LABEL_PREFIX = "user/-/label/";
const READER_ITEM_PREFIX = "tag:z7rss.com,2026:reader/item/";

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    isAdmin: Boolean(user.is_admin),
    status: user.status
  };
}

function getRequestContext(req) {
  return {
    requestIp: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.headers["user-agent"] || ""
  };
}

function getParam(req, key, fallback = "") {
  if (req.body?.[key] !== undefined) return req.body[key];
  if (req.query?.[key] !== undefined) return req.query[key];
  return fallback;
}

function getParamValues(req, key) {
  const value = getParam(req, key, undefined);
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map((entry) => String(entry || "").trim()).filter(Boolean);
}

function hasParam(req, key) {
  return req.body?.[key] !== undefined || req.query?.[key] !== undefined;
}

function parseLimit(value, fallback = 20, max = 250) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function parseOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function parseEpochToIso(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const millis = parsed > 1e12 ? parsed : parsed * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toUnixSeconds(value) {
  const date = new Date(value || 0);
  const millis = date.getTime();
  return Number.isFinite(millis) && millis > 0 ? Math.floor(millis / 1000) : 0;
}

function toUsec(value) {
  const date = new Date(value || 0);
  const millis = date.getTime();
  return String(Number.isFinite(millis) && millis > 0 ? millis * 1000 : 0);
}

function getItemSortTime(item) {
  const value = item?.published_at || item?.created_at || 0;
  const date = new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function getFeedStreamId(feedUrl) {
  return `feed/${String(feedUrl || "").trim()}`;
}

function getLabelStreamId(label) {
  return `${LABEL_PREFIX}${String(label || "").trim()}`;
}

function getReaderItemId(itemId) {
  return `${READER_ITEM_PREFIX}${Number(itemId || 0)}`;
}

function parseReaderItemId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const direct = Number(raw);
    return Number.isInteger(direct) && direct > 0 ? direct : null;
  }
  if (!raw.startsWith(READER_ITEM_PREFIX)) return null;
  const parsed = Number(raw.slice(READER_ITEM_PREFIX.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeBasicAuth(headerValue) {
  const header = String(headerValue || "").trim();
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex <= 0) return null;
    return {
      email: decoded.slice(0, separatorIndex).trim().toLowerCase(),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch (_error) {
    return null;
  }
}

function parseTokenFromAuthorization(headerValue) {
  const header = String(headerValue || "").trim();
  const googleMatch = header.match(/^GoogleLogin\s+auth=(.+)$/i);
  if (googleMatch) {
    return googleMatch[1].trim();
  }
  const bearerMatch = header.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }
  return null;
}

function normalizeCategory(value, fallback = null) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function getEffectiveFeedCategory(feed) {
  return normalizeCategory(feed?.category, normalizeCategory(feed?.auto_category, null));
}

function getFeedIndex(feeds) {
  return new Map((feeds || []).map((feed) => [Number(feed.feed_id), feed]));
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function toSubscription(feed) {
  const category = getEffectiveFeedCategory(feed);
  return {
    id: getFeedStreamId(feed.url),
    title: feed.title,
    categories: category ? [{ id: getLabelStreamId(category), label: category }] : [],
    sortid: String(Number(feed.feed_id || feed.id || 0)).padStart(8, "0"),
    firstitemmsec: String(Math.max(0, new Date(feed.last_fetched_at || 0).getTime() || 0)),
    url: feed.url,
    htmlUrl: feed.site_url || feed.url
  };
}

function toTagEntries(feeds) {
  const categories = uniqueStrings(feeds.map((feed) => getEffectiveFeedCategory(feed)));
  return [
    { id: READING_LIST_STATE, type: "state", sortid: "0" },
    { id: READ_STATE, type: "state", sortid: "1" },
    { id: STARRED_STATE, type: "state", sortid: "2" },
    ...categories.map((category, index) => ({
      id: getLabelStreamId(category),
      label: category,
      type: "folder",
      sortid: String(index + 10)
    }))
  ];
}

function extractLabelFromStreamId(streamId) {
  const value = String(streamId || "").trim();
  if (!value.startsWith(LABEL_PREFIX)) return null;
  return normalizeCategory(value.slice(LABEL_PREFIX.length), null);
}

function getQueryFromStreamId(feeds, streamId) {
  const value = String(streamId || READING_LIST_STATE).trim();
  if (!value || value === READING_LIST_STATE) {
    return { feedIds: null, readState: null, favoritesOnly: false };
  }
  if (value === STARRED_STATE) {
    return { feedIds: null, readState: null, favoritesOnly: true };
  }
  if (value === READ_STATE) {
    return { feedIds: null, readState: 1, favoritesOnly: false };
  }
  if (value.startsWith("feed/")) {
    const feed = (feeds || []).find((entry) => getFeedStreamId(entry.url) === value);
    return { feedIds: feed ? [Number(feed.feed_id)] : [], readState: null, favoritesOnly: false };
  }
  const category = extractLabelFromStreamId(value);
  if (!category) {
    return { feedIds: null, readState: null, favoritesOnly: false };
  }
  return {
    feedIds: (feeds || [])
      .filter((feed) => getEffectiveFeedCategory(feed) === category)
      .map((feed) => Number(feed.feed_id))
      .filter((feedId) => Number.isInteger(feedId) && feedId > 0),
    readState: null,
    favoritesOnly: false
  };
}

function applyStateFilters(query, req) {
  const next = { ...query };
  const includeTags = getParamValues(req, "it");
  const excludeTags = getParamValues(req, "xt");

  if (includeTags.includes(STARRED_STATE)) {
    next.favoritesOnly = true;
  }
  if (includeTags.includes(READ_STATE)) {
    next.readState = 1;
  }
  if (excludeTags.includes(READ_STATE)) {
    next.readState = 0;
  }
  if (excludeTags.includes(STARRED_STATE)) {
    next.excludeStarred = true;
  }

  const includeLabel = includeTags.map(extractLabelFromStreamId).find(Boolean);
  if (includeLabel) {
    next.feedIds = (next.feedIds || [])
      .concat(
        (req.readerFeeds || [])
          .filter((feed) => getEffectiveFeedCategory(feed) === includeLabel)
          .map((feed) => Number(feed.feed_id))
      )
      .filter((feedId) => Number.isInteger(feedId) && feedId > 0);
    next.feedIds = [...new Set(next.feedIds)];
  }

  return next;
}

function buildStoreQueryOptions(query, req) {
  return {
    favoritesOnly: Boolean(query.favoritesOnly),
    readState: query.readState === 0 || query.readState === 1 ? query.readState : null,
    publishedBefore: parseEpochToIso(getParam(req, "ot", "")) || null
  };
}

function listMatchingItemIds(store, userId, feeds, query, req) {
  const options = buildStoreQueryOptions(query, req);
  let ids = [];

  if (Array.isArray(query.feedIds)) {
    const records = [];
    for (const feedId of query.feedIds) {
      const currentIds = store.listUserItemIds(userId, feedId, options);
      for (const itemId of currentIds) {
        const item = store.getUserItem(userId, itemId);
        if (item) {
          records.push(item);
        }
      }
    }
    records.sort((left, right) => {
      const timeDiff = getItemSortTime(right) - getItemSortTime(left);
      if (timeDiff !== 0) return timeDiff;
      return Number(right.id || 0) - Number(left.id || 0);
    });
    ids = [...new Set(records.map((item) => Number(item.id)).filter((itemId) => Number.isInteger(itemId) && itemId > 0))];
  } else {
    ids = store.listUserItemIds(userId, null, options);
  }

  if (query.excludeStarred) {
    ids = ids.filter((itemId) => !store.getUserItem(userId, itemId)?.is_favorited);
  }

  return ids;
}

function buildItemCategories(item, feed) {
  const categories = [READING_LIST_STATE];
  if (item?.is_read) {
    categories.push(READ_STATE);
  }
  if (item?.is_favorited) {
    categories.push(STARRED_STATE);
  }
  if (feed?.url) {
    categories.push(getFeedStreamId(feed.url));
  }
  const label = getEffectiveFeedCategory(feed);
  if (label) {
    categories.push(getLabelStreamId(label));
  }
  return categories;
}

function toReaderItem(item, feedIndex) {
  const feed = feedIndex.get(Number(item.feed_id)) || null;
  const link = String(item.original_url || item.link || "").trim();
  const summaryHtml = String(item.summary || "").trim();
  const contentHtml = String(item.content_html || "").trim();
  const publishedAt = item.published_at || item.created_at || null;
  const updatedAt = item.updated_at || publishedAt || null;
  const result = {
    id: getReaderItemId(item.id),
    title: item.title || "",
    author: item.author || "",
    published: toUnixSeconds(publishedAt),
    updated: toUnixSeconds(updatedAt),
    crawlTimeMsec: String(Math.max(0, new Date(item.created_at || publishedAt || 0).getTime() || 0)),
    timestampUsec: toUsec(publishedAt),
    canonical: link ? [{ href: link }] : [],
    alternate: link ? [{ href: link, type: "text/html" }] : [],
    origin: {
      streamId: feed?.url ? getFeedStreamId(feed.url) : "",
      title: item.feed_title || feed?.title || "",
      htmlUrl: feed?.site_url || feed?.url || link || ""
    },
    categories: buildItemCategories(item, feed)
  };

  if (contentHtml) {
    result.content = {
      direction: "ltr",
      content: contentHtml
    };
  } else if (summaryHtml) {
    result.summary = {
      direction: "ltr",
      content: summaryHtml
    };
  }

  return result;
}

function sendPlain(res, status, body) {
  res.status(status).type("text/plain; charset=utf-8").send(body);
}

function ensureReaderAuth({ authService, store }) {
  return function readerAuthMiddleware(req, res, next) {
    if (req.auth?.user) {
      return next();
    }

    const token = parseTokenFromAuthorization(req.headers.authorization);
    if (token) {
      const auth = authService.getUserFromToken(token, {
        touch: true,
        ...getRequestContext(req)
      });
      if (auth?.user) {
        req.auth = auth;
        return next();
      }
    }

    const basicAuth = decodeBasicAuth(req.headers.authorization);
    if (basicAuth?.email && basicAuth.password) {
      const user = store.getUserByEmail(basicAuth.email);
      if (user && user.status === "active" && verifyPassword(basicAuth.password, user.password_hash)) {
        req.auth = {
          user: sanitizeUser(user),
          session: null
        };
        return next();
      }
    }

    return sendPlain(res, 401, "Unauthorized");
  };
}

export function createGoogleReaderRouter({ authService, feedService, itemService, store }) {
  const router = express.Router();

  router.use(express.urlencoded({ extended: false }));

  router.post("/accounts/ClientLogin", (req, res) => {
    const email = String(getParam(req, "Email", getParam(req, "email", "")) || "").trim().toLowerCase();
    const password = String(getParam(req, "Passwd", getParam(req, "password", "")) || "");

    try {
      const result = authService.login({ email, password }, getRequestContext(req));
      sendPlain(
        res,
        200,
        `SID=${result.session.token}\nLSID=${result.session.token}\nAuth=${result.session.token}\n`
      );
    } catch (_error) {
      sendPlain(res, 403, "Error=BadAuthentication\n");
    }
  });

  router.use((req, _res, next) => {
    if (req.path.startsWith("/reader/")) {
      return next();
    }
    return next("router");
  });

  router.use(ensureReaderAuth({ authService, store }));
  router.use((req, _res, next) => {
    req.readerFeeds = store.listUserFeeds(req.auth.user.id);
    req.readerFeedIndex = getFeedIndex(req.readerFeeds);
    next();
  });

  router.get("/reader/api/0/token", (req, res) => {
    sendPlain(res, 200, `${req.auth?.session?.token || "reader-basic-auth"}\n`);
  });

  router.get("/reader/api/0/user-info", (req, res) => {
    res.json({
      userId: String(req.auth.user.id),
      userName: req.auth.user.displayName || req.auth.user.email,
      userEmail: req.auth.user.email,
      userProfileId: String(req.auth.user.id),
      isBloggerUser: false
    });
  });

  router.get("/reader/api/0/preference/list", (_req, res) => {
    res.json({ prefs: [] });
  });

  router.get("/reader/api/0/tag/list", (req, res) => {
    res.json({
      tags: toTagEntries(req.readerFeeds)
    });
  });

  router.get("/reader/api/0/subscription/list", (req, res) => {
    res.json({
      subscriptions: req.readerFeeds.map((feed) => toSubscription(feed))
    });
  });

  router.get("/reader/api/0/unread-count", (req, res) => {
    const counts = [];
    let max = 0;
    let totalUnread = 0;
    const byCategory = new Map();

    for (const feed of req.readerFeeds) {
      const unread = Number(feed.unread_count || 0);
      totalUnread += unread;
      max = Math.max(max, unread);
      counts.push({
        id: getFeedStreamId(feed.url),
        count: unread
      });

      const category = getEffectiveFeedCategory(feed);
      if (category) {
        byCategory.set(category, Number(byCategory.get(category) || 0) + unread);
      }
    }

    max = Math.max(max, totalUnread);
    counts.unshift({
      id: READING_LIST_STATE,
      count: totalUnread
    });

    for (const [category, count] of byCategory.entries()) {
      max = Math.max(max, count);
      counts.push({
        id: getLabelStreamId(category),
        count
      });
    }

    res.json({
      max,
      unreadcounts: counts
    });
  });

  router.get("/reader/api/0/stream/items/ids", (req, res) => {
    const streamId = String(getParam(req, "s", READING_LIST_STATE) || READING_LIST_STATE).trim();
    const baseQuery = getQueryFromStreamId(req.readerFeeds, streamId);
    const query = applyStateFilters(baseQuery, req);
    const limit = parseLimit(getParam(req, "n", 20), 20);
    const offset = parseOffset(getParam(req, "c", 0));
    const ids = listMatchingItemIds(store, req.auth.user.id, req.readerFeeds, query, req);
    const pageIds = ids.slice(offset, offset + limit);

    res.json({
      itemRefs: pageIds.map((itemId) => {
        const item = store.getUserItem(req.auth.user.id, itemId);
        return {
          id: getReaderItemId(itemId),
          timestampUsec: toUsec(item?.published_at || item?.created_at || null)
        };
      }),
      continuation: offset + limit < ids.length ? String(offset + limit) : undefined
    });
  });

  function sendItemContents(req, res) {
    const itemIds = getParamValues(req, "i").map(parseReaderItemId).filter((itemId) => Number.isInteger(itemId) && itemId > 0);
    const items = itemIds
      .map((itemId) => store.getUserItem(req.auth.user.id, itemId))
      .filter(Boolean)
      .map((item) => toReaderItem(item, req.readerFeedIndex));
    res.json({ items });
  }

  router.get("/reader/api/0/stream/items/contents", sendItemContents);
  router.post("/reader/api/0/stream/items/contents", sendItemContents);

  router.get(/^\/reader\/api\/0\/stream\/contents\/(.+)$/, (req, res) => {
    const streamId = String(req.params[0] || READING_LIST_STATE).trim();
    const baseQuery = getQueryFromStreamId(req.readerFeeds, streamId);
    const query = applyStateFilters(baseQuery, req);
    const limit = parseLimit(getParam(req, "n", 20), 20);
    const offset = parseOffset(getParam(req, "c", 0));
    const ids = listMatchingItemIds(store, req.auth.user.id, req.readerFeeds, query, req);
    const pageItems = ids
      .slice(offset, offset + limit)
      .map((itemId) => store.getUserItem(req.auth.user.id, itemId))
      .filter(Boolean)
      .map((item) => toReaderItem(item, req.readerFeedIndex));

    res.json({
      direction: "ltr",
      id: streamId,
      title: streamId,
      updated: Math.floor(Date.now() / 1000),
      items: pageItems,
      continuation: offset + limit < ids.length ? String(offset + limit) : undefined
    });
  });

  router.post("/reader/api/0/edit-tag", route(async (req, res) => {
    const user = req.auth.user;
    const itemIds = getParamValues(req, "i").map(parseReaderItemId).filter((itemId) => Number.isInteger(itemId) && itemId > 0);
    const addTags = getParamValues(req, "a");
    const removeTags = getParamValues(req, "r");

    for (const itemId of itemIds) {
      if (addTags.includes(STARRED_STATE)) {
        await itemService.setFavoriteState(user.id, itemId, true);
      }
      if (removeTags.includes(STARRED_STATE)) {
        await itemService.setFavoriteState(user.id, itemId, false);
      }
      if (addTags.includes(READ_STATE)) {
        await itemService.setReadState(user.id, itemId, true);
      }
      if (removeTags.includes(READ_STATE)) {
        await itemService.setReadState(user.id, itemId, false);
      }
    }

    sendPlain(res, 200, "OK");
  }));

  router.post("/reader/api/0/subscription/quickadd", route(async (req, res) => {
    const quickadd = String(getParam(req, "quickadd", "") || "").trim();
    const result = await feedService.addFeed(req.auth.user.id, {
      title: "",
      url: quickadd
    });
    res.json({
      query: quickadd,
      numResults: result?.feed ? 1 : 0,
      streamId: result?.feed?.url ? getFeedStreamId(result.feed.url) : ""
    });
  }));

  router.post("/reader/api/0/subscription/edit", route(async (req, res) => {
    const userId = req.auth.user.id;
    const action = String(getParam(req, "ac", "") || "").trim().toLowerCase();
    const streamId = String(getParam(req, "s", "") || "").trim();
    const customTitle = String(getParam(req, "t", getParam(req, "title", "")) || "").trim();
    const addTags = getParamValues(req, "a");
    const removeTags = getParamValues(req, "r");
    const labelsToAdd = addTags.map(extractLabelFromStreamId).filter(Boolean);
    const labelsToRemove = removeTags.map(extractLabelFromStreamId).filter(Boolean);
    const currentFeed = req.readerFeeds.find((feed) => getFeedStreamId(feed.url) === streamId) || null;

    if (action === "subscribe") {
      const feedUrl = streamId.startsWith("feed/") ? streamId.slice(5) : streamId;
      const result = await feedService.addFeed(userId, {
        title: customTitle,
        url: feedUrl
      });
      if (result?.feed?.feed_id && labelsToAdd.length) {
        await feedService.updateFeedPreferencesForUser(userId, Number(result.feed.feed_id), {
          category: labelsToAdd[0]
        });
      }
      sendPlain(res, 200, "OK");
      return;
    }

    if (!currentFeed) {
      sendPlain(res, 200, "OK");
      return;
    }

    if (action === "unsubscribe") {
      feedService.removeFeed(userId, Number(currentFeed.feed_id));
      sendPlain(res, 200, "OK");
      return;
    }

    const nextCategory = labelsToAdd.length
      ? labelsToAdd[0]
      : labelsToRemove.includes(getEffectiveFeedCategory(currentFeed))
        ? null
        : getEffectiveFeedCategory(currentFeed);

    const payload = {
      category: nextCategory
    };
    if (hasParam(req, "t") || hasParam(req, "title")) {
      payload.title = customTitle;
    }

    await feedService.updateFeedPreferencesForUser(userId, Number(currentFeed.feed_id), payload);

    sendPlain(res, 200, "OK");
  }));

  return router;
}
