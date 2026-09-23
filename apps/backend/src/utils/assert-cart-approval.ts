import { MedusaError } from "@medusajs/framework/utils";
import { ApprovalStatusType, ApprovalType } from "../types/approval";

export type ApprovalLike = {
  type?: string | null;
  status?: string | null;
};

export type ApprovalSettingsLike = {
  requires_admin_approval?: boolean | null;
  requires_sales_manager_approval?: boolean | null;
} | null | undefined;

export type CartApprovalInput = {
  approvals?: (ApprovalLike | null | undefined)[] | null;
  company?: { approval_settings?: ApprovalSettingsLike } | null;
};

/**
 * Choose the approval settings that govern a cart.
 *
 * The cart->company link cannot be the only source. `cartCreated` fires once,
 * at creation, and only when the cart already has a customer; a shopper who
 * browses logged out and signs in later has their customer attached by
 * `transferCartCustomer`, which exposes no post-transfer hook. That cart
 * reaches checkout unlinked, and a rule that reads only the link would find no
 * settings and enforce nothing -- the original bypass, reachable through a
 * completely ordinary flow.
 *
 * Preferring the link but falling back to the customer's own employee record
 * makes enforcement independent of the cart's lifecycle.
 */
export const resolveApprovalSettings = (
  cartCompanySettings: ApprovalSettingsLike,
  customerCompanySettings: ApprovalSettingsLike
): ApprovalSettingsLike =>
  cartCompanySettings ?? customerCompanySettings ?? null;

/**
 * Which approval types this cart's company demands before checkout.
 *
 * Extracted from the completeCart hook so the rule itself is independently
 * testable. The hook is only reachable after checkout prerequisites (shipping
 * method, payment collection) are satisfied, which makes the rule awkward to
 * exercise end-to-end; the security property must not go untested because of
 * that.
 */
export const getRequiredApprovalTypes = (
  settings: ApprovalSettingsLike
): ApprovalType[] => {
  const required: ApprovalType[] = [];

  if (settings?.requires_admin_approval) {
    required.push(ApprovalType.ADMIN);
  }

  if (settings?.requires_sales_manager_approval) {
    required.push(ApprovalType.SALES_MANAGER);
  }

  return required;
};

/**
 * Throw unless every approval the cart's company requires has been granted.
 *
 * P0-SEC-1. This fails CLOSED: if the company requires approval and no matching
 * APPROVED record exists, completion is refused. The previous implementation
 * asked only whether a PENDING approval existed, so a caller who never
 * requested approval at all passed the check precisely because nothing had been
 * requested -- the client's React layer was the only thing enforcing the rule.
 */
export const assertCartApprovalSatisfied = (cart: CartApprovalInput): void => {
  const approvals = (cart?.approvals ?? []).filter(Boolean) as ApprovalLike[];

  // An outstanding request always blocks.
  if (approvals.some((a) => a?.status === ApprovalStatusType.PENDING)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cart is pending approval"
    );
  }

  // A rejection blocks. Previously a rejected cart was merely "not pending",
  // so it could still be completed.
  if (approvals.some((a) => a?.status === ApprovalStatusType.REJECTED)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cart approval was rejected"
    );
  }

  const requiredTypes = getRequiredApprovalTypes(
    cart?.company?.approval_settings
  );

  for (const requiredType of requiredTypes) {
    const granted = approvals.some(
      (a) =>
        a?.type === requiredType && a?.status === ApprovalStatusType.APPROVED
    );

    if (!granted) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cart requires approval before it can be completed"
      );
    }
  }
};
