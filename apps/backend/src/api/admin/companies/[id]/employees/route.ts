import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createEmployeesWorkflow } from "../../../../../workflows/employee/workflows";
import {
  AdminCreateEmployeeType,
  AdminGetEmployeeParamsType,
} from "../../validators";

export const GET = async (
  req: MedusaRequest<AdminGetEmployeeParamsType>,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const {
    data: [{ employees }],
    metadata,
  } = await query.graph(
    {
      entity: "company",
      fields: [...req.queryConfig.fields, "employees.*"],
      filters: {
        id,
        ...req.filterableFields,
      },
    },
    { throwIfKeyNotFound: true }
  );

  res.json({
    employees,
    count: metadata?.count,
    offset: metadata?.skip,
    limit: metadata?.take,
  });
};

export const POST = async (
  req: MedusaRequest<AdminCreateEmployeeType>,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { id } = req.params;

  // The employee<->customer link is declared non-list (src/links/employee-customer.ts),
  // so a customer with two employee rows makes `customer.employee` resolve to an
  // arbitrary one of them -- and `resolveCompanyMembership` would then derive an
  // arbitrary company. The store route already refuses this; without the same
  // guard here, staff could create exactly that ambiguous state.
  const { data: existing } = await query.graph({
    entity: "customer",
    fields: ["id", "employee.id"],
    filters: { id: req.validatedBody.customer_id },
  });

  if (existing?.[0]?.employee?.id) {
    return res.status(409).json({
      message: "This customer already belongs to a company.",
      code: "EMPLOYEE_ALREADY_EXISTS",
    });
  }

  const { result: createdEmployee } = await createEmployeesWorkflow.run({
    input: {
      employeeData: { ...req.validatedBody, company_id: id },
      customerId: req.validatedBody.customer_id,
    },
    container: req.scope,
  });

  const {
    data: [employee],
  } = await query.graph(
    {
      entity: "employee",
      fields: req.queryConfig.fields,
      filters: { id: createdEmployee.id },
    },
    { throwIfKeyNotFound: true }
  );

  res.json({ employee });
};
