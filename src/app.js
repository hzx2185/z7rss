import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createAccessControlLayer } from "./middleware/auth.js";
import { errorHandler, notFoundHandler, route } from "./lib/routes.js";
import { createSecurityHeadersMiddleware } from "./lib/security-headers.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAccountRouter } from "./routes/account.js";
import { createBillingRouter, handleBillingWebhook } from "./routes/billing.js";
import { createFeedRouter } from "./routes/feeds.js";
import { createGoogleReaderRouter } from "./routes/google-reader.js";
import { createItemRouter } from "./routes/items.js";
import { createSystemRouter } from "./routes/system.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "../public");

function isVersionedAsset(assetPath = "") {
  const normalizedPath = String(assetPath || "");
  if (!normalizedPath || normalizedPath === "/") return false;
  if (/[?&]v=\w+/i.test(normalizedPath)) return true;
  return /\.[a-f0-9]{8,}\./i.test(normalizedPath);
}

function setStaticAssetCacheHeaders(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const requestPath = String(res.req?.originalUrl || res.req?.url || "");
  const isHtml = extension === ".html";
  const isStaticAsset = Boolean(extension) && !isHtml;
  if (isHtml) {
    res.setHeader("Cache-Control", "no-cache");
    return;
  }
  if (!isStaticAsset) return;

  if (isVersionedAsset(requestPath)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
}

export function createApp({
  config,
  store,
  authService,
  accountService,
  feedService,
  itemService,
  digestService,
  billingService,
  adminService,
  aiConfigService,
  mailService,
  opmlBackupService
}) {
  const app = express();
  const accessControl = createAccessControlLayer({ authService, adminService, config });

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(compression({ threshold: 1024 }));

  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json" }),
    route((req, res) => handleBillingWebhook(req, res, billingService))
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(createSecurityHeadersMiddleware(config));
  app.use(accessControl.identify);
  app.use(accessControl.denyBlockedIp);
  app.use(accessControl.requireSameOriginForCookieWrites);
  app.use(express.static(publicDir, {
    etag: true,
    lastModified: true,
    setHeaders: setStaticAssetCacheHeaders
  }));

  app.use("/api", createSystemRouter({ config, billingService, store, feedService }));
  app.use("/api/auth", createAuthRouter({ authService, accountService, config }));
  app.use("/api/account", accessControl.requireAuth, createAccountRouter({ accountService, aiConfigService, authService, config, digestService, feedService, mailService, opmlBackupService }));
  app.use("/api/feeds", accessControl.requireAuth, createFeedRouter({ feedService, config }));
  app.use("/api/items", accessControl.requireAuth, createItemRouter({ itemService, config }));
  app.use("/api/billing", accessControl.requireAuth, createBillingRouter({ billingService, adminService }));
  app.use("/api/admin", accessControl.requireAdmin, createAdminRouter({ adminService, aiConfigService, config }));
  app.use(createGoogleReaderRouter({ authService, feedService, itemService, store }));
  app.use("/api", notFoundHandler);

  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use(errorHandler);

  return app;
}
