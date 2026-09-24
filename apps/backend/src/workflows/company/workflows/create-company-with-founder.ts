import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ModuleCreateCompany } from "../../../types";
import { createEmployeesWorkflow } from "../../employee/workflows";
import { createCompaniesWorkflow } from "./create-companies";

type CreateCompanyWithFounderInput = {
  company: ModuleCreateCompany;
  founder_customer_id: string;
};

/**
 * Create a company and its founding employee in one compensatable workflow.
 *
 * P0-SEC-1. Previously the storefront made two separate calls -- create the
 * company, then POST an employee with `is_admin: true` -- which meant a company
 * necessarily existed for a moment with zero employees. `ensureRole` treated
 * that empty state as a reason to skip its check, so any authenticated customer
 * could walk through it and be granted a role that was never company-scoped.
 *
 * Creating the founder server-side, from the authenticated actor, removes the
 * empty-company window entirely and removes any need for a bootstrap bypass in
 * the authorization layer. The founder identity comes from the auth context, so
 * a caller cannot nominate somebody else -- or themselves on a company they do
 * not own.
 *
 * Composed with `runAsStep` so that a failure creating the employee rolls the
 * company back rather than leaving the orphaned, zero-employee record this is
 * meant to prevent.
 */
export const createCompanyWithFounderWorkflow = createWorkflow(
  "create-company-with-founder",
  function (input: CreateCompanyWithFounderInput) {
    const companies = createCompaniesWorkflow.runAsStep({
      input: transform(input, (data) => [data.company]),
    });

    const company = transform(companies, (result) => result[0]);

    const employeeInput = transform(
      { company, input },
      ({ company: created, input: original }) => ({
        employeeData: {
          company_id: created.id,
          customer_id: original.founder_customer_id,
          // The founder is always a company admin of their own company, and
          // never of any other.
          is_admin: true,
          spending_limit: 0,
        },
        customerId: original.founder_customer_id,
      })
    );

    const employee = createEmployeesWorkflow.runAsStep({
      input: employeeInput,
    });

    return new WorkflowResponse(
      transform({ company, employee }, (data) => ({
        company: data.company,
        employee: data.employee,
      }))
    );
  }
);
