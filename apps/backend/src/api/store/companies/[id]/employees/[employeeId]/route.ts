import { MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CompanyScopedRequest } from "../../../../../middlewares/ensure-company-access";
import {
  deleteEmployeesWorkflow,
  updateEmployeesWorkflow,
} from "../../../../../../workflows/employee/workflows";
import { StoreUpdateEmployeeType } from "../../../validators";

/**
 * P0-SEC-1. `ensureEmployeeInCompany` has proven that :employeeId belongs to
 * the caller's company, and `ensureCompanyAccess` that the caller belongs to
 * (and for writes, administers) that company.
 *
 * Every query below is additionally filtered by `company_id: req.company_id`
 * as defence in depth, so a middleware regression cannot silently widen these
 * handlers back to "any employee id in the system".
 */

export const GET = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  const { employeeId } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: "employee",
    fields: req.queryConfig.fields,
    filters: { id: employeeId, company_id: req.company_id },
  });

  const employee = data?.[0];

  if (!employee) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ employee });
};

export const POST = async (
  req: CompanyScopedRequest & { validatedBody: StoreUpdateEmployeeType },
  res: MedusaResponse
) => {
  const { employeeId } = req.params;
  const { spending_limit, is_admin } = req.validatedBody;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  await updateEmployeesWorkflow.run({
    input: {
      id: employeeId,
      // Derived, not read from the path. Previously `company_id` came straight
      // from the URL, which let an admin reassign an employee to a different
      // company by choosing the id in the route.
      company_id: req.company_id as string,
      spending_limit,
      is_admin,
    },
    container: req.scope,
  });

  const { data } = await query.graph({
    entity: "employee",
    fields: req.queryConfig.fields,
    filters: { id: employeeId, company_id: req.company_id },
  });

  const employee = data?.[0];

  if (!employee) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ employee });
};

export const DELETE = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  const { employeeId } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: "employee",
    fields: ["id"],
    filters: { id: employeeId, company_id: req.company_id },
  });

  if (!data?.[0]) {
    return res.status(403).json({ message: "Forbidden" });
  }

  await deleteEmployeesWorkflow.run({
    input: [employeeId],
    container: req.scope,
  });

  res.json({
    id: employeeId,
    object: "employee",
    deleted: true,
  });
};
