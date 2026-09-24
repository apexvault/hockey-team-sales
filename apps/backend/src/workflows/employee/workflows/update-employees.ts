import { when } from "@medusajs/framework/workflows-sdk";
import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ModuleUpdateEmployee, QueryEmployee } from "../../../types";
import {
  removeAdminRoleStep,
  setAdminRoleStep,
  updateEmployeesStep,
} from "../steps";

export const updateEmployeesWorkflow = createWorkflow(
  "update-employees",
  (
    input: WorkflowData<ModuleUpdateEmployee>
  ): WorkflowResponse<QueryEmployee> => {
    const updatedEmployee = updateEmployeesStep(input);

    when(updatedEmployee, ({ is_admin }) => {
      return is_admin === false;
    }).then(() => {
      removeAdminRoleStep({
        email: updatedEmployee.customer.email,
      });
    });

    // Previously absent: promoting an employee updated `employee.is_admin` but
    // never refreshed the mirrored user_metadata, so the two sources of truth
    // drifted -- the storefront gated UI on `is_admin` while the API gated on
    // the stale metadata role. Authorization now reads `is_admin` only, but the
    // mirror is kept symmetric so the drift cannot resurface.
    when(updatedEmployee, ({ is_admin }) => {
      return is_admin === true;
    }).then(() => {
      setAdminRoleStep({
        employeeId: updatedEmployee.id,
        customerId: updatedEmployee.customer.id,
      });
    });

    return new WorkflowResponse(updatedEmployee);
  }
);
