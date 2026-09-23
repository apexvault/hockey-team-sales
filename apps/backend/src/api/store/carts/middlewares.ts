import {
  authenticate,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import {
  attachCompanyScope,
  ensureCartAccess,
} from "../../middlewares/ensure-company-access";
import { retrieveCartTransformQueryConfig } from "./query-config";
import {
  GetCartLineItemsBulkParams,
  StoreAddLineItemsBulk,
} from "./validators";

/**
 * P0-SEC-1.
 *
 * `POST /store/carts/:id/line-items/bulk` previously had no `authenticate` at
 * all -- the entry directly below it did, which shows the omission was
 * per-entry rather than inherited. The framework default for `/store/*` is
 * `allowUnauthenticated: true`, so anyone holding the (public) publishable key
 * and a cart id could inject line items.
 *
 * `POST /store/carts/:id/approvals` authenticated but never checked that the
 * cart belonged to the caller. Because a pending approval makes all three cart
 * hooks throw, any caller could permanently freeze any team's checkout.
 *
 * Both now require authentication and cart ownership.
 */
export const storeCartsMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST"],
    matcher: "/store/carts/:id/line-items/bulk",
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      attachCompanyScope,
      ensureCartAccess(),
      validateAndTransformBody(StoreAddLineItemsBulk),
      validateAndTransformQuery(
        GetCartLineItemsBulkParams,
        retrieveCartTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/carts/:id/approvals",
    middlewares: [
      authenticate("customer", ["bearer", "session"]),
      attachCompanyScope,
      ensureCartAccess(),
    ],
  },
];
