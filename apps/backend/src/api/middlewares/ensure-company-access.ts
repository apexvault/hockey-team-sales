import {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaResponse,
} from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ApprovalType } from "../../types/approval";

/**
 * The single server-side company/tenant authorization boundary.
 *
 * Design rules (P0-SEC-1). Every guard in this file obeys all of them:
 *
 *  1. The caller's company is ALWAYS derived from the authenticated identity
 *     (auth_context -> customer -> employee -> company). A company id supplied in
 *     the URL, query or body is treated as an untrusted *claim* that must match
 *     the derived value -- never as proof of membership.
 *  2. Admin authority comes from the `employee.is_admin` domain field, not from
 *     `provider_identity.user_metadata.role`. That metadata is a denormalised
 *     copy written by a separate code path, is not company-scoped, and can be
 *     corrupted by workflow compensation. It is no longer an authorization input.
 *  3. Company-admin authority is scoped to the caller's own company only.
 *  4. Absence of data fails CLOSED. A missing membership, missing company,
 *     missing provider identity or unexpected shape yields 403, never a pass and
 *     never an unhandled 500.
 *  5. Denials are uniform: 403 `{ message: "Forbidden" }` with no detail, so a
 *     caller cannot use the response to probe which companies or resources
 *     exist. Existence is itself protected data.
 */

export type CompanyMembership = {
  customerId: string;
  employeeId: string;
  companyId: string;
  isCompanyAdmin: boolean;
};

/** Request decorated with the trusted, server-derived company scope. */
export type CompanyScopedRequest = AuthenticatedMedusaRequest & {
  company_id?: string;
  employee_id?: string;
  is_company_admin?: boolean;
  company_membership?: CompanyMembership | null;
};

const MEMBERSHIP_CACHE_KEY = "__company_membership_resolved";

const forbid = (res: MedusaResponse) =>
  res.status(403).json({ message: "Forbidden" });

/**
 * Extract the authenticated customer id. Medusa populates `actor_id` for the
 * customer actor; `app_metadata.customer_id` is the equivalent used elsewhere in
 * this codebase. Accept either, trust neither the path nor the body.
 */
export const getAuthenticatedCustomerId = (
  req: AuthenticatedMedusaRequest
): string | null => {
  const authContext = req.auth_context;

  if (!authContext || authContext.actor_type !== "customer") {
    return null;
  }

  const fromAppMetadata = (
    authContext.app_metadata as { customer_id?: string } | undefined
  )?.customer_id;

  return authContext.actor_id || fromAppMetadata || null;
};

/**
 * Resolve the caller's verified company membership.
 *
 * Returns null when the caller is unauthenticated, is not a customer, has no
 * employee record, or that employee is not attached to a company. Soft-deleted
 * employees and companies are excluded by Medusa's query layer, so a revoked
 * membership resolves to null -- which is what "active" means here.
 *
 * The result is memoised on the request so a chain of guards costs one query.
 */
export const resolveCompanyMembership = async (
  req: CompanyScopedRequest
): Promise<CompanyMembership | null> => {
  if (req[MEMBERSHIP_CACHE_KEY as keyof typeof req]) {
    return req.company_membership ?? null;
  }

  const customerId = getAuthenticatedCustomerId(req);

  if (!customerId) {
    (req as any)[MEMBERSHIP_CACHE_KEY] = true;
    req.company_membership = null;
    return null;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  let customer: any;

  try {
    const { data } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "employee.id",
        "employee.is_admin",
        "employee.company.id",
      ],
      filters: { id: customerId },
    });
    customer = data?.[0];
  } catch {
    // A query failure must not become an implicit grant.
    (req as any)[MEMBERSHIP_CACHE_KEY] = true;
    req.company_membership = null;
    return null;
  }

  const employee = customer?.employee;
  const companyId = employee?.company?.id;

  if (!employee?.id || !companyId) {
    (req as any)[MEMBERSHIP_CACHE_KEY] = true;
    req.company_membership = null;
    return null;
  }

  const membership: CompanyMembership = {
    customerId,
    employeeId: employee.id,
    companyId,
    // Coerced explicitly: a null/undefined is_admin must never read as admin.
    isCompanyAdmin: employee.is_admin === true,
  };

  (req as any)[MEMBERSHIP_CACHE_KEY] = true;
  req.company_membership = membership;
  req.company_id = membership.companyId;
  req.employee_id = membership.employeeId;
  req.is_company_admin = membership.isCompanyAdmin;

  return membership;
};

/**
 * Attach the caller's company scope without requiring one.
 *
 * Use on routes that authenticated non-company customers may legitimately use
 * (carts, quotes). Downstream handlers read `req.company_id` and must treat
 * `undefined` as "no company", never as "any company".
 */
export const attachCompanyScope = async (
  req: CompanyScopedRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  try {
    await resolveCompanyMembership(req);
  } catch {
    req.company_membership = null;
  }
  return next();
};

/**
 * Require that the caller is a verified member of the company named in the path.
 *
 * @param options.admin  also require company-admin authority (scoped to that company)
 * @param options.param  route param holding the company id (default "id")
 *
 * A company with zero employees grants nothing: no membership resolves, so the
 * guard denies. There is deliberately no bootstrap branch here -- the founding
 * employee is created server-side inside createCompaniesWorkflow.
 */
export const ensureCompanyAccess = (
  options: { admin?: boolean; param?: string } = {}
) => {
  const { admin = false, param = "id" } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const membership = await resolveCompanyMembership(req);

      if (!membership) {
        return forbid(res);
      }

      const requestedCompanyId = req.params?.[param];

      // The path claim must match the derived company exactly. A missing or
      // malformed param fails closed rather than matching everything.
      if (!requestedCompanyId || requestedCompanyId !== membership.companyId) {
        return forbid(res);
      }

      if (admin && !membership.isCompanyAdmin) {
        return forbid(res);
      }

      return next();
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Require company-admin authority without a company id in the path.
 * The company is taken solely from the membership.
 */
export const ensureCompanyAdmin = () => {
  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const membership = await resolveCompanyMembership(req);

      if (!membership || !membership.isCompanyAdmin) {
        return forbid(res);
      }

      return next();
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Require that the employee named in the path belongs to the caller's company.
 *
 * Closes the hole where `/store/companies/:id/employees/:employeeId` ignored the
 * company segment and acted on any employee id in the system.
 */
export const ensureEmployeeInCompany = (
  options: { param?: string } = {}
) => {
  const { param = "employeeId" } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const membership = await resolveCompanyMembership(req);

      if (!membership) {
        return forbid(res);
      }

      const employeeId = req.params?.[param];

      if (!employeeId) {
        return forbid(res);
      }

      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

      const { data } = await query.graph({
        entity: "employee",
        fields: ["id", "company.id"],
        filters: { id: employeeId },
      });

      const targetCompanyId = data?.[0]?.company?.id;

      if (!targetCompanyId || targetCompanyId !== membership.companyId) {
        return forbid(res);
      }

      return next();
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Require that the cart named in the path is not another customer's.
 *
 * POLICY (settled in P0-SEC-7): **a cart belongs to one customer, not to a
 * company.** An earlier version also admitted any member of the cart owner's
 * company. That branch became unreachable once `ensureCartNotOwnedByAnother`
 * was registered ahead of this guard on the whole `/store/carts/:id` surface,
 * which left two guards asserting contradictory policies with the stricter one
 * winning by ordering accident — so a later change to the matcher would have
 * silently restored the looser rule.
 *
 * The company branch is therefore removed rather than left dead. A teammate has
 * no business editing another member's basket; company-level authority is
 * exercised through the approval flow (`/store/approvals/:id`), which is
 * company-scoped by design and unaffected by this.
 *
 * Guest carts (no customer) are left to core Medusa.
 */
export const ensureCartAccess = (options: { param?: string } = {}) => {
  const { param = "id" } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const customerId = getAuthenticatedCustomerId(req);

      if (!customerId) {
        return forbid(res);
      }

      const cartId = req.params?.[param];

      if (!cartId) {
        return forbid(res);
      }

      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "customer_id", "company.id"],
        filters: { id: cartId },
      });

      const cart = data?.[0];

      if (!cart) {
        return forbid(res);
      }

      if (cart.customer_id && cart.customer_id === customerId) {
        return next();
      }

      /**
       * An anonymous cart has no owner to protect, so it is allowed through.
       *
       * Be honest that this is a LOOSENING relative to the previous version of
       * this guard, which denied it: a caller can now bulk-add to an unclaimed
       * cart they did not create. It is consistent with core -- the non-bulk
       * `/store/carts/:id/line-items` already permits exactly this -- and the
       * cart-freeze vector P0-SEC-1 worried about is not reachable, because
       * creating an approval on an anonymous cart fails with "No enabled
       * approval types found" (no company, so no approval types apply).
       *
       * The alternative is to deny here and let `ensureCartNotOwnedByAnother`
       * own anonymous carts, at the cost of refusing an authenticated shopper
       * bulk-adding to a cart they have not yet claimed. Chosen deliberately in
       * favour of not breaking that flow.
       */
      if (!cart.customer_id) {
        return next();
      }

      return forbid(res);
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Refuse any cart that already belongs to a *different* account holder.
 *
 * P0-SEC-7. Core's `POST /store/carts/:id/customer` passes `req.params.id`
 * straight into `transferCartCustomerWorkflow` and then returns the full
 * refetched cart, so possession of a cart id was sufficient authority to claim
 * somebody else's basket **and read its contents**. Every other
 * `/store/carts/:id*` route had the same shape: the id was the only credential.
 *
 * Why this is not simply `ensureCartAccess`: a guest cart has no customer and no
 * company, so requiring ownership would break anonymous shopping and the
 * anonymous → authenticated transition that P0-SEC-1 just repaired. Medusa's
 * model is that for an *unclaimed* cart the id legitimately is the bearer token.
 * The rule that holds in both worlds is narrower:
 *
 *   allow  - the cart has no customer at all (anonymous), or
 *   allow  - the cart's customer is a guest record (`has_account === false`),
 *            which is precisely the claimable state, or
 *   allow  - the cart's customer IS the caller (idempotent re-claim, normal use)
 *   deny   - anything else: it belongs to another account holder
 *
 * Core's own transfer workflow queries `customer.has_account` and then never
 * uses it, which suggests upstream intended this check and did not finish it.
 *
 * Applied to the whole `/store/carts/:id` surface rather than just the transfer
 * route, because "claim, transfer or inspect" are all reachable through it and
 * fixing one verb would leave the same hole on the others.
 */
export const ensureCartNotOwnedByAnother = (
  options: {
    param?: string;
    /**
     * Where the cart id comes from. A cart id is just as much a claim of
     * authority in a request body or query string as it is in a path, and the
     * first version of this guard only covered paths -- which left
     * `POST /store/quotes` ({ cart_id }) able to dump another team's entire
     * basket, and `/store/free-shipping/prices?cart_id=` able to do it
     * unauthenticated. The cause is "cart id treated as authority", not
     * "`/store/carts/**` is unguarded".
     */
    source?: "params" | "body" | "query";
  } = {}
) => {
  const { param = "id", source = "params" } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const container =
        source === "body"
          ? ((req as any).validatedBody ?? req.body)
          : source === "query"
            ? ((req as any).validatedQuery ?? req.query)
            : req.params;

      const cartId = container?.[param];

      if (!cartId || typeof cartId !== "string") {
        return forbid(res);
      }

      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "customer_id", "customer.id", "customer.has_account"],
        filters: { id: cartId },
      });

      const cart = data?.[0];

      // An unknown cart is refused with the same uniform denial as a forbidden
      // one, so the endpoint cannot be used to test which cart ids exist.
      if (!cart) {
        return forbid(res);
      }

      const owner = (cart as any).customer;
      const ownerId = owner?.id ?? cart.customer_id;

      // Anonymous cart -- unclaimed, the id is the bearer by design.
      if (!ownerId) {
        return next();
      }

      /**
       * Guest customer record: still claimable.
       *
       * Be precise about what this permits, because the obvious reading is
       * wrong. It does NOT cover "unclaimed" carts -- those have no customer at
       * all and took the branch above. Medusa attaches a `has_account: false`
       * customer the moment a guest enters their email during checkout, so this
       * branch's real scope is **guest carts that already contain PII**: email,
       * shipping address, and for this product a player's name and number.
       *
       * It is load-bearing: without it, every guest shopper is refused on their
       * own cart at the next request, and the anonymous-to-authenticated
       * transition breaks. Medusa has no session-bound cart, so for a guest the
       * cart id genuinely is the only credential that exists.
       *
       * Residual risk, accepted and recorded (F-42): anyone who obtains a guest
       * cart id can read that basket and claim it. Closing it properly needs a
       * server-set cart nonce, or requiring a claimant's authenticated email to
       * match `cart.email`. Tracked rather than silently tolerated.
       */
      if (owner && owner.has_account === false) {
        return next();
      }

      const callerId = getAuthenticatedCustomerId(req);

      if (callerId && callerId === ownerId) {
        return next();
      }

      return forbid(res);
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Require that the approval named in the path belongs to a cart owned by the
 * caller's company, and that the caller is a company admin of that company.
 *
 * Also forbids self-approval: the employee who raised the request cannot be the
 * one who decides it.
 */
export const ensureApprovalAccess = (options: { param?: string } = {}) => {
  const { param = "id" } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const membership = await resolveCompanyMembership(req);

      if (!membership || !membership.isCompanyAdmin) {
        return forbid(res);
      }

      const approvalId = req.params?.[param];

      if (!approvalId) {
        return forbid(res);
      }

      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

      const { data } = await query.graph({
        entity: "approval",
        fields: ["id", "cart_id", "created_by", "type", "status"],
        filters: { id: approvalId },
      });

      const approval = data?.[0];

      if (!approval?.cart_id) {
        return forbid(res);
      }

      // Preserved from the former `ensureApprovalType` helper: the store
      // surface only ever decides ADMIN approvals. SALES_MANAGER approvals
      // belong to staff and have no store-side actor today.
      if ((approval.type as unknown as ApprovalType) !== ApprovalType.ADMIN) {
        return forbid(res);
      }

      const { data: cartData } = await query.graph({
        entity: "cart",
        fields: ["id", "company.id"],
        filters: { id: approval.cart_id },
      });

      const cartCompanyId = (cartData?.[0] as any)?.company?.id;

      if (!cartCompanyId || cartCompanyId !== membership.companyId) {
        return forbid(res);
      }

      /**
       * Four-eyes, but only where four eyes exist.
       *
       * An unconditional self-approval ban deadlocks a single-admin team: only
       * company admins can decide approvals, the requester is the cart owner,
       * and there is no store route to withdraw a PENDING approval -- so a
       * founding coach who is their team's only admin could request approval on
       * their own cart and then never clear it. Turning the requirement back
       * off does not help, because a PENDING record blocks completion on its
       * own. The cart would be permanently un-completable.
       *
       * So the ban applies only when the company actually has another admin who
       * could decide it. Separation of duties is preserved wherever it is
       * achievable, and never at the cost of bricking checkout.
       */
      if (
        approval.created_by &&
        approval.created_by === membership.customerId
      ) {
        const { data: admins } = await query.graph({
          entity: "employee",
          fields: ["id", "is_admin"],
          filters: { company_id: membership.companyId },
        });

        const otherAdminExists = (admins ?? []).some(
          (employee: any) =>
            employee?.is_admin === true && employee?.id !== membership.employeeId
        );

        if (otherAdminExists) {
          return forbid(res);
        }
      }

      return next();
    } catch {
      return forbid(res);
    }
  };
};

/**
 * Require that the quote named in the path belongs to the caller.
 *
 * Read access: the owning customer, or a company admin of the owner's company
 * (so a team admin can oversee their team's quotes).
 *
 * Write access (`ownerOnly: true`): the owning customer only. Accepting a quote
 * converts a draft into a live, payable order, and rejecting one destroys an
 * in-flight negotiation -- neither should be possible on somebody else's quote,
 * even a teammate's.
 */
export const ensureQuoteAccess = (
  options: { param?: string; ownerOnly?: boolean } = {}
) => {
  const { param = "id", ownerOnly = false } = options;

  return async (
    req: CompanyScopedRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const customerId = getAuthenticatedCustomerId(req);

      if (!customerId) {
        return forbid(res);
      }

      const quoteId = req.params?.[param];

      if (!quoteId) {
        return forbid(res);
      }

      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

      const { data } = await query.graph({
        entity: "quote",
        fields: ["id", "customer_id"],
        filters: { id: quoteId },
      });

      const quote = data?.[0];

      if (!quote?.customer_id) {
        return forbid(res);
      }

      if (quote.customer_id === customerId) {
        return next();
      }

      if (ownerOnly) {
        return forbid(res);
      }

      // Read-only fallback: company admins may view their own company's quotes.
      const membership = await resolveCompanyMembership(req);

      if (!membership || !membership.isCompanyAdmin) {
        return forbid(res);
      }

      const { data: ownerData } = await query.graph({
        entity: "customer",
        fields: ["id", "employee.company.id"],
        filters: { id: quote.customer_id },
      });

      const ownerCompanyId = ownerData?.[0]?.employee?.company?.id;

      if (!ownerCompanyId || ownerCompanyId !== membership.companyId) {
        return forbid(res);
      }

      return next();
    } catch {
      return forbid(res);
    }
  };
};
