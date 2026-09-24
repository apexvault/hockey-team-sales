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

  // Demoting the last admin leaves the team unadministrable just as surely as
  // deleting them, so it is refused on the same grounds.
  if (is_admin === false) {
    const { data: roster } = await query.graph({
      entity: "employee",
      fields: ["id", "is_admin"],
      filters: { company_id: req.company_id },
    });

    const otherAdminExists = (roster ?? []).some(
      (e: any) => e?.is_admin === true && e?.id !== employeeId
    );

    if (!otherAdminExists) {
      return res.status(409).json({
        message:
          "Cannot demote the last administrator. Appoint a replacement first.",
        code: "LAST_ADMINISTRATOR",
      });
    }
  }

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
    fields: ["id", "is_admin"],
    filters: { id: employeeId, company_id: req.company_id },
  });

  const target = data?.[0];

  if (!target) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const { data: roster } = await query.graph({
    entity: "employee",
    fields: ["id", "is_admin"],
    filters: { company_id: req.company_id },
  });

  const remaining = (roster ?? []).filter((e: any) => e?.id !== employeeId);

  /**
   * LAST_ADMINISTRATOR policy (owner decision).
   *
   * The earlier LAST_EMPLOYEE rule was too broad: it blocked removing the final
   * member even when that left nothing to administer, which gave a one-person
   * team no offboarding path at all. The owner replaced it with a narrower
   * invariant -- *an organization cannot be left active without an
   * administrator* -- so removing the last member is allowed, and only removing
   * the last ADMINISTRATOR is refused.
   *
   * The final administrator must appoint a replacement, or use the controlled
   * archive/closure workflow once that exists. Until it does, there is
   * deliberately no self-service way to wind an organization down; that is a
   * known gap, not an oversight.
   */
  if (
    target.is_admin === true &&
    !remaining.some((e: any) => e?.is_admin === true)
  ) {
    return res.status(409).json({
      message:
        "Cannot remove the last administrator. Appoint a replacement first.",
      code: "LAST_ADMINISTRATOR",
    });
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
