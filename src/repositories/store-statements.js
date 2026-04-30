export function createStoreStatements(db) {
  const createUserStmt = db.prepare(`
    INSERT INTO users (email, password_hash, display_name, is_admin, status)
    VALUES (@email, @passwordHash, @displayName, @isAdmin, @status)
  `);
  const getUserByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
  const getUserByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const getFirstUserStmt = db.prepare(`SELECT * FROM users ORDER BY id ASC LIMIT 1`);
  const countAdminsStmt = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE is_admin = 1`);
  const countUsersStmt = db.prepare(`SELECT COUNT(*) AS count FROM users`);
  const updateUserAdminStmt = db.prepare(`UPDATE users SET is_admin = ?, status = COALESCE(?, status) WHERE id = ?`);
  const updateUserStatusStmt = db.prepare(`UPDATE users SET status = ? WHERE id = ?`);
  const updateUserPasswordStmt = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);
  const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);
  const getUserSettingStmt = db.prepare(`SELECT * FROM user_settings WHERE user_id = ? AND category = ? AND key = ?`);
  const listUserSettingsStmt = db.prepare(`SELECT * FROM user_settings WHERE user_id = ? ORDER BY category ASC, key ASC`);
  const listUserSettingsByCategoryStmt = db.prepare(`
    SELECT *
    FROM user_settings
    WHERE user_id = ? AND category = ?
    ORDER BY key ASC
  `);
  const upsertUserSettingStmt = db.prepare(`
    INSERT INTO user_settings (user_id, category, key, value)
    VALUES (@userId, @category, @key, @value)
    ON CONFLICT(user_id, category, key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);
  const listUsersStmt = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.is_admin,
      u.status,
      u.created_at,
      s.status AS subscription_status,
      s.provider AS subscription_provider,
      s.current_period_start,
      s.current_period_end,
      p.code AS plan_code,
      p.name AS plan_name,
      COUNT(uf.id) AS feed_count
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN plans p ON p.id = s.plan_id
    LEFT JOIN user_feeds uf ON uf.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);

  const createSessionStmt = db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent, last_seen_at)
    VALUES (@token, @userId, @expiresAt, @ipAddress, @userAgent, @lastSeenAt)
  `);
  const getSessionStmt = db.prepare(`
    SELECT s.*, u.email, u.display_name, u.is_admin, u.status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `);
  const listUserSessionsStmt = db.prepare(`
    SELECT id, token, user_id, expires_at, ip_address, user_agent, last_seen_at, created_at
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_seen_at DESC, created_at DESC
  `);
  const updateSessionActivityStmt = db.prepare(`
    UPDATE sessions
    SET
      last_seen_at = @lastSeenAt,
      ip_address = COALESCE(@ipAddress, ip_address),
      user_agent = COALESCE(@userAgent, user_agent)
    WHERE token = @token
  `);
  const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);
  const deleteUserSessionsStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
  const deleteOtherUserSessionsStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token != ?`);
  const deleteExpiredSessionsStmt = db.prepare(`DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP`);

  const getPlanByCodeStmt = db.prepare(`SELECT * FROM plans WHERE code = ?`);
  const getPlanByIdStmt = db.prepare(`SELECT * FROM plans WHERE id = ?`);
  const updatePlanSettingsStmt = db.prepare(`
    UPDATE plans
    SET
      max_feeds = COALESCE(@maxFeeds, max_feeds),
      max_saved_items = COALESCE(@maxSavedItems, max_saved_items),
      max_favorite_items = COALESCE(@maxFavoriteItems, max_favorite_items),
      ai_translation_enabled = COALESCE(@aiTranslationEnabled, ai_translation_enabled),
      ai_summary_enabled = COALESCE(@aiSummaryEnabled, ai_summary_enabled),
      custom_ai_enabled = COALESCE(@customAiEnabled, custom_ai_enabled),
      ai_digest_enabled = COALESCE(@aiDigestEnabled, ai_digest_enabled),
      email_digest_enabled = COALESCE(@emailDigestEnabled, email_digest_enabled),
      max_digest_rules = COALESCE(@maxDigestRules, max_digest_rules)
    WHERE code = @code
  `);
  const listPlansStmt = db.prepare(`
    SELECT
      p.*,
      COUNT(s.id) AS subscriber_count
    FROM plans p
    LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
    GROUP BY p.id
    ORDER BY p.price_monthly_cents ASC
  `);
  const getUserSubscriptionStmt = db.prepare(`
    SELECT
      s.*,
      p.code AS plan_code,
      p.name AS plan_name,
      p.description AS plan_description,
      p.price_monthly_cents,
      p.max_feeds,
      p.max_saved_items,
      p.max_favorite_items,
      p.ai_translation_enabled,
      p.ai_summary_enabled,
      p.custom_ai_enabled,
      p.ai_digest_enabled,
      p.email_digest_enabled,
      p.max_digest_rules,
      p.stripe_price_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.user_id = ?
  `);
  const getUserSubscriptionByProviderSubscriptionIdStmt = db.prepare(`
    SELECT
      s.*,
      p.code AS plan_code,
      p.name AS plan_name,
      p.description AS plan_description,
      p.price_monthly_cents,
      p.max_feeds,
      p.max_saved_items,
      p.max_favorite_items,
      p.ai_translation_enabled,
      p.ai_summary_enabled,
      p.custom_ai_enabled,
      p.ai_digest_enabled,
      p.email_digest_enabled,
      p.max_digest_rules,
      p.stripe_price_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.provider_subscription_id = ?
  `);
  const getUserSubscriptionByProviderCustomerIdStmt = db.prepare(`
    SELECT
      s.*,
      p.code AS plan_code,
      p.name AS plan_name,
      p.description AS plan_description,
      p.price_monthly_cents,
      p.max_feeds,
      p.max_saved_items,
      p.max_favorite_items,
      p.ai_translation_enabled,
      p.ai_summary_enabled,
      p.custom_ai_enabled,
      p.ai_digest_enabled,
      p.email_digest_enabled,
      p.max_digest_rules,
      p.stripe_price_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.provider_customer_id = ?
  `);
  const upsertSubscriptionStmt = db.prepare(`
    INSERT INTO subscriptions (
      user_id, plan_id, status, provider, provider_customer_id, provider_subscription_id,
      current_period_start, current_period_end
    ) VALUES (
      @userId, @planId, @status, @provider, @providerCustomerId, @providerSubscriptionId,
      @currentPeriodStart, @currentPeriodEnd
    )
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id,
      status = excluded.status,
      provider = excluded.provider,
      provider_customer_id = excluded.provider_customer_id,
      provider_subscription_id = excluded.provider_subscription_id,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      updated_at = CURRENT_TIMESTAMP
  `);
  const createBillingEventStmt = db.prepare(`
    INSERT INTO billing_events (
      user_id, plan_id, provider, provider_checkout_id, status, amount_cents, currency, checkout_url
    ) VALUES (
      @userId, @planId, @provider, @providerCheckoutId, @status, @amountCents, @currency, @checkoutUrl
    )
  `);
  const listBillingEventsStmt = db.prepare(`
    SELECT
      be.*,
      p.name AS plan_name,
      p.code AS plan_code,
      u.email AS user_email
    FROM billing_events be
    JOIN plans p ON p.id = be.plan_id
    JOIN users u ON u.id = be.user_id
    WHERE be.user_id = ?
    ORDER BY be.created_at DESC
  `);
  const listAllBillingEventsStmt = db.prepare(`
    SELECT
      be.*,
      p.name AS plan_name,
      p.code AS plan_code,
      u.email AS user_email
    FROM billing_events be
    JOIN plans p ON p.id = be.plan_id
    JOIN users u ON u.id = be.user_id
    ORDER BY be.created_at DESC
  `);
  const getBillingEventByCheckoutIdStmt = db.prepare(`SELECT * FROM billing_events WHERE provider_checkout_id = ?`);
  const updateBillingEventStatusStmt = db.prepare(`
    UPDATE billing_events
    SET status = @status, checkout_url = COALESCE(@checkoutUrl, checkout_url)
    WHERE provider_checkout_id = @providerCheckoutId
  `);

  const getSettingStmt = db.prepare(`SELECT * FROM settings WHERE category = ? AND key = ?`);
  const listSettingsStmt = db.prepare(`SELECT * FROM settings ORDER BY category ASC, key ASC`);
  const upsertSettingStmt = db.prepare(`
    INSERT INTO settings (category, key, value)
    VALUES (@category, @key, @value)
    ON CONFLICT(category, key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  const listRedeemCodesStmt = db.prepare(`
    SELECT rc.*, p.code AS plan_code, p.name AS plan_name
    FROM redeem_codes rc
    JOIN plans p ON p.id = rc.plan_id
    ORDER BY rc.created_at DESC
  `);
  const getRedeemCodeStmt = db.prepare(`
    SELECT rc.*, p.code AS plan_code, p.name AS plan_name
    FROM redeem_codes rc
    JOIN plans p ON p.id = rc.plan_id
    WHERE rc.code = ?
  `);
  const createRedeemCodeStmt = db.prepare(`
    INSERT INTO redeem_codes (code, plan_id, max_uses, expires_at, is_active, note)
    VALUES (@code, @planId, @maxUses, @expiresAt, @isActive, @note)
  `);
  const recordRedeemUseStmt = db.prepare(`
    INSERT INTO redeem_code_uses (redeem_code_id, user_id)
    VALUES (?, ?)
  `);
  const incrementRedeemCountStmt = db.prepare(`UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?`);
  const updateRedeemCodeStmt = db.prepare(`
    UPDATE redeem_codes
    SET is_active = @isActive, max_uses = @maxUses, expires_at = @expiresAt, note = @note
    WHERE id = @id
  `);

  const listPluginsStmt = db.prepare(`SELECT * FROM plugins ORDER BY created_at DESC`);
  const upsertPluginStmt = db.prepare(`
    INSERT INTO plugins (code, name, description, config_json, is_enabled)
    VALUES (@code, @name, @description, @configJson, @isEnabled)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      config_json = excluded.config_json,
      is_enabled = excluded.is_enabled,
      updated_at = CURRENT_TIMESTAMP
  `);

  const listContentRulesStmt = db.prepare(`SELECT * FROM content_rules ORDER BY created_at DESC`);
  const createContentRuleStmt = db.prepare(`
    INSERT INTO content_rules (kind, pattern, action, is_active)
    VALUES (@kind, @pattern, @action, @isActive)
  `);
  const updateContentRuleStmt = db.prepare(`UPDATE content_rules SET is_active = ? WHERE id = ?`);

  const listBlockedSitesStmt = db.prepare(`SELECT * FROM blocked_sites ORDER BY created_at DESC`);
  const upsertBlockedSiteStmt = db.prepare(`
    INSERT INTO blocked_sites (domain, reason, is_active)
    VALUES (@domain, @reason, @isActive)
    ON CONFLICT(domain) DO UPDATE SET
      reason = excluded.reason,
      is_active = excluded.is_active
  `);
  const listBlockedIpsStmt = db.prepare(`SELECT * FROM blocked_ips ORDER BY created_at DESC`);
  const upsertBlockedIpStmt = db.prepare(`
    INSERT INTO blocked_ips (ip, reason, is_active)
    VALUES (@ip, @reason, @isActive)
    ON CONFLICT(ip) DO UPDATE SET
      reason = excluded.reason,
      is_active = excluded.is_active
  `);
  const createAuditLogStmt = db.prepare(`
    INSERT INTO audit_logs (
      actor_user_id,
      actor_email,
      actor_display_name,
      actor_ip,
      action,
      target_type,
      target_id,
      summary,
      details_json
    ) VALUES (
      @actorUserId,
      @actorEmail,
      @actorDisplayName,
      @actorIp,
      @action,
      @targetType,
      @targetId,
      @summary,
      @detailsJson
    )
  `);
  const getAuditLogByIdStmt = db.prepare(`SELECT * FROM audit_logs WHERE id = ?`);
  const listAuditLogsStmt = db.prepare(`
    SELECT *
    FROM audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const pruneAuditLogsOlderThanStmt = db.prepare(`
    DELETE FROM audit_logs
    WHERE datetime(created_at) < datetime('now', @offset)
  `);
  const pruneAuditLogsOverflowStmt = db.prepare(`
    DELETE FROM audit_logs
    WHERE id IN (
      SELECT id
      FROM audit_logs
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT -1 OFFSET @keepCount
    )
  `);
  const createRefreshRunStmt = db.prepare(`
    INSERT INTO refresh_runs (
      trigger,
      status,
      total_feeds,
      succeeded_count,
      failed_count,
      actor_user_id,
      actor_email,
      actor_display_name,
      started_at,
      finished_at,
      duration_ms,
      error_summary,
      details_json
    ) VALUES (
      @trigger,
      @status,
      @totalFeeds,
      @succeededCount,
      @failedCount,
      @actorUserId,
      @actorEmail,
      @actorDisplayName,
      @startedAt,
      @finishedAt,
      @durationMs,
      @errorSummary,
      @detailsJson
    )
  `);
  const updateRefreshRunStmt = db.prepare(`
    UPDATE refresh_runs
    SET
      status = COALESCE(@status, status),
      total_feeds = COALESCE(@totalFeeds, total_feeds),
      succeeded_count = COALESCE(@succeededCount, succeeded_count),
      failed_count = COALESCE(@failedCount, failed_count),
      finished_at = COALESCE(@finishedAt, finished_at),
      duration_ms = COALESCE(@durationMs, duration_ms),
      error_summary = COALESCE(@errorSummary, error_summary),
      details_json = COALESCE(@detailsJson, details_json)
    WHERE id = @id
  `);
  const interruptRunningRefreshRunsStmt = db.prepare(`
    UPDATE refresh_runs
    SET
      status = 'interrupted',
      finished_at = COALESCE(finished_at, @finishedAt),
      duration_ms = COALESCE(duration_ms, @durationMs),
      error_summary = COALESCE(error_summary, @errorSummary)
    WHERE status = 'running'
  `);
  const getRefreshRunByIdStmt = db.prepare(`SELECT * FROM refresh_runs WHERE id = ?`);
  const getLatestRefreshRunStmt = db.prepare(`
    SELECT *
    FROM refresh_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `);
  const listRefreshRunsStmt = db.prepare(`
    SELECT *
    FROM refresh_runs
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  `);
  const pruneRefreshRunsOlderThanStmt = db.prepare(`
    DELETE FROM refresh_runs
    WHERE datetime(started_at) < datetime('now', @offset)
  `);
  const pruneRefreshRunsOverflowStmt = db.prepare(`
    DELETE FROM refresh_runs
    WHERE id IN (
      SELECT id
      FROM refresh_runs
      ORDER BY datetime(started_at) DESC, id DESC
      LIMIT -1 OFFSET @keepCount
    )
  `);

  const getFeedByIdStmt = db.prepare(`SELECT * FROM feeds WHERE id = ?`);
  const getFeedByUrlStmt = db.prepare(`SELECT * FROM feeds WHERE url = ?`);
  const createFeedStmt = db.prepare(`
    INSERT INTO feeds (title, url, site_url, description)
    VALUES (@title, @url, @siteUrl, @description)
  `);
  const updateFeedMetaStmt = db.prepare(`
    UPDATE feeds
    SET
      title = @title,
      site_url = @siteUrl,
      description = @description,
      updated_at = CURRENT_TIMESTAMP,
      last_fetched_at = CURRENT_TIMESTAMP,
      last_error = NULL
    WHERE id = @id
  `);
  const updateFeedAutoCategoryStmt = db.prepare(`
    UPDATE feeds
    SET
      auto_category = @autoCategory,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const updateFeedErrorStmt = db.prepare(`UPDATE feeds SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const linkUserFeedStmt = db.prepare(`
    INSERT INTO user_feeds (user_id, feed_id, custom_title, translated_title, translated_language, translated_source_title)
    VALUES (@userId, @feedId, @customTitle, NULL, NULL, NULL)
  `);
  const listUserFeedsStmt = db.prepare(`
    SELECT
      uf.id,
      uf.user_id,
      uf.feed_id,
      COALESCE(NULLIF(uf.custom_title, ''), f.title) AS title,
      uf.custom_title,
      uf.translated_title,
      uf.translated_language,
      uf.translated_source_title,
      uf.category,
      uf.is_archived,
      uf.is_collapsed,
      uf.translation_target_language,
      uf.auto_translate,
      uf.display_translated,
      uf.translation_mode,
      uf.is_public,
      f.auto_category,
      f.url,
      f.site_url,
      f.description,
      f.last_fetched_at,
      f.last_error,
      COUNT(i.id) AS item_count,
      COALESCE(SUM(CASE WHEN i.id IS NOT NULL AND COALESCE(uis.is_read, 0) = 0 THEN 1 ELSE 0 END), 0) AS unread_count
    FROM user_feeds uf
    JOIN feeds f ON f.id = uf.feed_id
    LEFT JOIN items i ON i.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = ?
    GROUP BY uf.id
    ORDER BY uf.created_at DESC
  `);
  const countUserFeedsStmt = db.prepare(`SELECT COUNT(*) AS count FROM user_feeds WHERE user_id = ?`);
  const countUserFavoritesStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM user_item_states
    WHERE user_id = ? AND is_favorited = 1
  `);
  const getUserFeedStmt = db.prepare(`
    SELECT
      uf.id,
      uf.user_id,
      uf.feed_id,
      COALESCE(NULLIF(uf.custom_title, ''), f.title) AS title,
      uf.custom_title,
      uf.translated_title,
      uf.translated_language,
      uf.translated_source_title,
      uf.category,
      uf.is_archived,
      uf.is_collapsed,
      uf.translation_target_language,
      uf.auto_translate,
      uf.display_translated,
      uf.translation_mode,
      uf.is_public,
      f.auto_category,
      f.url,
      f.site_url,
      f.description,
      f.last_fetched_at,
      f.last_error,
      COUNT(i.id) AS item_count,
      COALESCE(SUM(CASE WHEN i.id IS NOT NULL AND COALESCE(uis.is_read, 0) = 0 THEN 1 ELSE 0 END), 0) AS unread_count
    FROM user_feeds uf
    JOIN feeds f ON f.id = uf.feed_id
    LEFT JOIN items i ON i.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = ? AND uf.feed_id = ?
    GROUP BY uf.id
  `);
  const unlinkUserFeedStmt = db.prepare(`DELETE FROM user_feeds WHERE user_id = ? AND feed_id = ?`);
  const updateUserFeedCustomTitleStmt = db.prepare(`
    UPDATE user_feeds
    SET
      custom_title = ?,
      translated_title = NULL,
      translated_language = NULL,
      translated_source_title = NULL
    WHERE user_id = ? AND feed_id = ?
  `);
  const listGlobalFeedsStmt = db.prepare(`SELECT * FROM feeds ORDER BY created_at DESC`);
  const listRefreshableFeedsStmt = db.prepare(`
    SELECT f.*
    FROM feeds f
    WHERE EXISTS (
      SELECT 1
      FROM user_feeds uf
      WHERE uf.feed_id = f.id
    )
    ORDER BY COALESCE(f.last_fetched_at, f.updated_at, f.created_at) DESC, f.id DESC
  `);
  const listAdminFeedsStmt = db.prepare(`
    SELECT
      f.*,
      COUNT(DISTINCT uf.user_id) AS subscriber_count,
      COUNT(i.id) AS item_count
    FROM feeds f
    LEFT JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN items i ON i.feed_id = f.id
    GROUP BY f.id
    ORDER BY f.updated_at DESC
  `);
  const listPublicFeedsStmt = db.prepare(`
    SELECT
      f.*,
      COUNT(DISTINCT uf.user_id) AS sharer_count,
      (
        SELECT COUNT(*)
        FROM items i
        WHERE i.feed_id = f.id
      ) AS item_count
    FROM feeds f
    JOIN user_feeds uf ON uf.feed_id = f.id AND uf.is_public = 1
    JOIN users u ON u.id = uf.user_id
    WHERE u.status = 'active'
    GROUP BY f.id
    ORDER BY sharer_count DESC, COALESCE(f.last_fetched_at, f.updated_at, f.created_at) DESC, f.id DESC
    LIMIT ?
  `);
  const listUserItemsStmt = db.prepare(`
    SELECT
      i.id,
      i.feed_id,
      i.title,
      i.link,
      i.author,
      i.summary,
      CASE
        WHEN COALESCE(i.summary, '') <> '' THEN ''
        ELSE substr(COALESCE(NULLIF(i.content_text, ''), NULLIF(i.content_html, ''), ''), 1, 240)
      END AS content_excerpt,
      CASE
        WHEN COALESCE(NULLIF(i.content_text, ''), NULLIF(i.content_html, '')) IS NOT NULL THEN 1
        ELSE 0
      END AS content_loaded,
      i.published_at,
      i.created_at,
      NULLIF(i.ai_summary, '') IS NOT NULL AS has_ai_summary,
      COALESCE(NULLIF(uf.custom_title, ''), f.title) AS feed_title,
      uf.translated_title AS feed_user_translated_title,
      uf.translated_language AS feed_user_translated_language,
      uf.translated_source_title AS feed_user_translated_source_title,
      uf.translation_target_language AS feed_translation_target_language,
      uf.auto_translate AS feed_auto_translate,
      uf.display_translated AS feed_display_translated,
      uf.translation_mode AS feed_translation_mode,
      uis.translated_title AS user_translated_title,
      uis.translated_text AS user_translated_text,
      uis.translated_language AS user_translated_language,
      i.translated_title AS legacy_translated_title,
      i.translated_text AS legacy_translated_text,
      i.translated_language AS legacy_translated_language,
      COALESCE(uis.is_read, 0) AS is_read,
      COALESCE(uis.is_favorited, 0) AS is_favorited,
      uis.last_opened_at
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = @userId
      AND (@feedId IS NULL OR i.feed_id = @feedId)
      AND (@favoritesOnly = 0 OR COALESCE(uis.is_favorited, 0) = 1)
      AND (@readState = -1 OR COALESCE(uis.is_read, 0) = @readState)
      AND (@publishedSince IS NULL OR COALESCE(i.published_at, i.created_at) >= @publishedSince)
    ORDER BY COALESCE(i.published_at, i.created_at) DESC
    LIMIT @limit
    OFFSET @offset
  `);
  const countUserItemsStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = @userId
      AND (@feedId IS NULL OR i.feed_id = @feedId)
      AND (@favoritesOnly = 0 OR COALESCE(uis.is_favorited, 0) = 1)
      AND (@readState = -1 OR COALESCE(uis.is_read, 0) = @readState)
      AND (@publishedSince IS NULL OR COALESCE(i.published_at, i.created_at) >= @publishedSince)
  `);
  const countUserItemBucketsStmt = db.prepare(`
    SELECT
      COUNT(*) AS all_count,
      COALESCE(SUM(CASE WHEN @todaySince IS NOT NULL AND COALESCE(i.published_at, i.created_at) >= @todaySince THEN 1 ELSE 0 END), 0) AS today_count,
      COALESCE(SUM(CASE WHEN COALESCE(uis.is_favorited, 0) = 1 THEN 1 ELSE 0 END), 0) AS favorite_count,
      COALESCE(SUM(CASE WHEN COALESCE(uis.is_read, 0) = 0 THEN 1 ELSE 0 END), 0) AS unread_count
    FROM items i
    JOIN user_feeds uf ON uf.feed_id = i.feed_id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = @userId
  `);
  const listUserItemIdsStmt = db.prepare(`
    SELECT i.id
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE uf.user_id = @userId
      AND (@feedId IS NULL OR i.feed_id = @feedId)
      AND (@favoritesOnly = 0 OR COALESCE(uis.is_favorited, 0) = 1)
      AND (@readState = -1 OR COALESCE(uis.is_read, 0) = @readState)
      AND (@publishedSince IS NULL OR COALESCE(i.published_at, i.created_at) >= @publishedSince)
      AND (@publishedBefore IS NULL OR COALESCE(i.published_at, i.created_at) <= @publishedBefore)
    ORDER BY COALESCE(i.published_at, i.created_at) DESC
  `);
  const listAdminItemsStmt = db.prepare(`
    SELECT
      i.id,
      i.feed_id,
      i.title,
      i.link,
      i.author,
      i.summary,
      i.published_at,
      i.created_at,
      f.title AS feed_title
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    ORDER BY COALESCE(i.published_at, i.created_at) DESC
    LIMIT ?
  `);
  const getUserItemStmt = db.prepare(`
    SELECT
      i.*,
      COALESCE(NULLIF(uf.custom_title, ''), f.title) AS feed_title,
      uf.translated_title AS feed_user_translated_title,
      uf.translated_language AS feed_user_translated_language,
      uf.translated_source_title AS feed_user_translated_source_title,
      uf.translation_target_language AS feed_translation_target_language,
      uf.auto_translate AS feed_auto_translate,
      uf.display_translated AS feed_display_translated,
      uf.translation_mode AS feed_translation_mode,
      uis.translated_title AS user_translated_title,
      uis.translated_text AS user_translated_text,
      uis.translated_language AS user_translated_language,
      i.translated_title AS legacy_translated_title,
      i.translated_text AS legacy_translated_text,
      i.translated_language AS legacy_translated_language,
      COALESCE(uis.is_read, 0) AS is_read,
      COALESCE(uis.is_favorited, 0) AS is_favorited,
      uis.last_opened_at
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN user_item_states uis ON uis.item_id = i.id AND uis.user_id = uf.user_id
    WHERE i.id = ? AND uf.user_id = ?
  `);
  const upsertItemStmt = db.prepare(`
    INSERT INTO items (
      feed_id, guid, title, link, author, summary, content_html, content_text, published_at, crawled_at
    ) VALUES (
      @feedId, @guid, @title, @link, @author, @summary, @contentHtml, @contentText, @publishedAt, @crawledAt
    )
    ON CONFLICT(feed_id, guid) DO UPDATE SET
      title = excluded.title,
      link = excluded.link,
      author = excluded.author,
      summary = excluded.summary,
      content_html = COALESCE(excluded.content_html, items.content_html),
      content_text = COALESCE(excluded.content_text, items.content_text),
      published_at = COALESCE(excluded.published_at, items.published_at),
      crawled_at = COALESCE(excluded.crawled_at, items.crawled_at),
      updated_at = CURRENT_TIMESTAMP
  `);
  const updateItemContentStmt = db.prepare(`
    UPDATE items
    SET
      content_html = @contentHtml,
      content_text = @contentText,
      original_url = COALESCE(@originalUrl, original_url),
      original_title = COALESCE(@originalTitle, original_title),
      crawled_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const updateItemPageContentStmt = db.prepare(`
    UPDATE items
    SET
      page_html = @pageHtml,
      page_text = @pageText,
      page_fetched_at = CURRENT_TIMESTAMP,
      original_url = COALESCE(@originalUrl, original_url),
      original_title = COALESCE(@originalTitle, original_title),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const updateTranslationStmt = db.prepare(`
    UPDATE items
    SET
      translated_title = @translatedTitle,
      translated_text = @translatedText,
      translated_language = @translatedLanguage,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const updateSummaryStmt = db.prepare(`UPDATE items SET ai_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const updateUserFeedPreferencesStmt = db.prepare(`
    UPDATE user_feeds
    SET
      custom_title = @customTitle,
      translated_title =
        CASE
          WHEN COALESCE(custom_title, '') <> COALESCE(@customTitle, '') THEN NULL
          ELSE translated_title
        END,
      translated_language =
        CASE
          WHEN COALESCE(custom_title, '') <> COALESCE(@customTitle, '') THEN NULL
          ELSE translated_language
        END,
      translated_source_title =
        CASE
          WHEN COALESCE(custom_title, '') <> COALESCE(@customTitle, '') THEN NULL
          ELSE translated_source_title
        END,
      category = @category,
      is_archived = @isArchived,
      is_collapsed = @isCollapsed,
      translation_target_language = @translationTargetLanguage,
      auto_translate = @autoTranslate,
      display_translated = @displayTranslated,
      translation_mode = @translationMode,
      is_public = @isPublic
    WHERE user_id = @userId AND feed_id = @feedId
  `);
  const upsertUserFeedTranslationStmt = db.prepare(`
    UPDATE user_feeds
    SET
      translated_title = @translatedTitle,
      translated_language = @translatedLanguage,
      translated_source_title = @translatedSourceTitle
    WHERE user_id = @userId AND feed_id = @feedId
  `);
  const upsertUserItemReadStateStmt = db.prepare(`
    INSERT INTO user_item_states (user_id, item_id, is_read, last_opened_at)
    VALUES (@userId, @itemId, @isRead, @lastOpenedAt)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      is_read = excluded.is_read,
      last_opened_at = COALESCE(excluded.last_opened_at, user_item_states.last_opened_at),
      updated_at = CURRENT_TIMESTAMP
  `);
  const upsertUserItemReadStateBulkTx = db.transaction((entries) => {
    for (const entry of entries) {
      upsertUserItemReadStateStmt.run(entry);
    }
  });
  const upsertUserItemFavoriteStateStmt = db.prepare(`
    INSERT INTO user_item_states (user_id, item_id, is_favorited, favorited_at)
    VALUES (@userId, @itemId, @isFavorited, @favoritedAt)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      is_favorited = excluded.is_favorited,
      favorited_at = excluded.favorited_at,
      updated_at = CURRENT_TIMESTAMP
  `);
  const upsertUserItemTranslationStmt = db.prepare(`
    INSERT INTO user_item_states (user_id, item_id, translated_title, translated_text, translated_language)
    VALUES (@userId, @itemId, @translatedTitle, @translatedText, @translatedLanguage)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      translated_title = excluded.translated_title,
      translated_text = excluded.translated_text,
      translated_language = excluded.translated_language,
      updated_at = CURRENT_TIMESTAMP
  `);
  const getFeedRetentionLimitStmt = db.prepare(`
    SELECT MAX(COALESCE(p.max_saved_items, free_plan.max_saved_items)) AS keep_count
    FROM user_feeds uf
    LEFT JOIN subscriptions s ON s.user_id = uf.user_id AND s.status = 'active'
    LEFT JOIN plans p ON p.id = s.plan_id
    JOIN plans free_plan ON free_plan.code = 'free'
    WHERE uf.feed_id = ?
  `);
  const deleteFeedItemsStmt = db.prepare(`DELETE FROM items WHERE feed_id = ?`);
  const deleteOrphanFeedsStmt = db.prepare(`
    DELETE FROM feeds
    WHERE NOT EXISTS (
      SELECT 1
      FROM user_feeds uf
      WHERE uf.feed_id = feeds.id
    )
  `);
  const deleteOrphanUserItemStatesStmt = db.prepare(`
    DELETE FROM user_item_states
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_item_states.user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM items i WHERE i.id = user_item_states.item_id
    )
  `);
  const deleteOrphanItemsStmt = db.prepare(`
    DELETE FROM items
    WHERE NOT EXISTS (
      SELECT 1 FROM feeds f WHERE f.id = items.feed_id
    )
  `);
  const deleteOrphanUserFeedsStmt = db.prepare(`
    DELETE FROM user_feeds
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_feeds.user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM feeds f WHERE f.id = user_feeds.feed_id
    )
  `);
  const deleteOrphanSessionsStmt = db.prepare(`
    DELETE FROM sessions
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = sessions.user_id
    )
  `);
  const deleteOrphanUserSettingsStmt = db.prepare(`
    DELETE FROM user_settings
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = user_settings.user_id
    )
  `);
  const deleteOrphanSubscriptionsStmt = db.prepare(`
    DELETE FROM subscriptions
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = subscriptions.user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM plans p WHERE p.id = subscriptions.plan_id
    )
  `);
  const deleteOrphanBillingEventsStmt = db.prepare(`
    DELETE FROM billing_events
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = billing_events.user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM plans p WHERE p.id = billing_events.plan_id
    )
  `);
  const deleteOrphanRedeemCodeUsesStmt = db.prepare(`
    DELETE FROM redeem_code_uses
    WHERE NOT EXISTS (
      SELECT 1 FROM redeem_codes rc WHERE rc.id = redeem_code_uses.redeem_code_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = redeem_code_uses.user_id
    )
  `);
  const deleteOrphanDigestRulesStmt = db.prepare(`
    DELETE FROM digest_rules
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = digest_rules.user_id
    )
  `);
  const deleteOrphanDigestRunsStmt = db.prepare(`
    DELETE FROM digest_runs
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = digest_runs.user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM digest_rules dr WHERE dr.id = digest_runs.rule_id
    )
  `);
  const nullMissingAuditActorsStmt = db.prepare(`
    UPDATE audit_logs
    SET actor_user_id = NULL
    WHERE actor_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id = audit_logs.actor_user_id
      )
  `);
  const nullMissingRefreshActorsStmt = db.prepare(`
    UPDATE refresh_runs
    SET actor_user_id = NULL
    WHERE actor_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id = refresh_runs.actor_user_id
      )
  `);
  const pruneFeedItemsStmt = db.prepare(`
    DELETE FROM items
    WHERE id IN (
      SELECT candidate.id
      FROM items candidate
      LEFT JOIN user_item_states favorite_state
        ON favorite_state.item_id = candidate.id AND favorite_state.is_favorited = 1
      WHERE candidate.feed_id = @feedId
        AND favorite_state.id IS NULL
      ORDER BY COALESCE(candidate.published_at, candidate.created_at) DESC, candidate.id DESC
      LIMIT -1 OFFSET @keepCount
      )
  `);

  const listDigestRulesByUserStmt = db.prepare(`
    SELECT *
    FROM digest_rules
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `);
  const getDigestRuleByIdStmt = db.prepare(`SELECT * FROM digest_rules WHERE id = ?`);
  const countDigestRulesByUserStmt = db.prepare(`SELECT COUNT(*) AS count FROM digest_rules WHERE user_id = ?`);
  const createDigestRuleStmt = db.prepare(`
    INSERT INTO digest_rules (
      user_id, name, is_enabled, send_time, timezone, recipient_emails,
      ai_source, prompt, lookback_hours, unread_only, feed_scope, feed_ids_json, category
    ) VALUES (
      @userId, @name, @isEnabled, @sendTime, @timezone, @recipientEmails,
      @aiSource, @prompt, @lookbackHours, @unreadOnly, @feedScope, @feedIdsJson, @category
    )
  `);
  const updateDigestRuleStmt = db.prepare(`
    UPDATE digest_rules
    SET
      name = @name,
      is_enabled = @isEnabled,
      send_time = @sendTime,
      timezone = @timezone,
      recipient_emails = @recipientEmails,
      ai_source = @aiSource,
      prompt = @prompt,
      lookback_hours = @lookbackHours,
      unread_only = @unreadOnly,
      feed_scope = @feedScope,
      feed_ids_json = @feedIdsJson,
      category = @category,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND user_id = @userId
  `);
  const deleteDigestRuleStmt = db.prepare(`DELETE FROM digest_rules WHERE id = ? AND user_id = ?`);
  const markDigestRuleSentStmt = db.prepare(`
    UPDATE digest_rules
    SET last_sent_date = @sentDate, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const listEnabledDigestRulesStmt = db.prepare(`
    SELECT dr.*, u.email AS user_email, u.display_name AS user_display_name
    FROM digest_rules dr
    JOIN users u ON u.id = dr.user_id
    WHERE dr.is_enabled = 1 AND u.status = 'active'
    ORDER BY dr.send_time ASC, dr.id ASC
  `);
  const createDigestRunStmt = db.prepare(`
    INSERT INTO digest_runs (
      rule_id, user_id, status, started_at, finished_at, email_to,
      item_count, content, error, details_json
    ) VALUES (
      @ruleId, @userId, @status, @startedAt, @finishedAt, @emailTo,
      @itemCount, @content, @error, @detailsJson
    )
  `);
  const updateDigestRunStmt = db.prepare(`
    UPDATE digest_runs
    SET
      status = COALESCE(@status, status),
      finished_at = COALESCE(@finishedAt, finished_at),
      email_to = COALESCE(@emailTo, email_to),
      item_count = COALESCE(@itemCount, item_count),
      content = COALESCE(@content, content),
      error = COALESCE(@error, error),
      details_json = COALESCE(@detailsJson, details_json)
    WHERE id = @id
  `);
  const getDigestRunByIdStmt = db.prepare(`SELECT * FROM digest_runs WHERE id = ?`);
  const listDigestRunsByUserStmt = db.prepare(`
    SELECT r.*, dr.name AS rule_name
    FROM digest_runs r
    LEFT JOIN digest_rules dr ON dr.id = r.rule_id
    WHERE r.user_id = ?
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT ?
  `);


  return {
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
  };
}
