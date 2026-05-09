import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createAuthMiddleware } from "./middleware/auth.js";
import { forbidden } from "./lib/errors.js";
import { errorHandler, notFoundHandler, route } from "./lib/routes.js";
import { getRequestIp } from "./lib/request.js";
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
  const authMiddleware = createAuthMiddleware({ authService, config });

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
  app.use(authMiddleware.attachCurrentUser);
  app.use((req, res, next) => {
    const requestIp = getRequestIp(req);
    if (adminService.isBlockedIp(requestIp)) {
      return next(forbidden("当前 IP 已被系统屏蔽", { code: "ip_blocked" }));
    }
    next();
  });
  app.use(express.static(path.join(__dirname, "../public")));

  app.use("/api", createSystemRouter({ config, billingService, store, feedService }));
  app.use("/api/auth", createAuthRouter({ authService, accountService, config }));
  app.use("/api/account", authMiddleware.requireAuth, createAccountRouter({ accountService, aiConfigService, authService, config, digestService, feedService, mailService, opmlBackupService }));
  app.use("/api/feeds", authMiddleware.requireAuth, createFeedRouter({ feedService, config }));
  app.use("/api/items", authMiddleware.requireAuth, createItemRouter({ itemService, config }));
  app.use("/api/billing", authMiddleware.requireAuth, createBillingRouter({ billingService, adminService }));
  app.use("/api/admin", authMiddleware.requireAdmin, createAdminRouter({ adminService, aiConfigService, config }));
  app.use(createGoogleReaderRouter({ authService, feedService, itemService, store }));
  app.use("/api", notFoundHandler);

  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  app.use(errorHandler);

  return app;
}
