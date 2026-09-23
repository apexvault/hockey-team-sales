import { IAuthModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

type SetAdminRoleInput = { employeeId: string; customerId: string };

/**
 * Mirrors `employee.is_admin` onto the auth provider identity's user_metadata.
 *
 * IMPORTANT (P0-SEC-1): this value is NO LONGER an authorization input. All
 * authorization now derives admin authority from the `employee.is_admin`
 * domain field via `resolveCompanyMembership`, because user_metadata.role is a
 * denormalised copy that is not company-scoped and can drift from the domain
 * model. The mirror is retained only so existing non-security consumers keep
 * working; changing it grants no privilege.
 *
 * The compensation handler previously set `role: null` unconditionally, which
 * silently stripped a legitimate pre-existing admin whenever an unrelated later
 * step failed. It now restores the exact prior value.
 */
export const setAdminRoleStep = createStep(
  "set-admin-role",
  async (
    input: SetAdminRoleInput,
    { container }
  ): Promise<StepResponse<undefined, { providerIdentityId: string; previousMetadata: Record<string, unknown> | null } | null>> => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const {
      data: [employee],
    } = await query.graph(
      {
        entity: "employee",
        fields: ["id", "is_admin", "customer.has_account"],
        filters: {
          id: input.employeeId,
        },
      },
      { throwIfKeyNotFound: true }
    );

    if (employee.customer?.has_account === false) {
      return new StepResponse(undefined, null);
    }

    const {
      data: [customer],
    } = await query.graph(
      {
        entity: "customer",
        fields: ["email"],
        filters: {
          id: input.customerId,
        },
      },
      { throwIfKeyNotFound: true }
    );

    if (!customer.email) {
      return new StepResponse(undefined, null);
    }

    const {
      data: [providerIdentity],
    } = await query.graph({
      entity: "provider_identity",
      fields: ["*"],
      filters: {
        provider: "emailpass",
        entity_id: customer.email,
      },
    });

    if (!providerIdentity) {
      // Nothing mirrored, nothing to undo.
      return new StepResponse(undefined, null);
    }

    const authModuleService = container.resolve<IAuthModuleService>(
      Modules.AUTH
    );

    const previousMetadata =
      (providerIdentity.user_metadata as Record<string, unknown> | null) ?? null;

    await authModuleService.updateProviderIdentities([
      {
        id: providerIdentity.id,
        user_metadata: {
          ...(previousMetadata ?? {}),
          role: "company_admin",
        },
      },
    ]);

    // Carry the prior state so compensation restores it exactly.
    return new StepResponse(undefined, {
      providerIdentityId: providerIdentity.id,
      previousMetadata,
    });
  },
  async (
    compensationData:
      | { providerIdentityId: string; previousMetadata: Record<string, unknown> | null }
      | null
      | undefined,
    { container }
  ) => {
    if (!compensationData?.providerIdentityId) {
      return;
    }

    const authModuleService = container.resolve<IAuthModuleService>(
      Modules.AUTH
    );

    await authModuleService.updateProviderIdentities([
      {
        id: compensationData.providerIdentityId,
        // Restore the exact prior metadata rather than blanking the role.
        user_metadata: compensationData.previousMetadata ?? {},
      },
    ]);
  }
);
