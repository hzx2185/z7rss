import { createStoreStatements } from "./store-statements.js";

const databaseTables = [
  "users",
  "sessions",
  "feeds",
  "user_feeds",
  "items",
  "user_item_states",
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
    countUserItemsStmt,
    countUserItemBucketsStmt,
    listUserItemIdsStmt,
    listAdminItemsStmt,
    getUserItemStmt,
    upsertItemStmt,
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

  function optimizeDb() {
    db.pragma("optimize");
    db.pragma("wal_checkpoint(TRUNCATE)");
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
      updateFeedMetaStmt.run(feed);
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
      return getUserFeedStmt.get(userId, feedId);
    },
    listUserFeeds(userId) {
      return listUserFeedsStmt.all(userId);
    },
    countUserFeeds(userId) {
      return countUserFeedsStmt.get(userId).count;
    },
    countUserFavorites(userId) {
      return countUserFavoritesStmt.get(userId).count;
    },
    getUserFeed(userId, feedId) {
      return getUserFeedStmt.get(userId, feedId);
    },
    unlinkUserFeed(userId, feedId) {
      unlinkUserFeedStmt.run(userId, feedId);
    },
    updateUserFeedCustomTitle(userId, feedId, customTitle) {
      updateUserFeedCustomTitleStmt.run(customTitle, userId, feedId);
      return getUserFeedStmt.get(userId, feedId);
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
      return getUserFeedStmt.get(userId, feedId);
    },
    setUserFeedTranslation(userId, feedId, translatedTitle, translatedLanguage, translatedSourceTitle) {
      upsertUserFeedTranslationStmt.run({
        userId,
        feedId,
        translatedTitle: translatedTitle ?? null,
        translatedLanguage: translatedLanguage ?? null,
        translatedSourceTitle: translatedSourceTitle ?? null
      });
      return getUserFeedStmt.get(userId, feedId);
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
      return listUserItemsStmt.all({
        userId,
        feedId: feedId || null,
        limit,
        offset: Math.max(0, Number(options.offset || 0)),
        favoritesOnly: options.favoritesOnly ? 1 : 0,
        readState: options.readState === 0 || options.readState === 1 ? options.readState : -1,
        publishedSince: options.publishedSince || null
      });
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
      const row = countUserItemBucketsStmt.get({
        userId,
        todaySince: todaySince || null
      }) || {};
      return {
        all: Number(row.all_count || 0),
        today: Number(row.today_count || 0),
        favorite: Number(row.favorite_count || 0),
        unread: Number(row.unread_count || 0)
      };
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
        for (const item of records) {
          const existed = existingItemStmt.get(feedId, item.guid);
          upsertItemStmt.run({
            feedId,
            guid: item.guid,
            title: item.title,
            link: item.link,
            author: item.author || "",
            summary: item.summary || "",
            contentHtml: item.contentHtml || "",
            contentText: item.contentText || "",
            publishedAt: toIsoOrNull(item.publishedAt),
            crawledAt: item.crawledAt || null
          });
          if (!existed) inserted += 1;
        }
        return inserted;
      });
      return tx(items);
    },
    updateItemContent(id, contentHtml, contentText, originalUrl = null, originalTitle = null) {
      updateItemContentStmt.run({ id, contentHtml, contentText, originalUrl, originalTitle });
    },
    updateItemPageContent(id, pageHtml, pageText, originalUrl = null, originalTitle = null) {
      updateItemPageContentStmt.run({ id, pageHtml, pageText, originalUrl, originalTitle });
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
    setUserItemReadState(userId, itemId, isRead, lastOpenedAt = null) {
      upsertUserItemReadStateStmt.run({
        userId,
        itemId,
        isRead: isRead ? 1 : 0,
        lastOpenedAt
      });
      return this.getUserItem(userId, itemId);
    },
    setUserItemReadStateBulk(userId, itemIds, isRead, lastOpenedAt = null) {
      const uniqueIds = [...new Set((itemIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
      if (!uniqueIds.length) {
        return 0;
      }
      upsertUserItemReadStateBulkTx(
        uniqueIds.map((itemId) => ({
          userId,
          itemId,
          isRead: isRead ? 1 : 0,
          lastOpenedAt
        }))
      );
      return uniqueIds.length;
    },
    setUserItemFavoriteState(userId, itemId, isFavorited, favoritedAt = null) {
      upsertUserItemFavoriteStateStmt.run({
        userId,
        itemId,
        isFavorited: isFavorited ? 1 : 0,
        favoritedAt
      });
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
    pruneFeedItems(feedId, keepCount) {
      if (!Number.isFinite(keepCount) || keepCount < 1) {
        return deleteFeedItemsStmt.run(feedId).changes;
      }
      return pruneFeedItemsStmt.run({
        feedId,
        keepCount: Math.max(0, Math.floor(keepCount))
      }).changes;
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
      db.exec("VACUUM");
      optimizeDb();
    },
    async backup(targetPath) {
      if (isClosed) return null;
      await db.backup(targetPath);
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
