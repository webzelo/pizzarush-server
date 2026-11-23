import Stripe from "stripe"

import { requireRole, verifyToken } from "../middleware/auth.js"
import {
  CURRENCY,
  PREMIUM_DURATION_DAYS,
  PREMIUM_PRICE,
} from "../util.js"

/** Vendor id is the user id in every vendor route. */
const vendorIdOf = (req) => String(req.user.id ?? req.user._id)

/** Port of lib/plans.ts isPremiumActive. */
function isPremiumActive(vendor) {
  return (
    vendor &&
    vendor.plan === "premium" &&
    vendor.planExpiresAt &&
    new Date(vendor.planExpiresAt).getTime() > Date.now()
  )
}

/** Port of the frontend getSiteUrl — needs an explicit SITE_URL for API calls. */
function getSiteUrl(req) {
  const configured = (process.env.SITE_URL ?? "").trim()
  if (configured) return new URL(configured).origin

  const host = req.headers.host
  if (!host) throw new Error("Unable to determine the site URL.")

  const forwardedProtocol = String(req.headers["x-forwarded-proto"] ?? "")
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
  const protocol =
    forwardedProtocol.split(",")[0]?.trim() || (isLocal ? "http" : "https")

  return `${protocol}://${host}`
}

export function registerVendorSubscriptionRoutes(app) {
  const vendorsCollection = app.locals.db.collection("vendors")

  // — POST /api/vendor/subscription/upgrade —
  app.post(
    "/api/vendor/subscription/upgrade",
    verifyToken,
    requireRole("vendor"),
    async (req, res) => {
      const vendorId = vendorIdOf(req)

      const vendor = await vendorsCollection.findOne({ userId: vendorId })
      if (!vendor) {
        return res
          .json({ ok: false, message: "Create your restaurant profile before upgrading." })
      }

      if (isPremiumActive(vendor)) {
        return res.json({ ok: true, message: "You are already on the Premium plan." })
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.json({ ok: false, message: "Payments are not configured yet." })
      }

      try {
        const siteUrl = getSiteUrl(req)
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        const metadata = {
          userId: vendorId,
          vendorId,
          vendorDocId: vendor._id.toString(),
          plan: "premium",
        }

        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: CURRENCY.toLowerCase(),
                unit_amount: Math.round(PREMIUM_PRICE * 100),
                product_data: {
                  name: "Pizzarush Premium",
                  description: `${PREMIUM_DURATION_DAYS} days of unlimited active menu items and featured placement.`,
                },
              },
            },
          ],
          customer_email: req.user.email,
          client_reference_id: vendorId,
          metadata,
          payment_intent_data: { metadata },
          success_url: `${siteUrl}/vendor/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${siteUrl}/vendor/subscription/cancel`,
        })

        if (!checkoutSession.url) {
          return res
            .json({ ok: false, message: "Stripe did not return a checkout URL. Please try again." })
        }

        return res.json({
          ok: true,
          message: "Redirecting to secure Stripe checkout…",
          url: checkoutSession.url,
        })
      } catch (error) {
        console.error("Failed to create Stripe Checkout Session", error)
        return res.json({ ok: false, message: "Could not start checkout. Please try again." })
      }
    }
  )
}
