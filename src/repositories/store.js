import { createStoreStatements } from "./store-statements.js";
import { assertSqliteHealthy, checkSqliteFile } from "../lib/sqlite-health.js";

const databaseTables = [
  "users",
  "sessions",
  "feeds",
  "user_feeds",
  "items",
  "user_item_states",
  "pruned_guids",
  "audit_logs",
  "refresh_runs",
  "digest_rules",
  "digest_runs",
  "billing_events"
];

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeItemLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("utm_") ||
        lower === "fbclid" ||
        lower === "gclid" ||
        lower === "yclid" ||
        lower === "mc_cid" ||
        lower === "mc_eid"
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/#.*$/, "").trim();
  }
}

export function createStore(db) {
  let isClosed = false;
  const {
    createUserStmt,
    getUserByEmailStmt,
    getUserByIdStmt,
    getFirstUserStmt,
    countAdminsStmt,
    countUsersStmt,
    updateUserAdminStmt,
    updateUserStatusStmt,
    updateUserPasswordStmt,
    deleteUserStmt,
    getUserSettingStmt,
    listUserSettingsStmt,
    listUserSettingsByCategoryStmt,
    upsertUserSettingStmt,
    listUsersStmt,
    createSessionStmt,
    getSessionStmt,
    listUserSessionsStmt,
    updateSessionActivityStmt,
    deleteSessionStmt,
    deleteUserSessionsStmt,
    deleteOtherUserSessionsStmt,
    deleteExpiredSessionsStmt,
    getPlanByCodeStmt,
    getPlanByIdStmt,
    updatePlanSettingsStmt,
    listPlansStmt,
    getUserSubscriptionStmt,
    getUserSubscriptionByProviderSubscriptionIdStmt,
    getUserSubscriptionByProviderCustomerIdStmt,
    upsertSubscriptionStmt,
    createBillingEventStmt,
    listBillingEventsStmt,
    listAllBillingEventsStmt,
    getBillingEventByCheckoutIdStmt,
    updateBillingEventStatusStmt,
    getSettingStmt,
    listSettingsStmt,
    upsertSettingStmt,
    listRedeemCodesStmt,
    getRedeemCodeStmt,
    createRedeemCodeStmt,
    recordRedeemUseStmt,
    incrementRedeemCountStmt,
    updateRedeemCodeStmt,
    listPluginsStmt,
    upsertPluginStmt,
    listContentRulesStmt,
    createContentRuleStmt,
    updateContentRuleStmt,
    listBlockedSitesStmt,
    upsertBlockedSiteStmt,
    listBlockedIpsStmt,
    upsertBlockedIpStmt,
    createAuditLogStmt,
    getAuditLogByIdStmt,
    listAuditLogsStmt,
    pruneAuditLogsOlderThanStmt,
    pruneAuditLogsOverflowStmt,
    createRefreshRunStmt,
    updateRefreshRunStmt,
    interruptRunningRefreshRunsStmt,
    getRefreshRunByIdStmt,
    getLatestRefreshRunStmt,
    listRefreshRunsStmt,
    pruneRefreshRunsOlderThanStmt,
    pruneRefreshRunsOverflowStmt,
    getFeedByIdStmt,
    getFeedByUrlStmt,
    createFeedStmt,
    updateFeedMetaStmt,
    touchFeedFetchedStmt,
    updateFeedAutoCategoryStmt,
    updateFeedErrorStmt,
    linkUserFeedStmt,
    listUserFeedsStmt,
    countUserFeedsStmt,
    countUserFavoritesStmt,
    getUserFeedStmt,
    unlinkUserFeedStmt,
    updateUserFeedCustomTitleStmt,
    listGlobalFeedsStmt,
    listRefreshableFeedsStmt,
    listAdminFeedsStmt,
    listPublicFeedsStmt,
    listUserItemsStmt,
    listUserItemsFastStmt,
    countUserItemsStmt,
    countUserItemBucketsStmt,
    getUserItemStatsStmt,
    upsertUserItemStatsStmt,
    markUserItemStatsDirtyStmt,
    markFeedSubscribersItemStatsDirtyStmt,
    listUserItemIdsStmt,
    listAdminItemsStmt,
    getUserItemStmt,
    upsertItemStmt,
    updateItemByIdFromFeedEntryStmt,
    updateItemContentStmt,
    updateItemPageContentStmt,
    updateTranslationStmt,
    updateSummaryStmt,
    updateUserFeedPreferencesStmt,
    upsertUserFeedTranslationStmt,
    upsertUserItemReadStateStmt,
    upsertUserItemReadStateBulkTx,
    upsertUserItemFavoriteStateStmt,
    upsertUserItemTranslationStmt,
    clearItemTranslationsStmt,
    getFeedRetentionLimitStmt,
    deleteFeedItemsStmt,
    deleteOrphanFeedsStmt,
    deleteOrphanUserItemStatesStmt,
    deleteOrphanItemsStmt,
    deleteOrphanUserFeedsStmt,
    deleteOrphanSessionsStmt,
    deleteOrphanUserSettingsStmt,
    deleteOrphanSubscriptionsStmt,
    deleteOrphanBillingEventsStmt,
    deleteOrphanRedeemCodeUsesStmt,
    deleteOrphanDigestRulesStmt,
    deleteOrphanDigestRunsStmt,
    nullMissingAuditActorsStmt,
    nullMissingRefreshActorsStmt,
    pruneFeedItemsStmt,
    addPrunedGuidStmt,
    checkPrunedGuidStmt,
    pruneExpiredGuidsStmt,
    deleteItemByIdStmt,
    listDigestRulesByUserStmt,
    getDigestRuleByIdStmt,
    countDigestRulesByUserStmt,
    createDigestRuleStmt,
    updateDigestRuleStmt,
    deleteDigestRuleStmt,
    markDigestRuleSentStmt,
    listEnabledDigestRulesStmt,
    createDigestRunStmt,
    updateDigestRunStmt,
    getDigestRunByIdStmt,
    listDigestRunsByUserStmt
  } = createStoreStatements(db);

  function normalizeCountBuckets(row = {}) {
    return {
      all: Number(row.all_count || 0),
      today: Number(row.today_count || 0),
      favorite: Number(row.favorite_count || 0),
      unread: Number(row.unread_count || 0)
    };
  }

  function rebuildUserItemStats(userId, todaySince = null) {
    const row = countUserItemBucketsStmt.get({
      userId,
      todaySince: todaySince || null
    }) || {};
    upsertUserItemStatsStmt.run({
      userId,
      allCount: Number(row.all_count || 0),
      todaySince: todaySince || null,
      todayCount: Number(row.today_count || 0),
      favoriteCount: Number(row.favorite_count || 0),
      unreadCount: Number(row.unread_count || 0)
    });
    return normalizeCountBuckets(row);
  }

  function markUserItemStatsDirty(userId) {
    markUserItemStatsDirtyStmt.run(userId);
  }

  function markFeedSubscribersItemStatsDirty(feedId) {
    markFeedSubscribersItemStatsDirtyStmt.run(feedId);
  }

  function getReusableUserItemStats(userId) {
    const stats = getUserItemStatsStmt.get(userId);
    return stats && Number(stats.dirty || 0) === 0 ? stats : null;
  }

  function getUserItemStatsForSimpleCounts(userId) {
    return normalizeCountBuckets(getReusableUserItemStats(userId) || rebuildUserItemStats(userId, null));
  }

  function optimizeDb() {
    db.pragma("optimize");
    db.pragma("wal_checkpoint(TRUNCATE)");
  }

  function assertDatabaseHealthyForVacuum() {
    const result = String(db.pragma("quick_check", { simple: true }) || "");
    if (result.toLowerCase() !== "ok") {
      const error = new Error(`Database quick_check failed before VACUUM: ${result || "unknown error"}`);
      error.code = "database_quick_check_failed";
      throw error;
    }
  }

  function closeDb() {
    if (isClosed) return;
    try {
      optimizeDb();
    } catch (_error) {
      // Best effort only. We still want to close the handle on shutdown.
    }
    db.close();
    isClosed = true;
  }

  const pruneItemsWithGuidTombstonesTx = db.transaction((feedId, items) => {
    let deleted = 0;
    for (const item of items) {
      addPrunedGuidStmt.run({ feedId, guid: item.guid });
      deleted += deleteItemByIdStmt.run(item.id).changes;
    }
    return deleted;
  });

  function pruneItemsWithGuidTombstones(feedId, items) {
    const candidates = Array.isArray(items)
      ? items.filter((item) => item && Number.isInteger(Number(item.id)) && String(item.guid || "").trim())
      : [];
    if (!candidates.length) return 0;
    return pruneItemsWithGuidTombstonesTx(feedId, candidates);
  }

  function getOrphanMetrics() {
    const count = (sql) => Number(db.prepare(sql).get()?.count || 0);
    const foreignKeyViolations = db.pragma("foreign_key_check");
    return {
      sessions: count(`
        SELECT COUNT(*) AS count FROM sessions
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sessions.user_id)
      `),
      userSettings: count(`
        SELECT COUNT(*) AS count FROM user_settings
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_settings.user_id)
      `),
      subscriptions: count(`
        SELECT COUNT(*) AS count FROM subscriptions
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = subscriptions.user_id)
          OR NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = subscriptions.plan_id)
      `),
      billingEvents: count(`
        SELECT COUNT(*) AS count FROM billing_events
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = billing_events.user_id)
          OR NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = billing_events.plan_id)
      `),
      redeemCodeUses: count(`
        SELECT COUNT(*) AS count FROM redeem_code_uses
        WHERE NOT EXISTS (SELECT 1 FROM redeem_codes rc WHERE rc.id = redeem_code_uses.redeem_code_id)
          OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = redeem_code_uses.user_id)
      `),
      userFeeds: count(`
        SELECT COUNT(*) AS count FROM user_feeds
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_feeds.user_id)
          OR NOT EXISTS (SELECT 1 FROM feeds f WHERE f.id = user_feeds.feed_id)
      `),
      feedsWithoutSubscribers: count(`
        SELECT COUNT(*) AS count FROM feeds
        WHERE NOT EXISTS (SELECT 1 FROM user_feeds uf WHERE uf.feed_id = feeds.id)
      `),
      items: count(`
        SELECT COUNT(*) AS count FROM items
        WHERE NOT EXISTS (SELECT 1 FROM feeds f WHERE f.id = items.feed_id)
      `),
      userItemStates: count(`
        SELECT COUNT(*) AS count FROM user_item_states
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_item_states.user_id)
          OR NOT EXISTS (SELECT 1 FROM items i WHERE i.id = user_item_states.item_id)
      `),
      digestRules: count(`
        SELECT COUNT(*) AS count FROM digest_rules
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = digest_rules.user_id)
      `),
      digestRuns: count(`
        SELECT COUNT(*) AS count FROM digest_runs
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = digest_runs.user_id)
          OR NOT EXISTS (SELECT 1 FROM digest_rules dr WHERE dr.id = digest_runs.rule_id)
      `),
      auditActors: count(`
        SELECT COUNT(*) AS count FROM audit_logs
        WHERE actor_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.actor_user_id)
      `),
      refreshActors: count(`
        SELECT COUNT(*) AS count FROM refresh_runs
        WHERE actor_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_runs.actor_user_id)
      `),
      foreignKeyViolations: foreignKeyViolations.length
    };
  }

  function totalOrphanCount(metrics) {
    return Object.values(metrics || {}).reduce((total, value) => total + Number(value || 0), 0);
  }

  const cleanupOrphansTx = db.transaction(() => {
    const result = {
      sessionsDeleted: deleteOrphanSessionsStmt.run().changes,
      userSettingsDeleted: deleteOrphanUserSettingsStmt.run().changes,
      subscriptionsDeleted: deleteOrphanSubscriptionsStmt.run().changes,
      billingEventsDeleted: deleteOrphanBillingEventsStmt.run().changes,
      redeemCodeUsesDeleted: deleteOrphanRedeemCodeUsesStmt.run().changes,
      userItemStatesDeleted: deleteOrphanUserItemStatesStmt.run().changes,
      userFeedsDeleted: deleteOrphanUserFeedsStmt.run().changes,
      orphanFeedsDeleted: deleteOrphanFeedsStmt.run().changes,
      itemsDeleted: deleteOrphanItemsStmt.run().changes,
      userItemStatesDeletedAfterItems: deleteOrphanUserItemStatesStmt.run().changes,
      digestRunsDeleted: deleteOrphanDigestRunsStmt.run().changes,
      digestRulesDeleted: deleteOrphanDigestRulesStmt.run().changes,
      digestRunsDeletedAfterRules: deleteOrphanDigestRunsStmt.run().changes,
      auditActorsCleared: nullMissingAuditActorsStmt.run().changes,
      refreshActorsCleared: nullMissingRefreshActorsStmt.run().changes
    };
    result.totalDeleted =
      result.sessionsDeleted +
      result.userSettingsDeleted +
      result.subscriptionsDeleted +
      result.billingEventsDeleted +
      result.redeemCodeUsesDeleted +
      result.userItemStatesDeleted +
      result.userFeedsDeleted +
      result.orphanFeedsDeleted +
      result.itemsDeleted +
      result.userItemStatesDeletedAfterItems +
      result.digestRunsDeleted +
      result.digestRulesDeleted +
      result.digestRunsDeletedAfterRules;
    result.totalChanged = result.totalDeleted + result.auditActorsCleared + result.refreshActorsCleared;
    return result;
  });

  return {
    createUser(user) {
      const result = createUserStmt.run(user);
      return getUserByIdStmt.get(result.lastInsertRowid);
    },
    getUserByEmail(email) {
      return getUserByEmailStmt.get(email);
    },
    getUserById(id) {
      return getUserByIdStmt.get(id);
    },
    getFirstUser() {
      return getFirstUserStmt.get();
    },
    countAdmins() {
      return countAdminsStmt.get().count;
    },
    countUsers() {
      return countUsersStmt.get().count;
    },
    setUserAdmin(id, isAdmin, status = null) {
      updateUserAdminStmt.run(isAdmin ? 1 : 0, status, id);
      return this.getUserById(id);
    },
    setUserStatus(id, status) {
      updateUserStatusStmt.run(status, id);
      return this.getUserById(id);
    },
    setUserPassword(id, passwordHash) {
      updateUserPasswordStmt.run(passwordHash, id);
      return this.getUserById(id);
    },
    deleteUser(id) {
      return deleteUserStmt.run(id).changes;
    },
    listUsers() {
      return listUsersStmt.all();
    },
    getUserSetting(userId, category, key) {
      return getUserSettingStmt.get(userId, category, key);
    },
    listUserSettings(userId) {
      return listUserSettingsStmt.all(userId);
    },
    listUserSettingsByCategory(userId, category) {
      return listUserSettingsByCategoryStmt.all(userId, category);
    },
    setUserSetting(userId, category, key, value) {
      upsertUserSettingStmt.run({ userId, category, key, value });
      return this.getUserSetting(userId, category, key);
    },
    createSession(token, userId, expiresAt, metadata = {}) {
      createSessionStmt.run({
        token,
        userId,
        expiresAt,
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
        lastSeenAt: metadata.lastSeenAt ?? new Date().toISOString()
      });
      return getSessionStmt.get(token);
    },
    getSession(token) {
      deleteExpiredSessionsStmt.run();
      return getSessionStmt.get(token);
    },
    listUserSessions(userId) {
      deleteExpiredSessionsStmt.run();
      return listUserSessionsStmt.all(userId);
    },
    updateSessionActivity(token, metadata = {}) {
      updateSessionActivityStmt.run({
        token,
        lastSeenAt: metadata.lastSeenAt ?? new Date().toISOString(),
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });
      return this.getSession(token);
    },
    deleteExpiredSessions() {
      return deleteExpiredSessionsStmt.run().changes;
    },
    deleteSession(token) {
      deleteSessionStmt.run(token);
    },
    deleteUserSessions(userId) {
      deleteUserSessionsStmt.run(userId);
    },
    deleteOtherUserSessions(userId, currentToken) {
      deleteOtherUserSessionsStmt.run(userId, currentToken);
    },
    listPlans() {
      return listPlansStmt.all();
    },
    getPlanByCode(code) {
      return getPlanByCodeStmt.get(code);
    },
    getPlanById(id) {
      return getPlanByIdStmt.get(id);
    },
    updatePlanSettings(code, settings) {
      updatePlanSettingsStmt.run({
        code,
        maxFeeds: settings?.maxFeeds ?? null,
        maxSavedItems: settings?.maxSavedItems ?? null,
        maxFavoriteItems: settings?.maxFavoriteItems ?? null,
        aiTranslationEnabled: settings?.aiTranslationEnabled ?? null,
        aiSummaryEnabled: settings?.aiSummaryEnabled ?? null,
        customAiEnabled: settings?.customAiEnabled ?? null,
        aiDigestEnabled: settings?.aiDigestEnabled ?? null,
        emailDigestEnabled: settings?.emailDigestEnabled ?? null,
        maxDigestRules: settings?.maxDigestRules ?? null
      });
      return this.getPlanByCode(code);
    },
    getUserSubscription(userId) {
      return getUserSubscriptionStmt.get(userId);
    },
    getUserSubscriptionByProviderSubscriptionId(providerSubscriptionId) {
      return getUserSubscriptionByProviderSubscriptionIdStmt.get(providerSubscriptionId);
    },
    getUserSubscriptionByProviderCustomerId(providerCustomerId) {
      return getUserSubscriptionByProviderCustomerIdStmt.get(providerCustomerId);
    },
    setUserSubscription(subscription) {
      upsertSubscriptionStmt.run(subscription);
      return this.getUserSubscription(subscription.userId);
    },
    createBillingEvent(event) {
      createBillingEventStmt.run(event);
    },
    listBillingEvents(userId) {
      return listBillingEventsStmt.all(userId);
    },
    listAllBillingEvents() {
      return listAllBillingEventsStmt.all();
    },
    getBillingEventByCheckoutId(providerCheckoutId) {
      return getBillingEventByCheckoutIdStmt.get(providerCheckoutId);
    },
    updateBillingEventStatus(providerCheckoutId, status, checkoutUrl = null) {
      updateBillingEventStatusStmt.run({ providerCheckoutId, status, checkoutUrl });
    },
    getSetting(category, key) {
      return getSettingStmt.get(category, key);
    },
    listSettings() {
      return listSettingsStmt.all();
    },
    setSetting(category, key, value) {
      upsertSettingStmt.run({ category, key, value });
      return this.getSetting(category, key);
    },
    listRedeemCodes() {
      return listRedeemCodesStmt.all();
    },
    getRedeemCode(code) {
      return getRedeemCodeStmt.get(code);
    },
    createRedeemCode(codeData) {
      createRedeemCodeStmt.run(codeData);
      return this.getRedeemCode(codeData.code);
    },
    useRedeemCode(redeemCodeId, userId) {
      const tx = db.transaction(() => {
        recordRedeemUseStmt.run(redeemCodeId, userId);
        incrementRedeemCountStmt.run(redeemCodeId);
      });
      tx();
    },
    updateRedeemCode(payload) {
      updateRedeemCodeStmt.run(payload);
    },
    listPlugins() {
      return listPluginsStmt.all();
    },
    upsertPlugin(plugin) {
      upsertPluginStmt.run(plugin);
      return listPluginsStmt.all().find((entry) => entry.code === plugin.code);
    },
    listContentRules() {
      return listContentRulesStmt.all();
    },
    createContentRule(rule) {
      const result = createContentRuleStmt.run(rule);
      return listContentRulesStmt.all().find((entry) => entry.id === result.lastInsertRowid);
    },
    setContentRuleActive(id, isActive) {
      updateContentRuleStmt.run(isActive ? 1 : 0, id);
    },
    listBlockedSites() {
      return listBlockedSitesStmt.all();
    },
    setBlockedSite(site) {
      upsertBlockedSiteStmt.run(site);
    },
    listBlockedIps() {
      return listBlockedIpsStmt.all();
    },
    setBlockedIp(blockedIp) {
      upsertBlockedIpStmt.run(blockedIp);
    },
    createAuditLog(entry) {
      const result = createAuditLogStmt.run({
        actorUserId: entry.actorUserId ?? null,
        actorEmail: entry.actorEmail ?? "",
        actorDisplayName: entry.actorDisplayName ?? "",
        actorIp: entry.actorIp ?? "",
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        summary: entry.summary,
        detailsJson: entry.detailsJson ?? "{}"
      });
      return getAuditLogByIdStmt.get(result.lastInsertRowid);
    },
    listAuditLogs(limit = 100) {
      const normalizedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      return listAuditLogsStmt.all(normalizedLimit);
    },
    pruneAuditLogs({ retentionDays = 30, maxEntries = 5000 } = {}) {
      let removed = 0;
      const normalizedRetentionDays = Math.max(0, Math.floor(Number(retentionDays) || 0));
      const normalizedMaxEntries = Math.max(0, Math.floor(Number(maxEntries) || 0));
      if (normalizedRetentionDays > 0) {
        removed += pruneAuditLogsOlderThanStmt.run({
          offset: `-${normalizedRetentionDays} days`
        }).changes;
      }
      if (normalizedMaxEntries > 0) {
        removed += pruneAuditLogsOverflowStmt.run({
          keepCount: normalizedMaxEntries
        }).changes;
      }
      return removed;
    },
    createRefreshRun(entry) {
      const result = createRefreshRunStmt.run({
        trigger: entry.trigger,
        status: entry.status,
        totalFeeds: entry.totalFeeds ?? 0,
        succeededCount: entry.succeededCount ?? 0,
        failedCount: entry.failedCount ?? 0,
        actorUserId: entry.actorUserId ?? null,
        actorEmail: entry.actorEmail ?? "",
        actorDisplayName: entry.actorDisplayName ?? "",
        startedAt: entry.startedAt ?? new Date().toISOString(),
        finishedAt: entry.finishedAt ?? null,
        durationMs: entry.durationMs ?? null,
        errorSummary: entry.errorSummary ?? null,
        detailsJson: entry.detailsJson ?? "{}"
      });
      return getRefreshRunByIdStmt.get(result.lastInsertRowid);
    },
    updateRefreshRun(entry) {
      updateRefreshRunStmt.run({
        id: entry.id,
        status: entry.status ?? null,
        totalFeeds: entry.totalFeeds ?? null,
        succeededCount: entry.succeededCount ?? null,
        failedCount: entry.failedCount ?? null,
        finishedAt: entry.finishedAt ?? null,
        durationMs: entry.durationMs ?? null,
        errorSummary: entry.errorSummary ?? null,
        detailsJson: entry.detailsJson ?? null
      });
      return this.getRefreshRunById(entry.id);
    },
    interruptRunningRefreshRuns(errorSummary = "刷新任务被中断") {
      const finishedAt = new Date().toISOString();
      interruptRunningRefreshRunsStmt.run({
        finishedAt,
        durationMs: 0,
        errorSummary
      });
    },
    getRefreshRunById(id) {
      return getRefreshRunByIdStmt.get(id);
    },
    getLatestRefreshRun() {
      return getLatestRefreshRunStmt.get();
    },
    listRefreshRuns(limit = 20) {
      const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      return listRefreshRunsStmt.all(normalizedLimit);
    },
    pruneRefreshRuns({ retentionDays = 14, maxEntries = 1000 } = {}) {
      let removed = 0;
      const normalizedRetentionDays = Math.max(0, Math.floor(Number(retentionDays) || 0));
      const normalizedMaxEntries = Math.max(0, Math.floor(Number(maxEntries) || 0));
      if (normalizedRetentionDays > 0) {
        removed += pruneRefreshRunsOlderThanStmt.run({
          offset: `-${normalizedRetentionDays} days`
        }).changes;
      }
      if (normalizedMaxEntries > 0) {
        removed += pruneRefreshRunsOverflowStmt.run({
          keepCount: normalizedMaxEntries
        }).changes;
      }
      return removed;
    },
    getOrCreateFeed(feed) {
      const existing = getFeedByUrlStmt.get(feed.url);
      if (existing) return existing;
      const result = createFeedStmt.run(feed);
      return getFeedByIdStmt.get(result.lastInsertRowid);
    },
    getFeedById(id) {
      return getFeedByIdStmt.get(id);
    },
    updateFeedMeta(feed) {
      updateFeedMetaStmt.run({
        ...feed,
        etag: feed.etag ?? null,
        lastModified: feed.lastModified ?? null
      });
    },
    touchFeedFetched(feed) {
      touchFeedFetchedStmt.run({
        id: feed.id,
        etag: feed.etag ?? null,
        lastModified: feed.lastModified ?? null
      });
    },
    updateFeedAutoCategory(id, autoCategory = null) {
      updateFeedAutoCategoryStmt.run({
        id,
        autoCategory: autoCategory ? String(autoCategory).trim() : null
      });
      return this.getFeedById(id);
    },
    updateFeedError(id, errorMessage) {
      updateFeedErrorStmt.run(errorMessage, id);
    },
    linkUserFeed(userId, feedId, customTitle) {
      linkUserFeedStmt.run({ userId, feedId, customTitle });
      markUserItemStatsDirty(userId);
      return getUserFeedStmt.get({ userId, feedId });
    },
    listUserFeeds(userId) {
      return listUserFeedsStmt.all({ userId });
    },
    countUserFeeds(userId) {
      return countUserFeedsStmt.get(userId).count;
    },
    countUserFavorites(userId) {
      return getUserItemStatsForSimpleCounts(userId).favorite;
    },
    getUserFeed(userId, feedId) {
      return getUserFeedStmt.get({ userId, feedId });
    },
    unlinkUserFeed(userId, feedId) {
      const result = unlinkUserFeedStmt.run(userId, feedId);
      if (result.changes > 0) {
        markUserItemStatsDirty(userId);
      }
    },
    updateUserFeedCustomTitle(userId, feedId, customTitle) {
      updateUserFeedCustomTitleStmt.run(customTitle, userId, feedId);
      return getUserFeedStmt.get({ userId, feedId });
    },
    updateUserFeedPreferences(userId, feedId, preferences = {}) {
      updateUserFeedPreferencesStmt.run({
        userId,
        feedId,
        customTitle: preferences.customTitle ?? null,
        category: preferences.category ?? null,
        isArchived: preferences.isArchived ? 1 : 0,
        isCollapsed: preferences.isCollapsed ? 1 : 0,
        translationTargetLanguage: preferences.translationTargetLanguage ?? null,
        autoTranslate: preferences.autoTranslate ?? null,
        displayTranslated: preferences.displayTranslated ?? null,
        translationMode: preferences.translationMode ?? null,
        isPublic: preferences.isPublic ? 1 : 0
      });
      return getUserFeedStmt.get({ userId, feedId });
    },
    setUserFeedTranslation(userId, feedId, translatedTitle, translatedLanguage, translatedSourceTitle) {
      upsertUserFeedTranslationStmt.run({
        userId,
        feedId,
        translatedTitle: translatedTitle ?? null,
        translatedLanguage: translatedLanguage ?? null,
        translatedSourceTitle: translatedSourceTitle ?? null
      });
      return getUserFeedStmt.get({ userId, feedId });
    },
    listGlobalFeeds() {
      return listGlobalFeedsStmt.all();
    },
    listRefreshableFeeds() {
      return listRefreshableFeedsStmt.all();
    },
    listAdminFeeds() {
      return listAdminFeedsStmt.all();
    },
    listPublicFeeds(limit = 24) {
      const normalizedLimit = Math.max(1, Math.min(120, Number(limit) || 24));
      return listPublicFeedsStmt.all(normalizedLimit);
    },
    listRecentItemsForFeeds(feedIds = [], perFeed = 3) {
      const normalizedFeedIds = [...new Set((feedIds || []).map((value) => Number(value)).filter((value) => value > 0))];
      if (!normalizedFeedIds.length) return [];

      const normalizedPerFeed = Math.max(1, Math.min(10, Number(perFeed) || 3));
      const placeholders = normalizedFeedIds.map(() => "?").join(", ");
      return db.prepare(`
        SELECT id, feed_id, title, link, summary, content_text, author, published_at, created_at
        FROM (
          SELECT
            i.id,
            i.feed_id,
            i.title,
            i.link,
            i.summary,
            i.content_text,
            i.author,
            i.published_at,
            i.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY i.feed_id
              ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC
            ) AS row_num
          FROM items i
          WHERE i.feed_id IN (${placeholders})
        ) ranked
        WHERE ranked.row_num <= ?
        ORDER BY ranked.feed_id ASC, COALESCE(ranked.published_at, ranked.created_at) DESC, ranked.id DESC
      `).all(...normalizedFeedIds, normalizedPerFeed);
    },
    listUserFeedIdsByFeedIds(userId, feedIds = []) {
      const normalizedFeedIds = [...new Set((feedIds || []).map((value) => Number(value)).filter((value) => value > 0))];
      if (!normalizedFeedIds.length) return [];

      const placeholders = normalizedFeedIds.map(() => "?").join(", ");
      return db.prepare(`
        SELECT feed_id
        FROM user_feeds
        WHERE user_id = ?
          AND feed_id IN (${placeholders})
      `).all(userId, ...normalizedFeedIds).map((row) => Number(row.feed_id));
    },
    listUserItems(userId, feedId, limit = 20, options = {}) {
      const params = {
        userId,
        feedId: feedId || null,
        limit,
        offset: Math.max(0, Number(options.offset || 0)),
        favoritesOnly: options.favoritesOnly ? 1 : 0,
        readState: options.readState === 0 || options.readState === 1 ? options.readState : -1,
        publishedSince: options.publishedSince || null
      };
      const canUseFastList = !params.favoritesOnly && params.readState === -1;
      return (canUseFastList ? listUserItemsFastStmt : listUserItemsStmt).all(params);
    },
    listDigestItems(userId, options = {}) {
      const feedIds = [...new Set((options.feedIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
      const category = String(options.category || "").trim();
      const since = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const limit = Math.max(1, Math.min(200, Number(options.limit) || 80));
      const unreadOnly = options.unreadOnly ? 1 : 0;
      const feedPlaceholders = feedIds.map(() => "?").join(", ");
      const params = [userId, since];
      let feedFilter = "";
      if (feedIds.length) {
        feedFilter = `AND i.feed_id IN (${feedPlaceholders})`;
        params.push(...feedIds);
      }
      let categoryFilter = "";
      if (category) {
        categoryFilter = "AND COALESCE(NULLIF(uf.category, ''), NULLIF(f.auto_category, ''), '') = ?";
        params.push(category);
      }
      params.push(limit);
      return db.prepare(`
        SELECT
          i.id,
          i.feed_id,
          i.title,
          i.link,
          i.summary,
          i.content_text,
          i.published_at,
          i.created_at,
          COALESCE(NULLIF(uf.custom_title, ''), f.title) AS feed_title,
          COALESCE(NULLIF(uf.category, ''), NULLIF(f.auto_category, ''), '') AS feed_category
        FROM items i
        JOIN feeds f ON f.id = i.feed_id
        JOIN user_feeds uf ON uf.feed_id = f.id
        LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
        WHERE uf.user_id = ?
          AND COALESCE(i.published_at, i.created_at) >= ?
          AND (${unreadOnly} = 0 OR COALESCE(uis.is_read, 0) = 0)
          ${feedFilter}
          ${categoryFilter}
        ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC
        LIMIT ?
      `).all(...params);
    },
    countUserItems(userId, feedId, options = {}) {
      const normalizedFeedId = Number(feedId || 0);
      const hasReadStateFilter = options.readState === 0 || options.readState === 1;
      const hasSimpleAllScope =
        !normalizedFeedId &&
        !options.publishedSince &&
        (!options.favoritesOnly || !hasReadStateFilter) &&
        (options.readState === undefined || options.readState === null || hasReadStateFilter);
      if (hasSimpleAllScope) {
        const stats = getUserItemStatsForSimpleCounts(userId);
        if (options.favoritesOnly) return stats.favorite;
        if (options.readState === 0) return stats.unread;
        if (options.readState === 1) return Math.max(0, stats.all - stats.unread);
        return stats.all;
      }
      const hasSimpleFeedScope =
        normalizedFeedId > 0 &&
        !options.favoritesOnly &&
        !options.publishedSince &&
        (options.readState === undefined || options.readState === null || hasReadStateFilter);
      if (hasSimpleFeedScope) {
        const feed = getUserFeedStmt.get({ userId, feedId: normalizedFeedId });
        const itemCount = Number(feed?.item_count || 0);
        const unreadCount = Number(feed?.unread_count || 0);
        if (options.readState === 0) return unreadCount;
        if (options.readState === 1) return Math.max(0, itemCount - unreadCount);
        return itemCount;
      }
      return Number(
        countUserItemsStmt.get({
          userId,
          feedId: feedId || null,
          favoritesOnly: options.favoritesOnly ? 1 : 0,
          readState: options.readState === 0 || options.readState === 1 ? options.readState : -1,
          publishedSince: options.publishedSince || null
        })?.count || 0
      );
    },
    countUserItemBuckets(userId, { todaySince = null } = {}) {
      const normalizedTodaySince = todaySince || null;
      const stats = getUserItemStatsStmt.get(userId);
      if (
        stats &&
        Number(stats.dirty || 0) === 0 &&
        (stats.today_since || null) === normalizedTodaySince
      ) {
        return normalizeCountBuckets(stats);
      }
      return rebuildUserItemStats(userId, normalizedTodaySince);
    },
    listUserItemIds(userId, feedId, options = {}) {
      return listUserItemIdsStmt
        .all({
          userId,
          feedId: feedId || null,
          favoritesOnly: options.favoritesOnly ? 1 : 0,
          readState: options.readState === 0 || options.readState === 1 ? options.readState : -1,
          publishedSince: options.publishedSince || null,
          publishedBefore: options.publishedBefore || null
        })
        .map((entry) => Number(entry.id))
        .filter((id) => Number.isInteger(id) && id > 0);
    },
    listAdminItems(limit = 200) {
      return listAdminItemsStmt.all(limit);
    },
    getUserItem(userId, itemId) {
      return getUserItemStmt.get(itemId, userId);
    },
    upsertItems(feedId, items) {
      const tx = db.transaction((records) => {
        let inserted = 0;
        const existingItemStmt = db.prepare("SELECT id FROM items WHERE feed_id = ? AND guid = ?");
        const existingLinkRowsStmt = db.prepare(`
          SELECT id, link
          FROM items
          WHERE feed_id = ?
            AND link IS NOT NULL
            AND TRIM(link) <> ''
          ORDER BY id DESC
        `);
        const linkIndex = new Map();
        for (const row of existingLinkRowsStmt.all(feedId)) {
          const normalized = normalizeItemLink(row.link);
          if (normalized && !linkIndex.has(normalized)) {
            linkIndex.set(normalized, row.id);
          }
        }
        for (const item of records) {
          const publishedAt = toIsoOrNull(item.publishedAt);
          const baseParams = {
            feedId,
            guid: item.guid,
            title: item.title,
            link: item.link,
            author: item.author || "",
            summary: item.summary || "",
            contentHtml: item.contentHtml || "",
            contentText: item.contentText || "",
            publishedAt,
            crawledAt: item.crawledAt || null
          };
          const existed = existingItemStmt.get(feedId, item.guid);
          if (!existed && checkPrunedGuidStmt.get(feedId, item.guid)) {
            continue;
          }
          const normalizedLink = normalizeItemLink(item.link);
          const linkMatchedItemId = !existed && normalizedLink ? linkIndex.get(normalizedLink) : null;
          if (linkMatchedItemId) {
            updateItemByIdFromFeedEntryStmt.run({
              ...baseParams,
              id: linkMatchedItemId
            });
            continue;
          }
          upsertItemStmt.run(baseParams);
          if (!existed) inserted += 1;
          if (normalizedLink) {
            const row = existingItemStmt.get(feedId, item.guid);
            if (row?.id) linkIndex.set(normalizedLink, row.id);
          }
        }
        return inserted;
      });
      const inserted = tx(items);
      if (inserted > 0) {
        markFeedSubscribersItemStatsDirty(feedId);
      }
      return inserted;
    },
    updateItemContent(id, contentHtml, contentText, originalUrl = null, originalTitle = null) {
      updateItemContentStmt.run({ id, contentHtml, contentText, originalUrl, originalTitle });
    },
    updateItemPageContent(id, pageHtml, pageText, originalUrl = null, originalTitle = null) {
      updateItemPageContentStmt.run({ id, pageHtml, pageText, originalUrl, originalTitle });
    },
    listFeedItemsShortContent(feedId, minLength = 400, limit = 10) {
      return listFeedItemsShortContentStmt.all({ feedId, minLength, limit });
    },
    updateTranslation(id, translatedTitle, translatedText, translatedLanguage = null) {
      updateTranslationStmt.run({
        id,
        translatedTitle,
        translatedText,
        translatedLanguage
      });
    },
    updateSummary(id, aiSummary) {
      updateSummaryStmt.run(aiSummary, id);
    },
    setUserItemTranslation(userId, itemId, translatedTitle, translatedText, translatedLanguage) {
      upsertUserItemTranslationStmt.run({
        userId,
        itemId,
        translatedTitle,
        translatedText,
        translatedLanguage
      });
      return this.getUserItem(userId, itemId);
    },
    clearItemTranslations(itemId) {
      clearItemTranslationsStmt.run({ itemId });
    },
    setUserItemReadState(userId, itemId, isRead, lastOpenedAt = null) {
      upsertUserItemReadStateStmt.run({
        userId,
        itemId,
        isRead: isRead ? 1 : 0,
        lastOpenedAt
      });
      markUserItemStatsDirty(userId);
      return this.getUserItem(userId, itemId);
    },
    setUserItemReadStateBulk(userId, itemIds, isRead, lastOpenedAt = null) {
      const uniqueIds = [...new Set((itemIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
      if (!uniqueIds.length) {
        return 0;
      }
      const changed = upsertUserItemReadStateBulkTx(
        uniqueIds.map((itemId) => ({
          userId,
          itemId,
          isRead: isRead ? 1 : 0,
          lastOpenedAt
        }))
      );
      if (changed > 0) {
        markUserItemStatsDirty(userId);
      }
      return changed;
    },
    setUserItemFavoriteState(userId, itemId, isFavorited, favoritedAt = null) {
      upsertUserItemFavoriteStateStmt.run({
        userId,
        itemId,
        isFavorited: isFavorited ? 1 : 0,
        favoritedAt
      });
      markUserItemStatsDirty(userId);
      return this.getUserItem(userId, itemId);
    },
    getFeedRetentionLimit(feedId) {
      return Number(getFeedRetentionLimitStmt.get(feedId)?.keep_count || 0);
    },
    deleteOrphanFeeds() {
      return deleteOrphanFeedsStmt.run().changes;
    },
    cleanupOrphans() {
      const before = getOrphanMetrics();
      const changes = cleanupOrphansTx();
      const after = getOrphanMetrics();
      return {
        before,
        changes,
        after,
        beforeTotal: totalOrphanCount(before),
        afterTotal: totalOrphanCount(after)
      };
    },
    pruneFeedItems(feedId, keepCount, options = {}) {
      let changes = 0;
      if (options.scope === "user_total") {
        const hasConfiguredMaxItemsTotal =
          options.maxItemsTotal !== undefined && options.maxItemsTotal !== null && String(options.maxItemsTotal).trim() !== "";
        const maxItemsTotal =
          hasConfiguredMaxItemsTotal && Number.isFinite(Number(options.maxItemsTotal))
            ? Math.max(0, Math.floor(Number(options.maxItemsTotal)))
            : null;
        const maxAgeDays = Number(options.maxAgeDays || 0);
        const minKeepCount = Math.max(0, Math.floor(Number(options.minKeepCount || 0) || 0));
        const protectFavorites = options.protectFavorites !== false;
        const protectUnread = options.protectUnread === true;
        const hasExplicitCountRule = maxItemsTotal !== null;
        const hasAgeRule = Number.isFinite(maxAgeDays) && maxAgeDays > 0;

        const predicates = [];
        if (hasExplicitCountRule) {
          predicates.push("subscriber_items.row_num > MAX(@maxItemsTotal, @minKeepCount)");
        } else {
          predicates.push("subscriber_items.row_num > MAX(subscriber_items.keep_count, @minKeepCount)");
        }
        if (hasAgeRule) {
          predicates.push("(subscriber_items.row_num > @minKeepCount AND subscriber_items.sort_at < @cutoff)");
        }

        const itemsToPrune = db.prepare(`
          WITH subscriber_items AS (
            SELECT
              uf.user_id,
              i.id AS item_id,
              COALESCE(i.published_at, i.created_at) AS sort_at,
              COALESCE(p.max_saved_items, free_plan.max_saved_items) AS keep_count,
              COALESCE(uis.is_read, 0) AS is_read,
              COALESCE(uis.is_favorited, 0) AS is_favorited,
              ROW_NUMBER() OVER (
                PARTITION BY uf.user_id
                ORDER BY COALESCE(i.published_at, i.created_at) DESC, i.id DESC
              ) AS row_num
            FROM items i
            JOIN user_feeds uf ON uf.feed_id = i.feed_id
            LEFT JOIN subscriptions s ON s.user_id = uf.user_id AND s.status = 'active'
            LEFT JOIN plans p ON p.id = s.plan_id
            JOIN plans free_plan ON free_plan.code = 'free'
            LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
          )
          SELECT DISTINCT candidate.id, candidate.guid
          FROM items candidate
          WHERE candidate.feed_id = @feedId
            AND NOT EXISTS (
              SELECT 1
              FROM subscriber_items
              WHERE subscriber_items.item_id = candidate.id
                AND (
                  NOT (${predicates.join(" OR ")})
                  ${protectFavorites ? "OR subscriber_items.is_favorited = 1" : ""}
                  ${protectUnread ? "OR subscriber_items.is_read = 0" : ""}
                )
            )
        `).all({
          feedId,
          maxItemsTotal: maxItemsTotal || 0,
          minKeepCount,
          cutoff: hasAgeRule ? new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString() : null
        });
        changes = pruneItemsWithGuidTombstones(feedId, itemsToPrune);
        if (changes > 0) {
          markFeedSubscribersItemStatsDirty(feedId);
        }
        return changes;
      }

      const normalizedKeepCount = Number.isFinite(Number(keepCount)) ? Math.max(0, Math.floor(Number(keepCount))) : null;
      const maxAgeDays = Number(options.maxAgeDays || 0);
      const minKeepCount = Math.max(0, Math.floor(Number(options.minKeepCount || 0) || 0));
      const protectFavorites = options.protectFavorites !== false;
      const protectUnread = options.protectUnread === true;
      const hasCountRule = normalizedKeepCount !== null && normalizedKeepCount > 0;
      const hasAgeRule = Number.isFinite(maxAgeDays) && maxAgeDays > 0;

      if (!hasCountRule && !hasAgeRule && minKeepCount < 1 && options.retentionRules !== true) {
        changes = pruneItemsWithGuidTombstones(
          feedId,
          db.prepare(`SELECT id, guid FROM items WHERE feed_id = ?`).all(feedId)
        );
      } else if (!hasCountRule && !hasAgeRule) {
        changes = 0;
      } else {
        const predicates = [];
        const params = {
          feedId,
          keepCount: Math.max(normalizedKeepCount || 0, minKeepCount),
          minKeepCount,
          cutoff: hasAgeRule ? new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString() : null
        };

        if (hasCountRule) {
          predicates.push("ranked.row_num > @keepCount");
        }
        if (hasAgeRule) {
          predicates.push("(ranked.row_num > @minKeepCount AND COALESCE(ranked.published_at, ranked.created_at) < @cutoff)");
        }

        const protectionPredicates = [];
        if (protectFavorites) {
          protectionPredicates.push(`
            NOT EXISTS (
              SELECT 1
              FROM user_item_states favorite_state
              WHERE favorite_state.item_id = ranked.id
                AND favorite_state.is_favorited = 1
            )
          `);
        }
        if (protectUnread) {
          protectionPredicates.push(`
            NOT EXISTS (
              SELECT 1
              FROM user_feeds unread_uf
              LEFT JOIN user_item_states unread_state
                ON unread_state.item_id = ranked.id
                AND unread_state.user_id = unread_uf.user_id
              WHERE unread_uf.feed_id = @feedId
                AND COALESCE(unread_state.is_read, 0) = 0
            )
          `);
        }

        const itemsToPrune = db.prepare(`
          WITH ranked AS (
            SELECT
              id,
              guid,
              published_at,
              created_at,
              ROW_NUMBER() OVER (ORDER BY COALESCE(published_at, created_at) DESC, id DESC) AS row_num
            FROM items
            WHERE feed_id = @feedId
          )
          SELECT ranked.id, ranked.guid
          FROM ranked
          WHERE (${predicates.join(" OR ") || "0"})
            ${protectionPredicates.length ? `AND ${protectionPredicates.join("\n              AND ")}` : ""}
        `).all(params);
        changes = pruneItemsWithGuidTombstones(feedId, itemsToPrune);
      }
      if (changes > 0) {
        markFeedSubscribersItemStatsDirty(feedId);
      }
      return changes;
    },
    pruneExpiredGuids({ retentionDays = 3650 } = {}) {
      const normalizedRetentionDays = Math.floor(Number(retentionDays) || 0);
      if (normalizedRetentionDays <= 0) return 0;
      return pruneExpiredGuidsStmt.run({ retentionDays: normalizedRetentionDays }).changes;
    },
    listDigestRulesByUser(userId) {
      return listDigestRulesByUserStmt.all(userId);
    },
    getDigestRuleById(id) {
      return getDigestRuleByIdStmt.get(id);
    },
    countDigestRulesByUser(userId) {
      return Number(countDigestRulesByUserStmt.get(userId)?.count || 0);
    },
    createDigestRule(rule) {
      const result = createDigestRuleStmt.run(rule);
      return getDigestRuleByIdStmt.get(result.lastInsertRowid);
    },
    updateDigestRule(rule) {
      updateDigestRuleStmt.run(rule);
      return getDigestRuleByIdStmt.get(rule.id);
    },
    deleteDigestRule(id, userId) {
      return deleteDigestRuleStmt.run(id, userId).changes;
    },
    markDigestRuleSent(id, sentDate) {
      markDigestRuleSentStmt.run({ id, sentDate });
      return getDigestRuleByIdStmt.get(id);
    },
    listEnabledDigestRules() {
      return listEnabledDigestRulesStmt.all();
    },
    createDigestRun(run) {
      const result = createDigestRunStmt.run({
        ruleId: run.ruleId,
        userId: run.userId,
        status: run.status,
        startedAt: run.startedAt ?? new Date().toISOString(),
        finishedAt: run.finishedAt ?? null,
        emailTo: run.emailTo ?? "",
        itemCount: run.itemCount ?? 0,
        content: run.content ?? "",
        error: run.error ?? "",
        detailsJson: run.detailsJson ?? "{}"
      });
      return getDigestRunByIdStmt.get(result.lastInsertRowid);
    },
    updateDigestRun(run) {
      updateDigestRunStmt.run({
        id: run.id,
        status: run.status ?? null,
        finishedAt: run.finishedAt ?? null,
        emailTo: run.emailTo ?? null,
        itemCount: run.itemCount ?? null,
        content: run.content ?? null,
        error: run.error ?? null,
        detailsJson: run.detailsJson ?? null
      });
      return getDigestRunByIdStmt.get(run.id);
    },
    listDigestRunsByUser(userId, limit = 20) {
      return listDigestRunsByUserStmt.all(userId, Math.max(1, Math.min(100, Number(limit) || 20)));
    },
    optimize() {
      if (isClosed) return;
      optimizeDb();
    },
    vacuum() {
      if (isClosed) return;
      assertDatabaseHealthyForVacuum();
      db.exec("VACUUM");
      optimizeDb();
    },
    checkIntegrity() {
      if (isClosed) return "closed";
      return String(db.pragma("quick_check", { simple: true }) || "");
    },
    async backup(targetPath) {
      if (isClosed) return null;
      assertSqliteHealthy(db, { label: "database before backup" });
      await db.backup(targetPath);
      checkSqliteFile(targetPath, { label: `backup ${targetPath}`, cleanupSidecars: true });
      return targetPath;
    },
    getDatabaseMetrics() {
      const pageSize = Number(db.pragma("page_size", { simple: true }) || 0);
      const pageCount = Number(db.pragma("page_count", { simple: true }) || 0);
      const freelistCount = Number(db.pragma("freelist_count", { simple: true }) || 0);
      const journalMode = String(db.pragma("journal_mode", { simple: true }) || "");
      const tableRows = databaseTables.map((table) => ({
        table,
        rows: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0)
      }));
      const orphanMetrics = getOrphanMetrics();
      return {
        pageSize,
        pageCount,
        freelistCount,
        databaseBytes: pageSize * pageCount,
        freeBytes: pageSize * freelistCount,
        freeRatio: pageCount > 0 ? freelistCount / pageCount : 0,
        journalMode,
        tableRows,
        orphanMetrics,
        orphanTotal: totalOrphanCount(orphanMetrics)
      };
    },
    close() {
      closeDb();
    }
  };
}
