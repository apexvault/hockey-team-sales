import {
  assertCartApprovalSatisfied,
  getRequiredApprovalTypes,
  resolveApprovalSettings,
} from "../assert-cart-approval";
import { ApprovalStatusType, ApprovalType } from "../../types/approval";

/**
 * P0-SEC-1 -- server-side purchase approval must fail closed.
 *
 * The rule under test is the one a client previously enforced on its own: the
 * React checkout decided whether to request approval, and the server only
 * checked whether an approval record happened to exist. These tests pin the
 * inverted rule -- absence of an approval is a refusal, not a pass.
 */
describe("assertCartApprovalSatisfied", () => {
  const approved = (type: ApprovalType) => ({
    type,
    status: ApprovalStatusType.APPROVED,
  });

  describe("when the company requires admin approval", () => {
    const settings = { requires_admin_approval: true };

    it("refuses a cart with NO approvals at all", () => {
      // The exact bypass: skip the client's "Request approval" step entirely.
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [],
          company: { approval_settings: settings },
        })
      ).toThrow(/requires approval/i);
    });

    it("refuses when approvals is null or undefined", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: null,
          company: { approval_settings: settings },
        })
      ).toThrow(/requires approval/i);

      expect(() =>
        assertCartApprovalSatisfied({
          company: { approval_settings: settings },
        })
      ).toThrow(/requires approval/i);
    });

    it("refuses while an approval is pending", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [
            { type: ApprovalType.ADMIN, status: ApprovalStatusType.PENDING },
          ],
          company: { approval_settings: settings },
        })
      ).toThrow(/pending approval/i);
    });

    it("refuses when the approval was rejected", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [
            { type: ApprovalType.ADMIN, status: ApprovalStatusType.REJECTED },
          ],
          company: { approval_settings: settings },
        })
      ).toThrow(/rejected/i);
    });

    it("refuses when only a DIFFERENT approval type was granted", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [approved(ApprovalType.SALES_MANAGER)],
          company: { approval_settings: settings },
        })
      ).toThrow(/requires approval/i);
    });

    it("allows once a matching approval is granted", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [approved(ApprovalType.ADMIN)],
          company: { approval_settings: settings },
        })
      ).not.toThrow();
    });
  });

  describe("when the company requires both admin and sales-manager approval", () => {
    const settings = {
      requires_admin_approval: true,
      requires_sales_manager_approval: true,
    };

    it("refuses when only one of the two is granted", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [approved(ApprovalType.ADMIN)],
          company: { approval_settings: settings },
        })
      ).toThrow(/requires approval/i);
    });

    it("allows when both are granted", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [
            approved(ApprovalType.ADMIN),
            approved(ApprovalType.SALES_MANAGER),
          ],
          company: { approval_settings: settings },
        })
      ).not.toThrow();
    });
  });

  describe("when the company requires no approval", () => {
    it("allows a cart with no approvals", () => {
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [],
          company: { approval_settings: { requires_admin_approval: false } },
        })
      ).not.toThrow();
    });

    it("allows a cart with no company at all", () => {
      expect(() =>
        assertCartApprovalSatisfied({ approvals: [] })
      ).not.toThrow();
    });

    it("still refuses a cart carrying a pending approval", () => {
      // A request that was raised must be resolved even if the requirement was
      // since switched off, otherwise turning the setting off would silently
      // release carts a team admin had not yet decided.
      expect(() =>
        assertCartApprovalSatisfied({
          approvals: [
            { type: ApprovalType.ADMIN, status: ApprovalStatusType.PENDING },
          ],
          company: { approval_settings: { requires_admin_approval: false } },
        })
      ).toThrow(/pending approval/i);
    });
  });

  it("ignores null entries in the approvals array", () => {
    expect(() =>
      assertCartApprovalSatisfied({
        approvals: [null, undefined, approved(ApprovalType.ADMIN)],
        company: { approval_settings: { requires_admin_approval: true } },
      })
    ).not.toThrow();
  });
});

describe("resolveApprovalSettings", () => {
  const settings = { requires_admin_approval: true };

  it("prefers the settings reached through the cart's company link", () => {
    expect(resolveApprovalSettings(settings, null)).toBe(settings);
  });

  /**
   * The guest-cart bypass. `cartCreated` fires only at creation and only when
   * the cart already has a customer, and `transferCartCustomer` offers no
   * post-transfer hook -- so browse-logged-out then sign-in yields a cart with
   * no company link. Reading only the link would find no settings and enforce
   * nothing.
   */
  it("falls back to the customer's company when the cart has no link", () => {
    expect(resolveApprovalSettings(null, settings)).toBe(settings);
    expect(resolveApprovalSettings(undefined, settings)).toBe(settings);
  });

  it("returns null only when neither source has settings", () => {
    expect(resolveApprovalSettings(null, null)).toBeNull();
    expect(resolveApprovalSettings(undefined, undefined)).toBeNull();
  });

  it("keeps an explicit approval-not-required setting rather than falling through", () => {
    // `{}` and `{requires_admin_approval:false}` are real settings meaning "no
    // approval needed". They must not be treated as absent, or the fallback
    // could impose another company's requirement on this cart.
    const noneRequired = { requires_admin_approval: false };
    expect(resolveApprovalSettings(noneRequired, settings)).toBe(noneRequired);
  });
});

describe("getRequiredApprovalTypes", () => {
  it("returns nothing when settings are absent", () => {
    expect(getRequiredApprovalTypes(null)).toEqual([]);
    expect(getRequiredApprovalTypes(undefined)).toEqual([]);
    expect(getRequiredApprovalTypes({})).toEqual([]);
  });

  it("maps each flag to its approval type", () => {
    expect(
      getRequiredApprovalTypes({ requires_admin_approval: true })
    ).toEqual([ApprovalType.ADMIN]);

    expect(
      getRequiredApprovalTypes({ requires_sales_manager_approval: true })
    ).toEqual([ApprovalType.SALES_MANAGER]);

    expect(
      getRequiredApprovalTypes({
        requires_admin_approval: true,
        requires_sales_manager_approval: true,
      })
    ).toEqual([ApprovalType.ADMIN, ApprovalType.SALES_MANAGER]);
  });
});
