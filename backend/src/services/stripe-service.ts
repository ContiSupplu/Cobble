// ============================================================================
// Cobble QuickServers - Stripe Payment Service
// ============================================================================
// Wraps the Stripe SDK for checkout sessions, subscriptions, and webhooks.
// Each method is typed and documented with the relevant Stripe API reference.
//
// Stripe API docs: https://docs.stripe.com/api
// ============================================================================

import Stripe from 'stripe';
import {
  CheckoutConfig,
  PaymentResult,
  WebhookEvent,
  Subscription,
  ServerTier,
} from '../types';

/** Maps tier names to their Stripe price env variable keys */
const TIER_PRICE_MAP: Record<ServerTier, string> = {
  free: 'STRIPE_PRICE_FREE',
  pro: 'STRIPE_PRICE_PRO',
  pro_plus: 'STRIPE_PRICE_PROPLUS',
  pro_max: 'STRIPE_PRICE_PROMAX',
};

/**
 * Service class for Stripe payment operations.
 */
export class StripeService {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }

  // =========================================================================
  // Checkout Sessions
  // =========================================================================

  /**
   * Create a Stripe Checkout Session for a tier purchase or upgrade.
   *
   * Stripe docs: https://docs.stripe.com/api/checkout/sessions/create
   *
   * @param config - Checkout configuration with tier, user info, and URLs
   * @returns The checkout session URL and ID
   */
  async createCheckoutSession(
    config: CheckoutConfig
  ): Promise<{ url: string; sessionId: string }> {
    // TODO: Connect to Stripe API
    // const priceEnvKey = TIER_PRICE_MAP[config.tier];
    // const priceId = process.env[priceEnvKey];
    //
    // if (!priceId) {
    //   throw new Error(`No Stripe price configured for tier: ${config.tier}`);
    // }
    //
    // const session = await this.stripe.checkout.sessions.create({
    //   mode: config.tier === 'free' ? 'payment' : 'subscription',
    //   customer_email: config.email,
    //   line_items: [{ price: priceId, quantity: 1 }],
    //   success_url: config.successUrl,
    //   cancel_url: config.cancelUrl,
    //   metadata: {
    //     userId: config.userId,
    //     tier: config.tier,
    //     serverId: config.serverId || '',
    //   },
    // });
    //
    // return {
    //   url: session.url!,
    //   sessionId: session.id,
    // };

    console.log('[Stripe] Creating checkout session for tier:', config.tier);

    // Placeholder response
    return {
      url: `https://checkout.stripe.com/placeholder/${config.tier}`,
      sessionId: `cs_test_placeholder_${Date.now()}`,
    };
  }

  /**
   * Verify a completed checkout session.
   *
   * Stripe docs: https://docs.stripe.com/api/checkout/sessions/retrieve
   *
   * @param sessionId - The Stripe checkout session ID
   * @returns Payment result with tier and customer info
   */
  async verifySession(sessionId: string): Promise<PaymentResult> {
    // TODO: Connect to Stripe API
    // const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    //
    // return {
    //   success: session.payment_status === 'paid',
    //   tier: session.metadata?.tier as ServerTier,
    //   customerId: session.customer as string,
    //   subscriptionId: session.subscription as string | undefined,
    //   serverId: session.metadata?.serverId || undefined,
    // };

    console.log('[Stripe] Verifying session:', sessionId);

    // Placeholder response
    return {
      success: true,
      tier: 'pro',
      customerId: 'cus_placeholder',
      subscriptionId: 'sub_placeholder',
      serverId: undefined,
    };
  }

  // =========================================================================
  // Webhooks
  // =========================================================================

  /**
   * Construct and verify a Stripe webhook event from the raw payload.
   *
   * Stripe docs: https://docs.stripe.com/webhooks/signatures
   *
   * @param payload - Raw request body buffer
   * @param signature - Stripe-Signature header value
   * @returns Parsed webhook event
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<WebhookEvent> {
    // TODO: Connect to Stripe API
    // const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
    // const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    //
    // switch (event.type) {
    //   case 'checkout.session.completed': {
    //     const session = event.data.object as Stripe.Checkout.Session;
    //     return {
    //       type: event.type,
    //       customerId: session.customer as string,
    //       subscriptionId: session.subscription as string,
    //       tier: session.metadata?.tier as ServerTier,
    //       serverId: session.metadata?.serverId,
    //     };
    //   }
    //   case 'customer.subscription.deleted': {
    //     const sub = event.data.object as Stripe.Subscription;
    //     return {
    //       type: event.type,
    //       customerId: sub.customer as string,
    //       subscriptionId: sub.id,
    //     };
    //   }
    //   default:
    //     return { type: event.type };
    // }

    console.log('[Stripe] Handling webhook, signature:', signature.substring(0, 20) + '...');

    // Placeholder response
    return {
      type: 'checkout.session.completed',
      customerId: 'cus_placeholder',
      subscriptionId: 'sub_placeholder',
      tier: 'pro',
    };
  }

  // =========================================================================
  // Subscriptions
  // =========================================================================

  /**
   * Create a subscription for a customer.
   *
   * Stripe docs: https://docs.stripe.com/api/subscriptions/create
   *
   * @param customerId - Stripe customer ID
   * @param priceId - Stripe price ID for the tier
   * @returns Created subscription details
   */
  async createSubscription(
    customerId: string,
    priceId: string
  ): Promise<Subscription> {
    // TODO: Connect to Stripe API
    // const sub = await this.stripe.subscriptions.create({
    //   customer: customerId,
    //   items: [{ price: priceId }],
    //   payment_behavior: 'default_incomplete',
    //   expand: ['latest_invoice.payment_intent'],
    // });
    //
    // return {
    //   id: sub.id,
    //   customerId: sub.customer as string,
    //   status: sub.status,
    //   currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
    //   currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    //   cancelAtPeriodEnd: sub.cancel_at_period_end,
    //   priceId: priceId,
    // };

    console.log('[Stripe] Creating subscription for customer:', customerId);

    // Placeholder response
    return {
      id: `sub_placeholder_${Date.now()}`,
      customerId,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      priceId,
    };
  }

  /**
   * Cancel a subscription at the end of the billing period.
   *
   * Stripe docs: https://docs.stripe.com/api/subscriptions/cancel
   *
   * @param subscriptionId - Stripe subscription ID
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    // TODO: Connect to Stripe API
    // await this.stripe.subscriptions.update(subscriptionId, {
    //   cancel_at_period_end: true,
    // });

    console.log('[Stripe] Cancelling subscription:', subscriptionId);
  }
}

// ---------------------------------------------------------------------------
// Singleton export (lazily initialized from environment)
// ---------------------------------------------------------------------------

let _instance: StripeService | null = null;

/**
 * Get the shared StripeService instance.
 * Reads STRIPE_SECRET_KEY from environment on first call.
 */
export function getStripeService(): StripeService {
  if (!_instance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new Error(
        'Missing STRIPE_SECRET_KEY environment variable. ' +
        'Ensure it is set in your .env file.'
      );
    }

    _instance = new StripeService(secretKey);
  }

  return _instance;
}
