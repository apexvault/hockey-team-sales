import { MiddlewareRoute } from "@medusajs/medusa";
import { storeApprovalsMiddlewares } from "./approvals/middlewares";
import { storeCartsMiddlewares } from "./carts/middlewares";
import { storeCompaniesMiddlewares } from "./companies/middlewares";
import { storeFreeShippingMiddlewares } from "./free-shipping/middlewares";
import { storePaymentCollectionsMiddlewares } from "./payment-collections/middlewares";
import { storeQuotesMiddlewares } from "./quotes/middlewares";
import { storeShippingOptionsMiddlewares } from "./shipping-options/middlewares";
import { storeSearchMiddlewares } from "./search/middlewares";

export const storeMiddlewares: MiddlewareRoute[] = [
  ...storeCartsMiddlewares,
  ...storeCompaniesMiddlewares,
  ...storeQuotesMiddlewares,
  ...storeFreeShippingMiddlewares,
  ...storePaymentCollectionsMiddlewares,
  ...storeShippingOptionsMiddlewares,
  ...storeApprovalsMiddlewares,
  ...storeSearchMiddlewares,
];
