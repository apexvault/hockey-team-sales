import {
  MiddlewareRoute,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework";
import { authenticate } from "@medusajs/medusa";
import {
  attachCompanyScope,
  ensureCompanyAccess,
  ensureEmployeeInCompany,
} from "../../middlewares/ensure-company-access";
import {
  storeCompanyQueryConfig,
  storeEmployeeQueryConfig,
} from "./query-config";
import {
  StoreCreateCompany,
  StoreCreateEmployee,
  StoreGetCompanyParams,
  StoreGetEmployeeParams,
  StoreUpdateApprovalSettings,
  StoreUpdateCompany,
  StoreUpdateEmployee,
} from "./validators";

/**
 * P0-SEC-1: every exported verb under /store/companies has an explicit
 * authorization entry. Medusa registers any verb exported from a route.ts
 * whether or not a middleware entry names it, so an omission here is a live
 * unauthenticated-by-authorization hole, not a no-op.
 *
 * Verb inventory, kept in sync with the route files:
 *   /store/companies                                GET, POST
 *   /store/companies/:id                            GET, POST, DELETE
 *   /store/companies/:id/employees                  GET, POST
 *   /store/companies/:id/employees/:employeeId      GET, POST, DELETE
 *   /store/companies/:id/approval-settings          POST
 */
export const storeCompaniesMiddlewares: MiddlewareRoute[] = [
  /* All company routes require an authenticated customer, and carry the
   * caller's server-derived company scope. */
  {
    method: "ALL",
    matcher: "/store/companies*",
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      attachCompanyScope,
    ],
  },

  /* Company collection */
  {
    // Listing is scoped to the caller's own company inside the handler.
    method: ["GET"],
    matcher: "/store/companies",
    middlewares: [
      validateAndTransformQuery(
        StoreGetCompanyParams,
        storeCompanyQueryConfig.list
      ),
    ],
  },
  {
    // Company creation is the one route without a prior company: the caller
    // becomes the founding admin. The handler rejects callers who already
    // belong to a company.
    method: ["POST"],
    matcher: "/store/companies",
    middlewares: [
      validateAndTransformBody(StoreCreateCompany),
      validateAndTransformQuery(
        StoreGetCompanyParams,
        storeCompanyQueryConfig.retrieve
      ),
    ],
  },

  /* Single company */
  {
    method: ["GET"],
    matcher: "/store/companies/:id",
    middlewares: [
      ensureCompanyAccess(),
      validateAndTransformQuery(
        StoreGetCompanyParams,
        storeCompanyQueryConfig.retrieve
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/companies/:id",
    middlewares: [
      ensureCompanyAccess({ admin: true }),
      // Previously missing entirely: the handler spread raw req.body.
      validateAndTransformBody(StoreUpdateCompany),
      validateAndTransformQuery(
        StoreGetCompanyParams,
        storeCompanyQueryConfig.retrieve
      ),
    ],
  },
  {
    // Previously had NO entry, so any authenticated customer could delete any
    // company.
    method: ["DELETE"],
    matcher: "/store/companies/:id",
    middlewares: [ensureCompanyAccess({ admin: true })],
  },

  /* Employees */
  {
    method: ["GET"],
    matcher: "/store/companies/:id/employees",
    middlewares: [
      ensureCompanyAccess(),
      validateAndTransformQuery(
        StoreGetEmployeeParams,
        storeEmployeeQueryConfig.list
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/companies/:id/employees",
    middlewares: [
      ensureCompanyAccess({ admin: true }),
      validateAndTransformBody(StoreCreateEmployee),
      validateAndTransformQuery(
        StoreGetEmployeeParams,
        storeEmployeeQueryConfig.list
      ),
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/companies/:id/employees/:employeeId",
    middlewares: [
      ensureCompanyAccess(),
      ensureEmployeeInCompany(),
      validateAndTransformQuery(
        StoreGetEmployeeParams,
        storeEmployeeQueryConfig.retrieve
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/companies/:id/employees/:employeeId",
    middlewares: [
      ensureCompanyAccess({ admin: true }),
      ensureEmployeeInCompany(),
      validateAndTransformBody(StoreUpdateEmployee),
      validateAndTransformQuery(
        StoreGetEmployeeParams,
        storeEmployeeQueryConfig.retrieve
      ),
    ],
  },
  {
    // Previously had NO entry.
    method: ["DELETE"],
    matcher: "/store/companies/:id/employees/:employeeId",
    middlewares: [
      ensureCompanyAccess({ admin: true }),
      ensureEmployeeInCompany(),
    ],
  },

  /* Approval settings */
  {
    method: ["POST"],
    matcher: "/store/companies/:id/approval-settings",
    middlewares: [
      ensureCompanyAccess({ admin: true }),
      validateAndTransformBody(StoreUpdateApprovalSettings),
    ],
  },
];
