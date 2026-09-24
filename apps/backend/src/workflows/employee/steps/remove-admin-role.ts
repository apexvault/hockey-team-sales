import { IAuthModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  roleMirrorCompensationPayload,
  withoutRole,
  type RoleMirrorCompensation,
} from "./role-mirror";

type RemoveAdminRoleInput = { email: string };

type RemoveAdminRoleCompensation = RoleMirrorCompensation;

/**
 * Clears the mirrored company_admin marker from the auth provider identity.
 *
 * SECURITY (F-22, P0-SEC-1): the previous compensation handler set
 * `user_metadata.role = "company_admin"` UNCONDITIONALLY on rollback. Because
 * `updateEmployeesWorkflow` runs this step whenever `is_admin === false`, any
 * later step failing caused the rollback to PROMOTE the just-demoted user -- and
 * under the old global role semantics that meant admin over every company. A
 * privilege escalation reachable purely through an error path.
 *
 * Compensation now restores the exact prior metadata captured on the way in,
 * so a rollback can only ever return the identity to where it started. It can
 * never grant authority that was not already held.
 *
 * This step also no longer dereferences a possibly-missing provider identity,
 * which previously threw a TypeError (surfacing as a 500) for any customer
 * without an emailpass identity.
 */
export const removeAdminRoleStep = createStep(
  "remove-admin-role",
  async (
    input: RemoveAdminRoleInput,
    { container }
  ): Promise<StepResponse<undefined, RemoveAdminRoleCompensation>> => {
    const authModuleService = container.resolve<IAuthModuleService>(
      Modules.AUTH
    );

    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const {
      data: [providerIdentity],
    } = await query.graph({
      entity: "provider_identity",
      fields: ["id", "user_metadata"],
      filters: {
        provider: "emailpass",
        entity_id: input.email,
      },
    });

    if (!providerIdentity?.id) {
      // No mirrored identity to clear; nothing to compensate either.
      return new StepResponse(undefined, null);
    }

    const previousMetadata =
      (providerIdentity.user_metadata as Record<string, unknown> | null) ?? null;

    await authModuleService.updateProviderIdentities([
      {
        id: providerIdentity.id,
        user_metadata: withoutRole(previousMetadata),
      },
    ]);

    return new StepResponse(undefined, {
      providerIdentityId: providerIdentity.id,
      previousMetadata,
    });
  },
  async (
    compensationData: RemoveAdminRoleCompensation | undefined,
    { container }
  ) => {
    // Restore exactly what was there before -- never a hardcoded role.
    const payload = roleMirrorCompensationPayload(compensationData);

    if (!payload) {
      return;
    }

    const authModuleService = container.resolve<IAuthModuleService>(
      Modules.AUTH
    );

    await authModuleService.updateProviderIdentities([payload]);
  }
);
