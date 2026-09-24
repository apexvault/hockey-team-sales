import { validateAndTransformQuery } from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import { ensureCartNotOwnedByAnother } from "../../middlewares/ensure-company-access";
import { StoreGetFreeShippingPricesParams } from "./validators";

/**
 * P0-SEC-7 / F-36.
 *
 * `GET /store/free-shipping/prices?cart_id=…` had no authentication and no cart
 * check: the route fetches the named cart with `throwIfKeyNotFound: true`, so a
 * real id returned 200 and an unknown id returned 404 — a clean cart-existence
 * oracle for anyone holding the (public) publishable key. Worse,
 * `computeShippingOptionTargets` derives its output from `cart.item_total`, so
 * the response leaks how much is in another team's basket.
 *
 * The same rule as the rest of the cart surface now applies: possession of a
 * cart id is not authority over that cart, wherever the id appears — path, body
 * or query string.
 */
export const storeFreeShippingMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET"],
    matcher: "/store/free-shipping/prices",
    middlewares: [
      validateAndTransformQuery(StoreGetFreeShippingPricesParams, {
        defaultLimit: 20,
        isList: true,
      }),
      ensureCartNotOwnedByAnother({ param: "cart_id", source: "query" }),
    ],
  },
];
