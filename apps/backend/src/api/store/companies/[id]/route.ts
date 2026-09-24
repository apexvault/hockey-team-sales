import { MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CompanyScopedRequest } from "../../../middlewares/ensure-company-access";
import {
  deleteCompaniesWorkflow,
  updateCompaniesWorkflow,
} from "../../../../workflows/company/workflows/";
import {
  StoreGetCompanyParamsType,
  StoreUpdateCompanyType,
} from "../validators";

/**
 * P0-SEC-1: every handler below reads the company id from `req.company_id`,
 * which `ensureCompanyAccess` derived from the authenticated identity -- not
 * from `req.params.id`. The middleware has already proven the two match, so
 * using the derived value keeps that guarantee even if a future middleware
 * ordering change loosens the path check.
 */

export const GET = async (
  req: CompanyScopedRequest & { validatedQuery?: StoreGetCompanyParamsType },
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: "companies",
    fields: req.queryConfig.fields,
    filters: { id: req.company_id },
  });

  const company = data?.[0];

  if (!company) {
    // Uniform denial: never disclose whether a company exists.
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ company });
};

export const POST = async (
  req: CompanyScopedRequest & { validatedBody: StoreUpdateCompanyType },
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  await updateCompaniesWorkflow.run({
    input: {
      // Validated body only -- the previous implementation spread raw req.body,
      // so any column on the model could be written by any caller.
      ...req.validatedBody,
      id: req.company_id as string,
    },
    container: req.scope,
  });

  const { data } = await query.graph({
    entity: "companies",
    fields: req.queryConfig.fields,
    filters: { id: req.company_id },
  });

  const company = data?.[0];

  if (!company) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ company });
};

export const DELETE = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  await deleteCompaniesWorkflow.run({
    input: { id: req.company_id as string },
    container: req.scope,
    throwOnError: true,
  });

  res.status(204).send();
};
