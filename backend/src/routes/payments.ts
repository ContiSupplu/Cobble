// ============================================================================
// Cobble QuickServers - Payment Routes
// ============================================================================
// Handles Stripe checkout sessions, webhook events, and server billing
// operations (extend time, upgrade tier).
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getStripeService } from '../services/stripe-service';
import { ApiResponse, CheckoutConfig, PaymentResult, ServerTier } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/payments/checkout/create-session
// ---------------------------------------------------------------------------
// Create a Stripe Checkout Session for a tier purchase.
// Requires: Bearer token
// Body: { tier, successUrl, cancelUrl, serverId? }
// ---------------------------------------------------------------------------
router.post(
  '/checkout/create-session',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const { tier, successUrl, cancelUrl, serverId } = req.body as {
        tier: ServerTier;
        successUrl: string;
        cancelUrl: string;
        serverId?: string;
      };

      // Validate required fields
      if (!tier || !successUrl || !cancelUrl) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: tier, successUrl, cancelUrl',
        } satisfies ApiResponse);
        return;
      }

      // Validate tier
      const validTiers: ServerTier[] = ['free', 'pro', 'pro_plus', 'pro_max'];
      if (!validTiers.includes(tier)) {
        res.status(400).json({
          success: false,
          error: `Invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}`,
        } satisfies ApiResponse);
        return;
      }

      const config: CheckoutConfig = {
        tier,
        userId: user.userId,
        email: user.email,
        serverId,
        successUrl,
        cancelUrl,
      };

      // TODO: Connect to Stripe API
      const stripeService = getStripeService();
      const session = await stripeService.createCheckoutSession(config);

      res.status(200).json({
        success: true,
        data: session,
      } satisfies ApiResponse<{ url: string; sessionId: string }>);
    } catch (error) {
      console.error('[Payments] Create checkout session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create checkout session',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/payments/webhooks/stripe
// ---------------------------------------------------------------------------
// Handle incoming Stripe webhook events.
// NOTE: This endpoint must receive the RAW body (not JSON parsed).
// The server.ts configures express.raw() for this route.
// ---------------------------------------------------------------------------
router.post(
  '/webhooks/stripe',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string;

      if (!signature) {
        res.status(400).json({
          success: false,
          error: 'Missing Stripe signature header',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Connect to Stripe API
      const stripeService = getStripeService();
      const event = await stripeService.handleWebhook(req.body as Buffer, signature);

      console.log(`[Payments] Webhook received: ${event.type}`);

      // Process the webhook event
      switch (event.type) {
        case 'checkout.session.completed':
          // TODO: Update server status in database
          // TODO: Provision server if new purchase
          console.log('[Payments] Checkout completed:', {
            customerId: event.customerId,
            tier: event.tier,
            serverId: event.serverId,
          });
          break;

        case 'customer.subscription.deleted':
          // TODO: Mark server as expired in database
          // TODO: Schedule server cleanup
          console.log('[Payments] Subscription cancelled:', {
            customerId: event.customerId,
            subscriptionId: event.subscriptionId,
          });
          break;

        case 'invoice.payment_failed':
          // TODO: Notify user of failed payment
          // TODO: Set server to suspended state
          console.log('[Payments] Payment failed:', {
            customerId: event.customerId,
          });
          break;

        default:
          console.log(`[Payments] Unhandled webhook event: ${event.type}`);
      }

      // Always acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('[Payments] Webhook error:', error);
      res.status(400).json({
        success: false,
        error: 'Webhook processing failed',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/payments/checkout/verify/:sessionId
// ---------------------------------------------------------------------------
// Verify a completed checkout session (called after redirect from Stripe).
// Requires: Bearer token
// ---------------------------------------------------------------------------
router.get(
  '/checkout/verify/:sessionId',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'Session ID is required',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Connect to Stripe API
      const stripeService = getStripeService();
      const result = await stripeService.verifySession(sessionId);

      if (!result.success) {
        res.status(402).json({
          success: false,
          error: 'Payment was not completed',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Update server record in database with payment info

      res.status(200).json({
        success: true,
        data: result,
      } satisfies ApiResponse<PaymentResult>);
    } catch (error) {
      console.error('[Payments] Verify session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify payment session',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/payments/servers/:id/extend
// ---------------------------------------------------------------------------
// Extend a server's active time (for free-tier time-limited servers).
// Requires: Bearer token
// Body: { hours }
// ---------------------------------------------------------------------------
router.post(
  '/servers/:id/extend',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { hours } = req.body as { hours: number };

      if (!hours || hours < 1) {
        res.status(400).json({
          success: false,
          error: 'Hours must be a positive number',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Verify user owns this server
      // TODO: Check if extension is allowed for the server's tier
      // TODO: Create Stripe payment for extension
      // TODO: Update server expiry in database

      console.log(`[Payments] Extending server ${id} by ${hours} hours`);

      res.status(200).json({
        success: true,
        data: {
          serverId: id,
          hoursAdded: hours,
          newExpiresAt: new Date(
            Date.now() + hours * 60 * 60 * 1000
          ).toISOString(),
        },
        message: `Server extended by ${hours} hours`,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('[Payments] Extend server error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to extend server time',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/payments/servers/:id/upgrade
// ---------------------------------------------------------------------------
// Upgrade a server to a higher tier.
// Requires: Bearer token
// Body: { newTier, successUrl, cancelUrl }
// ---------------------------------------------------------------------------
router.post(
  '/servers/:id/upgrade',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const { newTier, successUrl, cancelUrl } = req.body as {
        newTier: ServerTier;
        successUrl: string;
        cancelUrl: string;
      };

      // Validate
      if (!newTier || !successUrl || !cancelUrl) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: newTier, successUrl, cancelUrl',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Verify user owns this server
      // TODO: Verify new tier is higher than current tier
      // TODO: Create Stripe checkout session for upgrade (proration)

      const stripeService = getStripeService();
      const session = await stripeService.createCheckoutSession({
        tier: newTier,
        userId: user.userId,
        email: user.email,
        serverId: id,
        successUrl,
        cancelUrl,
      });

      res.status(200).json({
        success: true,
        data: session,
        message: `Upgrade checkout created for tier: ${newTier}`,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('[Payments] Upgrade server error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create upgrade session',
      } satisfies ApiResponse);
    }
  }
);

export default router;
