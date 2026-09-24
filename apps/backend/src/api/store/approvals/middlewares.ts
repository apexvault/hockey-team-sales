import {
  authenticate,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import {
  attachCompanyScope,
  ensureApprovalAccess,
  ensureCompanyAdmin,
} from "../../middlewares/ensure-company-access";
import { approvalTransformQueryConfig } from "./query-config";
import { StoreGetApprovals, StoreUpdateApproval } from "./validators";

/**
 * P0-SEC-1.
 *
 * Previously the `ALL /store/approvals*` entry applied `ensureRole("company_admin")`
 * globally. That matcher has no `:id` segment, so `ensureRole` read
 * `req.params.id === undefined` and issued an unfiltered company query -- which
 * returned an arbitrary company rather than none. If that company happened to
 * have no employees, the old bootstrap branch granted access to every caller on
 * every request.
 *
 * The role check is now split:
 *   - collection routes use `ensureCompanyAdmin`, which reads no path param at
 *     all and derives the company purely from the caller's membership;
 *   - `POST /store/approvals/:id` additionally uses `ensureApprovalAccess`,
 *     which resolves approval -> cart -> company and requires it to match the
 *     caller's company, and forbids self-approval.
 *
 * The old `ensureApprovalType` helper is folded into `ensureApprovalAccess`,
 * which returns a uniform 403 rather than distinguishing "not found" from
 * "forbidden" -- the previous 404 let a caller probe which approval ids exist.
 */
export const storeApprovalsMiddlewares: MiddlewareRoute[] = [
  {
    method: "ALL",
    matcher: "/store/approvals*",
    middlewares: [
      authenticate("customer", ["session", "bearer"]),
      attachCompanyScope,
    ],
  },
  {
    method: ["GET"],
    matcher: "/store/approvals",
    middlewares: [
      ensureCompanyAdmin(),
      validateAndTransformQuery(
        StoreGetApprovals,
        approvalTransformQueryConfig
      ),
    ],
  },
  {
    method: ["POST"],
    matcher: "/store/approvals/:id",
    middlewares: [
      ensureApprovalAccess(),
      validateAndTransformBody(StoreUpdateApproval),
    ],
  },
];
