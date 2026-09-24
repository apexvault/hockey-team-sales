import { MiddlewareRoute } from "@medusajs/medusa";
import { ensureCartNotOwnedByAnother } from "../../middlewares/ensure-company-access";

/**
 * P0-SEC-7 / F-36 (continued).
 *
 * `GET /store/shipping-options?cart_id=…` is the same cart-existence oracle as
 * `/store/free-shipping/prices` -- both call `listShippingOptionsForCartWorkflow`
 * on a caller-supplied `cart_id`, and this one is the more direct route of the
 * two. Unauthenticated, with only the public publishable key, it returned 200
 * for a real cart and a 404 that **echoed the probed id back** for an unknown
 * one. Guarding the free-shipping route while leaving this open would have made
 * "F-36 fixed" untrue.
 *
 * `POST /store/shipping-options/:id/calculate` takes `cart_id` in the body and
 * is guarded by symmetry. It could not be exercised locally (the seed defines no
 * calculated shipping options), so it is guarded rather than left pending a
 * proof-of-concept -- the cost of guarding is a query, the cost of being wrong
 * is another oracle.
 *
 * Anonymous and guest carts pass, so guest checkout -- which calls this route
 * with an unclaimed cart -- is unaffected.
 */
export const storeShippingOptionsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/store/shipping-options",
    middlewares: [
      ensureCartNotOwnedByAnother({ param: "cart_id", source: "query" }),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/shipping-options/:id/calculate",
    middlewares: [
      ensureCartNotOwnedByAnother({ param: "cart_id", source: "body" }),
    ],
  },
];
