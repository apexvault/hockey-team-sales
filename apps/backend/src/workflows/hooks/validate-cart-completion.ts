import { completeCartWorkflow } from "@medusajs/core-flows";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import {
  assertCartApprovalSatisfied,
  resolveApprovalSettings,
} from "../../utils/assert-cart-approval";
import { checkSpendingLimit } from "../../utils/check-spending-limit";

/**
 * Server-side gate on cart completion (P0-SEC-1).
 *
 * Previously this hook asked only "is there a PENDING approval record on this
 * cart?". It never asked "does this company require approval at all?". The
 * decision to create an approval lived entirely in a React branch
 * (payment-button/index.tsx), so a caller who simply never posted to
 * /store/carts/:id/approvals and went straight to /complete checked out with
 * zero approvals in existence -- the check passed precisely because nothing had
 * been requested.
 *
 * The rule is now inverted to fail closed: if the cart's company requires
 * approval, a matching APPROVED approval must exist. Absence is a hard failure.
 */
completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "approvals.*",
      "customer_id",
      "total",
      "completed_at",
      "company.id",
      "company.approval_settings.*",
    ],
    filters: {
      id: cart.id,
    },
  });

  const queryCart = data?.[0];

  // A missing cart must not fall through to an unhandled TypeError (which
  // surfaced as a 500 rather than a refusal).
  if (!queryCart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Cart not found"
    );
  }

  let customer: any = null;

  if (queryCart.customer_id) {
    const { data: customerData } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "employee.spending_limit",
        // Without these the spend window and prior spend were always empty, so
        // `spent` was always 0 and the limit only ever compared a single cart
        // total -- a $500 cap permitted unlimited $499 orders.
        "employee.company.spending_limit_reset_frequency",
        "employee.company.approval_settings.*",
        "orders.total",
        "orders.created_at",
      ],
      filters: {
        id: queryCart.customer_id,
      },
    });

    customer = customerData?.[0];
  }

  /**
   * Resolve the approval settings that actually govern this cart.
   *
   * The cart->company LINK is not a reliable source on its own. It is created
   * by the cartCreated hook, which only fires at creation and only when the
   * cart already has a customer. A shopper who adds to cart while logged out
   * and then signs in gets their customer attached by transferCartCustomer --
   * a workflow that exposes only a `validate` hook, so nothing re-links the
   * cart afterwards. That cart reaches checkout with no company link at all.
   *
   * Relying on the link alone therefore left the original bypass intact for an
   * entirely ordinary browse-then-log-in flow: no link, no settings, nothing to
   * enforce. Falling back to the customer's own employee record makes the
   * guarantee independent of how and when the cart was created.
   */
  const approvalSettings = resolveApprovalSettings(
    (queryCart as any).company?.approval_settings,
    customer?.employee?.company?.approval_settings
  );

  // Approval rule lives in a pure, unit-tested function so the security
  // property is verifiable without a full checkout fixture.
  assertCartApprovalSatisfied({
    approvals: (queryCart as any).approvals,
    company: { approval_settings: approvalSettings },
  });

  // Spending limit, evaluated against actual prior spend.
  if (customer?.employee?.spending_limit) {
    const spendLimitExceeded = checkSpendingLimit(
      queryCart as any,
      customer as any
    );

    if (spendLimitExceeded) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cart total exceeds spending limit"
      );
    }
  }

  return new StepResponse(undefined, null);
});
