import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { createHarness } from "../test-support/api-harness.js";

test("exposes configured site domain in public config", async (t) => {
  const { request } = await createHarness(t);

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "config-admin@example.com",
      password: "12345678",
      displayName: "Config Admin"
    }
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.isAdmin, true);

  const updated = await request("/api/admin/settings/general", {
    method: "POST",
    json: {
      site_name: "Z7 Docs",
      site_domain: "https://rss.example.com"
    }
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.general.site_name, "Z7 Docs");
  assert.equal(updated.body.general.site_domain, "https://rss.example.com");

  const config = await request("/api/config");
  assert.equal(config.status, 200);
  assert.equal(config.body.siteName, "Z7 Docs");
  assert.equal(config.body.siteDomain, "rss.example.com");
  assert.equal(config.body.siteDomainRaw, "https://rss.example.com");
  assert.equal(config.body.siteUrl, "https://rss.example.com");
});

test("prefers member translation credentials over system defaults and can reset back to system", async (t) => {
  const { createClient } = await createHarness(t, {
    AI_ENABLED: "true"
  });
  const adminClient = createClient({ "user-agent": "Admin Device" });
  const memberClient = createClient({ "user-agent": "Member Device" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-translate@example.com",
      password: "12345678",
      displayName: "Admin Translate"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const systemGoogle = await adminClient.request("/api/admin/settings/translation_google", {
    method: "POST",
    json: {
      api_key: "system-google-key"
    }
  });

  assert.equal(systemGoogle.status, 200);

  const memberRegistered = await memberClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "member-translate@example.com",
      password: "12345678",
      displayName: "Member Translate"
    }
  });

  assert.equal(memberRegistered.status, 201);

  const savedGoogle = await memberClient.request("/api/account/preferences/translation-provider/google", {
    method: "POST",
    json: {
      apiKey: "member-google-key"
    }
  });

  assert.equal(savedGoogle.status, 200);
  assert.equal(savedGoogle.body.preferences.translation_google.api_key_configured, true);
  assert.equal(savedGoogle.body.account.translationProviders.google.source, "user");
  assert.equal(savedGoogle.body.account.translationProviders.google.configured, true);

  const savedBing = await memberClient.request("/api/account/preferences/translation-provider/bing", {
    method: "POST",
    json: {
      baseUrl: "https://api.cognitive.microsofttranslator.com",
      apiKey: "member-bing-key",
      region: "eastasia"
    }
  });

  assert.equal(savedBing.status, 200);
  assert.equal(savedBing.body.preferences.translation_bing.api_key_configured, true);
  assert.equal(savedBing.body.preferences.translation_bing.base_url, "https://api.cognitive.microsofttranslator.com");
  assert.equal(savedBing.body.preferences.translation_bing.region, "eastasia");
  assert.equal(savedBing.body.account.translationProviders.bing.source, "user");

  const resetGoogle = await memberClient.request("/api/account/preferences/translation-provider/google/reset", {
    method: "POST"
  });

  assert.equal(resetGoogle.status, 200);
  assert.equal(resetGoogle.body.preferences.translation_google.api_key_configured, false);
  assert.equal(resetGoogle.body.account.translationProviders.google.source, "system");
  assert.equal(resetGoogle.body.account.translationProviders.google.configured, true);
});

test("persists reader filter preferences across sessions and devices", async (t) => {
  const { createClient } = await createHarness(t);
  const primaryClient = createClient({ "user-agent": "Primary Reader Device" });
  const secondaryClient = createClient({ "user-agent": "Secondary Reader Device" });

  const registered = await primaryClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "reader-pref@example.com",
      password: "12345678",
      displayName: "Reader Pref"
    }
  });

  assert.equal(registered.status, 201);

  const loggedInSecondary = await secondaryClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "reader-pref@example.com",
      password: "12345678"
    }
  });

  assert.equal(loggedInSecondary.status, 200);

  const saved = await primaryClient.request("/api/account/preferences/reader", {
    method: "POST",
    json: {
      feedUnreadFilter: "unread",
      itemFilter: "unread"
    }
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.preferences.reader.feed_unread_filter, "unread");
  assert.equal(saved.body.preferences.reader.item_filter, "unread");
  assert.equal(saved.body.preferences.reader.feed_unread_filter_saved, true);
  assert.equal(saved.body.preferences.reader.item_filter_saved, true);

  const secondaryMe = await secondaryClient.request("/api/auth/me");
  assert.equal(secondaryMe.status, 200);
  assert.equal(secondaryMe.body.preferences.reader.feed_unread_filter, "unread");
  assert.equal(secondaryMe.body.preferences.reader.item_filter, "unread");
  assert.equal(secondaryMe.body.preferences.reader.feed_unread_filter_saved, true);
  assert.equal(secondaryMe.body.preferences.reader.item_filter_saved, true);

  const secondaryPreferences = await secondaryClient.request("/api/account/preferences");
  assert.equal(secondaryPreferences.status, 200);
  assert.equal(secondaryPreferences.body.preferences.reader.feed_unread_filter, "unread");
  assert.equal(secondaryPreferences.body.preferences.reader.item_filter, "unread");
});

test("invalidates existing sessions when an admin disables a user", async (t) => {
  const { createClient } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Device" });
  const userClient = createClient({ "user-agent": "User Device" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-disable@example.com",
      password: "12345678",
      displayName: "Admin Disable"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const userRegistered = await userClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "disabled-user@example.com",
      password: "12345678",
      displayName: "Disabled User"
    }
  });

  assert.equal(userRegistered.status, 201);
  const userId = userRegistered.body.user.id;

  const accessibleBefore = await userClient.request("/api/account/preferences");
  assert.equal(accessibleBefore.status, 200);

  const disabled = await adminClient.request(`/api/admin/users/${userId}`, {
    method: "POST",
    json: {
      status: "disabled"
    }
  });

  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.status, "disabled");

  const meAfter = await userClient.request("/api/auth/me");
  assert.equal(meAfter.status, 200);
  assert.equal(meAfter.body.authenticated, false);

  const accessibleAfter = await userClient.request("/api/account/preferences");
  assert.equal(accessibleAfter.status, 401);
  assert.equal(accessibleAfter.body.code, "auth_required");

  const freshClient = createClient();
  const relogin = await freshClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "disabled-user@example.com",
      password: "12345678"
    }
  });

  assert.equal(relogin.status, 403);
  assert.equal(relogin.body.code, "account_disabled");
});

test("allows admin to delete a user and revokes all of their access", async (t) => {
  const { createClient } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Delete Console" });
  const primaryUserClient = createClient({ "user-agent": "Delete Primary Device" });
  const secondaryUserClient = createClient({ "user-agent": "Delete Secondary Device" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-delete@example.com",
      password: "12345678",
      displayName: "Admin Delete"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const userRegistered = await primaryUserClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "delete-target@example.com",
      password: "12345678",
      displayName: "Delete Target"
    }
  });

  assert.equal(userRegistered.status, 201);
  const userId = userRegistered.body.user.id;

  const secondaryLogin = await secondaryUserClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "delete-target@example.com",
      password: "12345678"
    }
  });

  assert.equal(secondaryLogin.status, 200);

  const deleted = await adminClient.request(`/api/admin/users/${userId}`, {
    method: "DELETE"
  });

  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.user.email, "delete-target@example.com");

  const meAfter = await primaryUserClient.request("/api/auth/me");
  assert.equal(meAfter.status, 200);
  assert.equal(meAfter.body.authenticated, false);

  const secondaryAfter = await secondaryUserClient.request("/api/account/preferences");
  assert.equal(secondaryAfter.status, 401);
  assert.equal(secondaryAfter.body.code, "auth_required");

  const freshClient = createClient();
  const relogin = await freshClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "delete-target@example.com",
      password: "12345678"
    }
  });

  assert.equal(relogin.status, 401);
  assert.equal(relogin.body.code, "invalid_credentials");

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.ok(!dashboard.body.users.some((entry) => entry.id === userId));
  assert.ok(dashboard.body.auditLogs.length >= 1);
  assert.equal(dashboard.body.auditLogs[0].action, "admin.user.deleted");
  assert.equal(dashboard.body.auditLogs[0].target_type, "user");
  assert.equal(dashboard.body.auditLogs[0].target_id, String(userId));
  assert.equal(dashboard.body.auditLogs[0].details.email, "delete-target@example.com");
});

test("prevents admin from deleting the current logged-in account", async (t) => {
  const { createClient } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Self Delete Console" });

  const registered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-self-delete@example.com",
      password: "12345678",
      displayName: "Admin Self Delete"
    }
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.isAdmin, true);

  const blocked = await adminClient.request(`/api/admin/users/${registered.body.user.id}`, {
    method: "DELETE"
  });

  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.code, "cannot_delete_current_user");

  const me = await adminClient.request("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.authenticated, true);

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.users.some((entry) => entry.id === registered.body.user.id));
});

test("allows admin to inspect and revoke a specific user session", async (t) => {
  const { createClient } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Console" });
  const primaryUserClient = createClient({ "user-agent": "User Primary Device" });
  const secondaryUserClient = createClient({ "user-agent": "User Secondary Device" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-security@example.com",
      password: "12345678",
      displayName: "Admin Security"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const userRegistered = await primaryUserClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "session-target@example.com",
      password: "12345678",
      displayName: "Session Target"
    }
  });

  assert.equal(userRegistered.status, 201);
  const userId = userRegistered.body.user.id;

  const secondaryLogin = await secondaryUserClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "session-target@example.com",
      password: "12345678"
    }
  });

  assert.equal(secondaryLogin.status, 200);

  const security = await adminClient.request(`/api/admin/users/${userId}/security`);
  assert.equal(security.status, 200);
  assert.equal(security.body.user.email, "session-target@example.com");
  assert.ok(Array.isArray(security.body.sessions));
  assert.equal(security.body.sessions.length, 2);

  const secondarySession = security.body.sessions.find((entry) => entry.userAgent === "User Secondary Device");
  assert.ok(secondarySession);

  const revoked = await adminClient.request(`/api/admin/users/${userId}/sessions/${secondarySession.id}/revoke`, {
    method: "POST"
  });

  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.revokedCount, 1);
  assert.equal(revoked.body.sessions.length, 1);
  assert.ok(!revoked.body.sessions.some((entry) => entry.id === secondarySession.id));

  const secondaryAfter = await secondaryUserClient.request("/api/account/preferences");
  assert.equal(secondaryAfter.status, 401);
  assert.equal(secondaryAfter.body.code, "auth_required");

  const primaryAfter = await primaryUserClient.request("/api/account/preferences");
  assert.equal(primaryAfter.status, 200);
});

test("allows admin to reset a user's password and revoke all active sessions", async (t) => {
  const { createClient } = await createHarness(t);
  const adminClient = createClient({ "user-agent": "Admin Reset Console" });
  const primaryUserClient = createClient({ "user-agent": "Reset Primary Device" });
  const secondaryUserClient = createClient({ "user-agent": "Reset Secondary Device" });

  const adminRegistered = await adminClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "admin-reset@example.com",
      password: "12345678",
      displayName: "Admin Reset"
    }
  });

  assert.equal(adminRegistered.status, 201);
  assert.equal(adminRegistered.body.user.isAdmin, true);

  const userRegistered = await primaryUserClient.request("/api/auth/register", {
    method: "POST",
    json: {
      email: "password-target@example.com",
      password: "12345678",
      displayName: "Password Target"
    }
  });

  assert.equal(userRegistered.status, 201);
  const userId = userRegistered.body.user.id;

  const secondaryLogin = await secondaryUserClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "password-target@example.com",
      password: "12345678"
    }
  });

  assert.equal(secondaryLogin.status, 200);

  const reset = await adminClient.request(`/api/admin/users/${userId}/password`, {
    method: "POST",
    json: {
      newPassword: "87654321",
      revokeSessions: true
    }
  });

  assert.equal(reset.status, 200);
  assert.equal(reset.body.revokedCount, 2);
  assert.equal(reset.body.sessions.length, 0);

  const primaryAfter = await primaryUserClient.request("/api/account/preferences");
  assert.equal(primaryAfter.status, 401);
  assert.equal(primaryAfter.body.code, "auth_required");

  const secondaryAfter = await secondaryUserClient.request("/api/account/preferences");
  assert.equal(secondaryAfter.status, 401);
  assert.equal(secondaryAfter.body.code, "auth_required");

  const oldPasswordClient = createClient();
  const oldPasswordLogin = await oldPasswordClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "password-target@example.com",
      password: "12345678"
    }
  });

  assert.equal(oldPasswordLogin.status, 401);
  assert.equal(oldPasswordLogin.body.code, "invalid_credentials");

  const newPasswordClient = createClient();
  const newPasswordLogin = await newPasswordClient.request("/api/auth/login", {
    method: "POST",
    json: {
      email: "password-target@example.com",
      password: "87654321"
    }
  });

  assert.equal(newPasswordLogin.status, 200);

  const dashboard = await adminClient.request("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.ok(
    dashboard.body.auditLogs.some(
      (entry) => entry.action === "admin.user.password.reset" && entry.target_id === String(userId)
    )
  );
});

test("syncs stripe subscription lifecycle into local billing state", async (t) => {
  const webhookSecret = "whsec_test_lifecycle";
  const { request } = await createHarness(t, {
    AI_ENABLED: "true",
    BILLING_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "sk_test_lifecycle",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly"
  });

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "stripe-user@example.com",
      password: "12345678",
      displayName: "Stripe User"
    }
  });

  assert.equal(registered.status, 201);
  const userId = String(registered.body.user.id);

  async function sendStripeEvent(event) {
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret
    });
    return request("/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature
      },
      body: payload
    });
  }

  const completed = await sendStripeEvent({
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_completed",
        object: "checkout.session",
        client_reference_id: "cs_local_test_1",
        customer: "cus_test_1",
        subscription: "sub_test_1",
        payment_status: "paid",
        metadata: {
          userId,
          planCode: "pro",
          checkoutSessionId: "cs_local_test_1"
        }
      }
    }
  });

  assert.equal(completed.status, 200);

  const updated = await sendStripeEvent({
    id: "evt_subscription_updated",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "active",
        current_period_start: 1710000000,
        current_period_end: 1712592000,
        metadata: {
          userId,
          planCode: "pro",
          checkoutSessionId: "cs_local_test_1"
        }
      }
    }
  });

  assert.equal(updated.status, 200);

  const invoicePaid = await sendStripeEvent({
    id: "evt_invoice_paid",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_test_paid_1",
        object: "invoice",
        customer: "cus_test_1",
        subscription: "sub_test_1",
        amount_paid: 2900,
        currency: "usd",
        lines: {
          data: [
            {
              period: {
                start: 1710000000,
                end: 1712592000
              }
            }
          ]
        },
        parent: {
          subscription_details: {
            subscription: "sub_test_1",
            metadata: {
              userId,
              planCode: "pro",
              checkoutSessionId: "cs_local_test_1"
            }
          }
        }
      }
    }
  });

  assert.equal(invoicePaid.status, 200);

  const activeOverview = await request("/api/billing/overview");
  assert.equal(activeOverview.status, 200);
  assert.equal(activeOverview.body.account.plan.code, "pro");
  assert.equal(activeOverview.body.account.subscription.provider_subscription_id, "sub_test_1");
  assert.equal(activeOverview.body.account.features.translation, true);
  assert.ok(activeOverview.body.billingEvents.some((entry) => entry.provider_checkout_id === "cs_local_test_1"));
  assert.ok(activeOverview.body.billingEvents.some((entry) => entry.provider_checkout_id === "in_test_paid_1"));

  const deleted = await sendStripeEvent({
    id: "evt_subscription_deleted",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_1",
        object: "subscription",
        customer: "cus_test_1",
        status: "canceled",
        current_period_start: 1710000000,
        current_period_end: 1712592000,
        metadata: {
          userId,
          planCode: "pro",
          checkoutSessionId: "cs_local_test_1"
        }
      }
    }
  });

  assert.equal(deleted.status, 200);

  const canceledOverview = await request("/api/billing/overview");
  assert.equal(canceledOverview.status, 200);
  assert.equal(canceledOverview.body.account.subscription.status, "canceled");
  assert.equal(canceledOverview.body.account.plan.code, "free");
  assert.equal(canceledOverview.body.account.features.translation, false);
});

test("registers users, persists sessions, and rejects duplicate emails", async (t) => {
  const { request } = await createHarness(t);

  const invalid = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "invalid-email",
      password: "12345678",
      displayName: "Tester"
    }
  });

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "bad_request");

  const registered = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "tester@example.com",
      password: "12345678",
      displayName: "Tester"
    }
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.email, "tester@example.com");
  assert.equal(registered.body.account.plan.code, "free");

  const me = await request("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.authenticated, true);
  assert.equal(me.body.user.email, "tester@example.com");

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "tester@example.com",
      password: "12345678",
      displayName: "Tester 2"
    }
  });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "email_taken");
  assert.equal(duplicate.body.error, "该邮箱已注册");
});

test("validates feed creation and item list query parameters", async (t) => {
  const { request } = await createHarness(t);

  await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "feeds@example.com",
      password: "12345678",
      displayName: "Feeds"
    }
  });

  const invalidFeed = await request("/api/feeds", {
    method: "POST",
    json: {
      title: "Bad Feed",
      url: "not-a-url"
    }
  });

  assert.equal(invalidFeed.status, 400);
  assert.equal(invalidFeed.body.code, "bad_request");
  assert.match(invalidFeed.body.error, /格式无效/);

  const invalidItemsQuery = await request("/api/items?limit=500");
  assert.equal(invalidItemsQuery.status, 400);
  assert.equal(invalidItemsQuery.body.code, "bad_request");

  const invalidFeedPreference = await request("/api/feeds/not-a-number/preferences", {
    method: "POST",
    json: {
      customTitle: "Hello",
      category: null,
      isArchived: false,
      isCollapsed: false,
      targetLanguage: null,
      autoTranslate: null,
      displayTranslated: null,
      translationMode: null
    }
  });

  assert.equal(invalidFeedPreference.status, 400);
  assert.equal(invalidFeedPreference.body.code, "bad_request");
});

test("returns JSON 404 for unknown API routes", async (t) => {
  const { request } = await createHarness(t);
  const response = await request("/api/not-found");

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "not_found");
  assert.equal(response.body.error, "接口不存在");
});

test("sets baseline security headers on API responses", async (t) => {
  const { request } = await createHarness(t);
  const response = await request("/api/config");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("marks session cookies as Secure when app url is https", async (t) => {
  const { request } = await createHarness(t, {
    APP_URL: "https://rss.example.com"
  });

  const response = await request("/api/auth/register", {
    method: "POST",
    json: {
      email: "secure@example.com",
      password: "12345678",
      displayName: "Secure User"
    }
  });

  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie") || "", /;\s*Secure(?:;|$)/);
  assert.match(response.headers.get("strict-transport-security") || "", /max-age=/);
});

test("rate limits repeated authentication attempts", async (t) => {
  const { request } = await createHarness(t, {
    RATE_LIMIT_AUTH_MAX: "2",
    RATE_LIMIT_AUTH_WINDOW_MS: "60000"
  });

  const first = await request("/api/auth/login", {
    method: "POST",
    json: {
      email: "nobody@example.com",
      password: "12345678"
    }
  });
  const second = await request("/api/auth/login", {
    method: "POST",
    json: {
      email: "nobody@example.com",
      password: "12345678"
    }
  });
  const third = await request("/api/auth/login", {
    method: "POST",
    json: {
      email: "nobody@example.com",
      password: "12345678"
    }
  });

  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 429);
  assert.equal(third.body.code, "auth_rate_limited");
  assert.match(third.body.error, /频繁/);
  assert.ok(Number(third.headers.get("retry-after")) >= 1);
});
