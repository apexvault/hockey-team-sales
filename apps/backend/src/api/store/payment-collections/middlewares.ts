import { MiddlewareRoute } from "@medusajs/medusa";
import { ensureCartNotOwnedByAnother } from "../../middlewares/ensure-company-access";

/**
 * P0-SEC-7 / S-2.
 *
 * Core's `POST /store/payment-collections` takes `{ cart_id }` from the body
 * with no authentication and no ownership check. Two problems, both confirmed
 * against a running server:
 *
 *   1. The response carries `amount` — the victim's basket total — and is
 *      reachable with the *public* publishable key and no Authorization header
 *      at all.
 *   2. The call CREATES a payment collection on the victim's cart: attacker-
 *      triggered state on somebody else's checkout.
 *
 * `defaultPaymentCollectionFields` also exposes `*payment_sessions`, and the
 * allowed extra fields include `payment_sessions.data` — the provider intent
 * payload.
 *
 * Guarded with the same rule as every other cart-id-keyed surface. Anonymous
 * and guest carts still pass, so ordinary guest checkout is unaffected; only a
 * cart already owned by a different account holder is refused.
 */
export const storePaymentCollectionsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/store/payment-collections",
    middlewares: [
      ensureCartNotOwnedByAnother({ param: "cart_id", source: "body" }),
    ],
  },
];
