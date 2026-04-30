import express from "express";

function getGeneralSettings(store) {
  return (store?.listSettings?.() || [])
    .filter((entry) => entry.category === "general")
    .reduce((acc, row) => {
      acc[row.key] = String(row.value || "").trim();
      return acc;
    }, {});
}

function getTranslationProviderSettings(store, category) {
  return (store?.listSettings?.() || [])
    .filter((entry) => entry.category === category)
    .reduce((acc, row) => {
      acc[row.key] = String(row.value || "").trim();
      return acc;
    }, {});
}

function normalizePublicSiteUrl(rawValue, fallbackUrl) {
  const raw = String(rawValue || "").trim();
  if (raw) {
    try {
      const parsed = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
      return parsed.toString().replace(/\/+$/, "");
    } catch (_error) {
      // Fall through to APP_URL.
    }
  }

  try {
    return new URL(fallbackUrl).toString().replace(/\/+$/, "");
  } catch (_error) {
    return String(fallbackUrl || "").trim().replace(/\/+$/, "");
  }
}

function extractPublicDomain(rawValue, siteUrl) {
  const raw = String(rawValue || "").trim();
  if (raw) {
    if (!/^https?:\/\//i.test(raw)) {
      return raw.replace(/\/+$/, "");
    }
    try {
      return new URL(raw).host;
    } catch (_error) {
      return raw.replace(/\/+$/, "");
    }
  }

  try {
    return new URL(siteUrl).host;
  } catch (_error) {
    return "";
  }
}

function normalizeQueryLimit(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function createSystemRouter({ config, billingService, store, feedService }) {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    const general = getGeneralSettings(store);
    const siteUrl = normalizePublicSiteUrl(general.site_domain, config.appUrl);
    const deeplxSettings = getTranslationProviderSettings(store, "translation_deeplx");
    res.json({
      appName: config.appName,
      appUrl: config.appUrl,
      siteName: general.site_name || config.appName,
      siteDomain: extractPublicDomain(general.site_domain, siteUrl),
      siteDomainRaw: String(general.site_domain || "").trim(),
      siteUrl,
      aiEnabled: config.aiEnabled,
      deeplxConfigured: Boolean(deeplxSettings.base_url),
      refreshIntervalMinutes: config.refreshMinutes,
      billingProvider: config.billingProvider,
      stripeEnabled: Boolean(config.stripeSecretKey),
      plans: billingService.listPlans()
    });
  });

  router.get("/plaza", (req, res) => {
    const limit = normalizeQueryLimit(req.query?.limit, 24, 1, 120);
    const itemLimit = normalizeQueryLimit(req.query?.itemLimit, 3, 1, 10);
    res.json({
      feeds: feedService.listPublicFeedPlaza(req.auth?.user?.id || null, { limit, itemLimit })
    });
  });

  return router;
}
