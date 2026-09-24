import { MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CompanyScopedRequest } from "../../../../middlewares/ensure-company-access";
import { createEmployeesWorkflow } from "../../../../../workflows/employee/workflows";
import { StoreCreateEmployeeType } from "../../validators";

/**
 * P0-SEC-1: the company is taken from `req.company_id` (server-derived), not
 * from the path. `ensureCompanyAccess` has already proven the caller belongs to
 * it; for POST it has additionally proven company-admin authority.
 */

export const GET = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data, metadata } = await query.graph({
    entity: "company",
    fields: [...req.queryConfig.fields, "employees.*"],
    filters: { id: req.company_id },
  });

  const company = data?.[0];

  if (!company) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({
    employees: company.employees ?? [],
    count: metadata?.count ?? 0,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 0,
  });
};

export const POST = async (
  req: CompanyScopedRequest & { validatedBody: StoreCreateEmployeeType },
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { customer_id: targetCustomerId } = req.validatedBody;

  // Refuse to attach a customer who already belongs to a company -- including
  // another company. Without this an admin could pull a rival team's member
  // onto their own roster.
  const { data: existing } = await query.graph({
    entity: "customer",
    fields: ["id", "employee.id"],
    filters: { id: targetCustomerId },
  });

  const targetCustomer = existing?.[0];

  // Deliberately ONE response for both "no such customer" and "already on a
  // roster". Distinguishing them let any team admin probe an arbitrary
  // customer id and learn whether that account exists and whether it is already
  // affiliated -- the same existence oracle this change removes elsewhere. A
  // uniform refusal tells the caller only that they may not add this id.
  if (!targetCustomer || targetCustomer.employee?.id) {
    return res.status(409).json({
      message: "This customer cannot be added to the company.",
      code: "EMPLOYEE_NOT_ADDABLE",
    });
  }

  const { result: createdEmployee } = await createEmployeesWorkflow.run({
    input: {
      employeeData: {
        ...req.validatedBody,
        company_id: req.company_id as string,
      },
      customerId: targetCustomerId,
    },
    container: req.scope,
  });

  const { data } = await query.graph(
    {
      entity: "employee",
      fields: req.queryConfig.fields,
      filters: { id: createdEmployee.id },
    },
    { throwIfKeyNotFound: true }
  );

  res.json({ employee: data?.[0] });
};
