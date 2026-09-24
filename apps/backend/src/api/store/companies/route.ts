import { MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  CompanyScopedRequest,
  getAuthenticatedCustomerId,
  resolveCompanyMembership,
} from "../../middlewares/ensure-company-access";
import { createCompanyWithFounderWorkflow } from "../../../workflows/company/workflows";
import { StoreCreateCompanyType } from "./validators";

/**
 * List companies visible to the caller.
 *
 * A customer can see exactly one company: their own. Previously there was no
 * GET handler here at all; adding a scoped one is safer than leaving the verb
 * to be implemented later without a tenant filter.
 */
export const GET = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  const membership = await resolveCompanyMembership(req);

  if (!membership) {
    return res.json({ companies: [], count: 0 });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: companies } = await query.graph({
    entity: "companies",
    fields: req.queryConfig.fields,
    filters: { id: membership.companyId },
  });

  res.json({ companies, count: companies.length });
};

/**
 * Create a company, with the authenticated caller as its founding admin.
 *
 * The founder is taken from the auth context, never from the request body, and
 * is created inside the same workflow as the company (see
 * createCompanyWithFounderWorkflow) so no zero-employee company is ever
 * observable.
 */
export const POST = async (
  req: CompanyScopedRequest & { validatedBody: StoreCreateCompanyType },
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const customerId = getAuthenticatedCustomerId(req);

  if (!customerId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  // A customer already attached to a company cannot create another. Without
  // this, a member of one team could spin up a second company and hold two
  // memberships, muddying the single-company boundary the guards rely on.
  const existingMembership = await resolveCompanyMembership(req);

  if (existingMembership) {
    return res.status(409).json({
      message: "This customer already belongs to a company.",
      code: "COMPANY_ALREADY_EXISTS",
    });
  }

  const { result } = await createCompanyWithFounderWorkflow.run({
    input: {
      company: { ...req.validatedBody },
      founder_customer_id: customerId,
    },
    container: req.scope,
  });

  const { data: companies } = await query.graph(
    {
      entity: "companies",
      fields: req.queryConfig.fields,
      filters: { id: result.company.id },
    },
    { throwIfKeyNotFound: true }
  );

  res.json({ companies });
};
