import {
  authenticate,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import {
  attachCompanyScope,
  ensureCartNotOwnedByAnother,
  ensureQuoteAccess,
} from "../../middlewares/ensure-company-access";
import {
  listQuotesTransformQueryConfig,
  retrieveQuoteTransformQueryConfig,
} from "./query-config";
import {
  AcceptQuote,
  CreateQuote,
  GetQuoteParams,
  RejectQuote,
  StoreCreateQuoteMessage,
} from "./validators";

export const storeQuotesMiddlewares: MiddlewareRoute[] = [
  {
    method: "ALL",
    matcher: "/store/quotes*",
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      attachCompanyScope,
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/quotes",
    middlewares: [
      validateAndTransformQuery(GetQuoteParams, listQuotesTransformQueryConfig),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/quotes",
    middlewares: [
      validateAndTransformBody(CreateQuote),
      // S-1. createRequestForQuoteWorkflow reads the cart at `cart_id` with
      // items.*, shipping_address.* and billing_address.*, then builds a draft
      // order carrying them under the CALLER's customer_id. The resulting quote
      // is legitimately the caller's, so ensureQuoteAccess waves them through on
      // read -- meaning a rival team could turn a cart id into a full dump of
      // another team's basket, addresses and per-unit pricing, with the victim
      // never notified. Validated body first, so the guard reads a parsed value.
      ensureCartNotOwnedByAnother({ param: "cart_id", source: "body" }),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/quotes/:id",
    middlewares: [
      ensureQuoteAccess(),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/quotes/:id/accept",
    middlewares: [
      ensureQuoteAccess({ ownerOnly: true }),
      validateAndTransformBody(AcceptQuote),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/quotes/:id/reject",
    middlewares: [
      ensureQuoteAccess({ ownerOnly: true }),
      validateAndTransformBody(RejectQuote),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/quotes/:id/preview",
    middlewares: [
      ensureQuoteAccess(),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/quotes/:id/messages",
    middlewares: [
      ensureQuoteAccess({ ownerOnly: true }),
      validateAndTransformBody(StoreCreateQuoteMessage),
      validateAndTransformQuery(
        GetQuoteParams,
        retrieveQuoteTransformQueryConfig
      ),
    ],
  },
];
