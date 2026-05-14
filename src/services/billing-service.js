import { badRequest, notFound, serviceUnavailable } from "../lib/errors.js";

const BILLING_ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function extractId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    return new Date(numeric * 1000).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getInvoicePeriods(invoice) {
  const primaryLine = Array.isArray(invoice?.lines?.data) ? invoice.lines.data[0] : null;
  return {
    start: normalizeTimestamp(primaryLine?.period?.start),
    end: normalizeTimestamp(primaryLine?.period?.end)
  };
}

export function createBillingService({ store, accountService, config, feedService }) {
  const hasStripe = Boolean(config.stripeSecretKey);
  let stripeClientPromise = null;

  async function getStripeClient() {
    if (!hasStripe) return null;
    if (!stripeClientPromise) {
      stripeClientPromise = import("stripe").then(({ default: Stripe }) => new Stripe(config.stripeSecretKey));
    }
    return stripeClientPromise;
  }

  function createPeriodEnd(days = 30) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  function ensureBillingEvent(event) {
    if (!event?.providerCheckoutId) {
      return null;
    }

    const existing = store.getBillingEventByCheckoutId(event.providerCheckoutId);
    if (existing) {
      store.updateBillingEventStatus(event.providerCheckoutId, event.status, event.checkoutUrl ?? null);
      return store.getBillingEventByCheckoutId(event.providerCheckoutId);
    }

    store.createBillingEvent({
      userId: event.userId,
      planId: event.planId,
      provider: event.provider || "stripe",
      providerCheckoutId: event.providerCheckoutId,
      status: event.status,
      amountCents: Number(event.amountCents || 0),
      currency: String(event.currency || "usd"),
      checkoutUrl: event.checkoutUrl ?? null
    });
    return store.getBillingEventByCheckoutId(event.providerCheckoutId);
  }

  async function activatePlanForUser(userId, planCode, provider, checkoutId = null, options = {}) {
    const plan = store.getPlanByCode(planCode);
    if (!plan) {
      throw notFound("Plan not found");
    }

    const subscription = store.setUserSubscription({
      userId,
      planId: plan.id,
      status: options.status || "active",
      provider,
      providerCustomerId: options.providerCustomerId ?? null,
      providerSubscriptionId: options.providerSubscriptionId ?? checkoutId,
      currentPeriodStart: options.currentPeriodStart || new Date().toISOString(),
      currentPeriodEnd:
        options.currentPeriodEnd === undefined ? (plan.price_monthly_cents > 0 ? createPeriodEnd() : null) : options.currentPeriodEnd
    });

    if (checkoutId) {
      ensureBillingEvent({
        userId,
        planId: plan.id,
        provider,
        providerCheckoutId: checkoutId,
        status: options.billingStatus || "paid",
        amountCents: plan.price_monthly_cents,
        currency: "usd",
        checkoutUrl: options.checkoutUrl ?? null
      });
    }

    if (feedService) {
      feedService.pruneFeedsForUser(userId);
    }

    return subscription;
  }

  function findLocalSubscription({ providerSubscriptionId = null, providerCustomerId = null }) {
    if (providerSubscriptionId) {
      const bySubscriptionId = store.getUserSubscriptionByProviderSubscriptionId(providerSubscriptionId);
      if (bySubscriptionId) return bySubscriptionId;
    }
    if (providerCustomerId) {
      const byCustomerId = store.getUserSubscriptionByProviderCustomerId(providerCustomerId);
      if (byCustomerId) return byCustomerId;
    }
    return null;
  }

  function syncStripeSubscription(payload = {}) {
    const providerSubscriptionId = extractId(payload.providerSubscriptionId);
    const providerCustomerId = extractId(payload.providerCustomerId);
    const existing = findLocalSubscription({ providerSubscriptionId, providerCustomerId });

    const metadata = payload.metadata || {};
    const userId = Number(existing?.user_id || metadata.userId || 0);
    const planCode = String(payload.planCode || metadata.planCode || existing?.plan_code || "").trim().toLowerCase();

    if (!userId || !planCode) {
      if (payload.required) {
        throw badRequest("Missing Stripe metadata", { code: "stripe_metadata_missing" });
      }
      return null;
    }

    const plan = store.getPlanByCode(planCode);
    if (!plan) {
      if (payload.required) {
        throw badRequest("Missing Stripe metadata", { code: "stripe_metadata_missing" });
      }
      return null;
    }

    const subscription = store.setUserSubscription({
      userId,
      planId: plan.id,
      status: String(payload.status || existing?.status || "active"),
      provider: "stripe",
      providerCustomerId: providerCustomerId || existing?.provider_customer_id || null,
      providerSubscriptionId: providerSubscriptionId || existing?.provider_subscription_id || null,
      currentPeriodStart: payload.currentPeriodStart || existing?.current_period_start || new Date().toISOString(),
      currentPeriodEnd:
        payload.currentPeriodEnd === undefined
          ? existing?.current_period_end || (plan.price_monthly_cents > 0 ? createPeriodEnd() : null)
          : payload.currentPeriodEnd
    });

    if (feedService) {
      feedService.pruneFeedsForUser(userId);
    }

    return subscription;
  }

  return {
    listPlans() {
      return store.listPlans();
    },
    getBillingOverview(user) {
      return {
        account: accountService.getAccount(user),
        plans: store.listPlans(),
        billingEvents: store.listBillingEvents(user.id),
        stripeEnabled: hasStripe
      };
    },
    async createCheckout(user, planCode) {
      const plan = store.getPlanByCode(planCode);
      if (!plan) {
        throw notFound("Plan not found");
      }

      if (plan.code === "free") {
        await activatePlanForUser(user.id, plan.code, "system", "free-plan");
        return { mode: "system", activated: true };
      }

      if (!hasStripe || !plan.stripe_price_id || config.billingProvider === "demo") {
        await activatePlanForUser(user.id, plan.code, "demo", `demo_${Date.now()}`);
        return {
          mode: "demo",
          activated: true,
          message: "Demo 模式下已直接开通套餐"
        };
      }

      const checkoutReference = `cs_local_${Date.now()}_${user.id}`;
      const stripe = await getStripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        success_url: `${config.appUrl}/?checkout=success&plan=${plan.code}`,
        cancel_url: `${config.appUrl}/?checkout=cancel`,
        customer_email: user.email,
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        client_reference_id: checkoutReference,
        subscription_data: {
          metadata: {
            userId: String(user.id),
            planCode: plan.code,
            checkoutSessionId: checkoutReference
          }
        },
        metadata: {
          userId: String(user.id),
          planCode: plan.code,
          checkoutSessionId: checkoutReference
        }
      });

      ensureBillingEvent({
        userId: user.id,
        planId: plan.id,
        provider: "stripe",
        providerCheckoutId: checkoutReference,
        status: "pending",
        amountCents: plan.price_monthly_cents,
        currency: "usd",
        checkoutUrl: session.url
      });

      return {
        mode: "stripe",
        activated: false,
        checkoutUrl: session.url
      };
    },
    async handleWebhook(signature, payloadBuffer) {
      if (!hasStripe || !config.stripeWebhookSecret) {
        throw serviceUnavailable("Stripe webhook is not configured", { code: "stripe_unavailable" });
      }

      const stripe = await getStripeClient();
      const event = stripe.webhooks.constructEvent(payloadBuffer, signature, config.stripeWebhookSecret);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const billingReference = session.metadata?.checkoutSessionId || session.client_reference_id || session.id;
        const subscription = syncStripeSubscription({
          metadata: session.metadata,
          providerSubscriptionId: session.subscription,
          providerCustomerId: session.customer,
          status: session.payment_status === "paid" ? "active" : "incomplete",
          required: true
        });

        if (subscription) {
          ensureBillingEvent({
            userId: subscription.user_id,
            planId: subscription.plan_id,
            provider: "stripe",
            providerCheckoutId: billingReference,
            status: session.payment_status === "paid" ? "paid" : String(session.payment_status || "pending"),
            amountCents: subscription.price_monthly_cents,
            currency: "usd"
          });
        }
      }

      if (event.type === "checkout.session.async_payment_failed") {
        const session = event.data.object;
        const billingReference = session.metadata?.checkoutSessionId || session.client_reference_id || session.id;
        store.updateBillingEventStatus(billingReference, "payment_failed");
      }

      if (event.type === "checkout.session.expired") {
        const session = event.data.object;
        const billingReference = session.metadata?.checkoutSessionId || session.client_reference_id || session.id;
        store.updateBillingEventStatus(billingReference, "expired");
      }

      if (event.type === "invoice.payment_succeeded") {
        const invoice = event.data.object;
        const periods = getInvoicePeriods(invoice);
        const subscription = syncStripeSubscription({
          metadata: invoice.parent?.subscription_details?.metadata || {},
          providerSubscriptionId: invoice.subscription || invoice.parent?.subscription_details?.subscription,
          providerCustomerId: invoice.customer,
          status: "active",
          currentPeriodStart: periods.start,
          currentPeriodEnd: periods.end,
          required: false
        });

        if (subscription) {
          ensureBillingEvent({
            userId: subscription.user_id,
            planId: subscription.plan_id,
            provider: "stripe",
            providerCheckoutId: invoice.id,
            status: "paid",
            amountCents: Number(invoice.amount_paid ?? invoice.amount_due ?? 0),
            currency: String(invoice.currency || "usd")
          });
        }

        const initialCheckoutReference = invoice.parent?.subscription_details?.metadata?.checkoutSessionId;
        if (initialCheckoutReference) {
          store.updateBillingEventStatus(initialCheckoutReference, "paid");
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;
        const subscription = syncStripeSubscription({
          metadata: invoice.parent?.subscription_details?.metadata || {},
          providerSubscriptionId: invoice.subscription || invoice.parent?.subscription_details?.subscription,
          providerCustomerId: invoice.customer,
          status: "past_due",
          required: false
        });

        if (subscription) {
          ensureBillingEvent({
            userId: subscription.user_id,
            planId: subscription.plan_id,
            provider: "stripe",
            providerCheckoutId: invoice.id,
            status: "payment_failed",
            amountCents: Number(invoice.amount_due ?? 0),
            currency: String(invoice.currency || "usd")
          });
        }

        const initialCheckoutReference = invoice.parent?.subscription_details?.metadata?.checkoutSessionId;
        if (initialCheckoutReference) {
          store.updateBillingEventStatus(initialCheckoutReference, "payment_failed");
        }
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object;
        syncStripeSubscription({
          metadata: subscription.metadata,
          providerSubscriptionId: subscription.id,
          providerCustomerId: subscription.customer,
          status: subscription.status,
          currentPeriodStart: normalizeTimestamp(subscription.current_period_start),
          currentPeriodEnd: normalizeTimestamp(subscription.current_period_end),
          required: false
        });

        const checkoutReference = subscription.metadata?.checkoutSessionId;
        if (checkoutReference) {
          const billingStatus = BILLING_ACTIVE_STATUSES.has(subscription.status) ? "paid" : String(subscription.status || "updated");
          store.updateBillingEventStatus(checkoutReference, billingStatus);
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        syncStripeSubscription({
          metadata: subscription.metadata,
          providerSubscriptionId: subscription.id,
          providerCustomerId: subscription.customer,
          status: "canceled",
          currentPeriodStart: normalizeTimestamp(subscription.current_period_start),
          currentPeriodEnd: normalizeTimestamp(subscription.current_period_end),
          required: false
        });

        const checkoutReference = subscription.metadata?.checkoutSessionId;
        if (checkoutReference) {
          store.updateBillingEventStatus(checkoutReference, "canceled");
        }
      }

      return { received: true, type: event.type };
    }
  };
}
