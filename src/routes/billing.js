import express from "express";
import { route } from "../lib/routes.js";
import { expectObject, parseTrimmedString } from "../lib/validation.js";

export async function handleBillingWebhook(req, res, billingService) {
  const result = await billingService.handleWebhook(req.headers["stripe-signature"], req.body);
  res.json(result);
}

export function createBillingRouter({ billingService, adminService }) {
  const router = express.Router();

  router.get("/overview", (req, res) => {
    res.json(billingService.getBillingOverview(req.auth.user));
  });

  router.post("/checkout", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const result = await billingService.createCheckout(
      req.auth.user,
      parseTrimmedString(body.planCode, "套餐代码", { required: true, maxLength: 32 }).toLowerCase()
    );
    res.json(result);
  }));

  router.post("/redeem", route(async (req, res) => {
    const body = expectObject(req.body || {});
    const account = adminService.redeemCodeForUser(
      req.auth.user.id,
      parseTrimmedString(body.code, "兑换码", { required: true, maxLength: 64 })
    );
    res.json(account);
  }));

  return router;
}
