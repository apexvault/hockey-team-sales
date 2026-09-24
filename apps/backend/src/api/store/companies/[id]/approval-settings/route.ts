import { MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CompanyScopedRequest } from "../../../../middlewares/ensure-company-access";
import { updateApprovalSettingsWorkflow } from "../../../../../workflows/approval/workflows/update-approval-settings";
import { storeApprovalSettingsFields } from "../../query-config";
import { StoreUpdateApprovalSettingsType } from "../../validators";

/**
 * P0-SEC-1. Approval settings decide whether a team's purchases need sign-off,
 * so being able to flip them on another company's behalf disables that team's
 * spending controls outright. The company now comes from `req.company_id`, and
 * `ensureCompanyAccess({ admin: true })` has proven the caller administers it.
 */
export const POST = async (
  req: CompanyScopedRequest & {
    validatedBody: StoreUpdateApprovalSettingsType;
  },
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: "approval_settings",
    fields: storeApprovalSettingsFields,
    filters: { company_id: req.company_id },
  });

  const approvalSettings = data?.[0];

  if (!approvalSettings) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { requires_admin_approval } = req.validatedBody;

  await updateApprovalSettingsWorkflow.run({
    input: {
      id: approvalSettings.id,
      requires_admin_approval,
    },
    container: req.scope,
  });

  res.status(201).send();
};
