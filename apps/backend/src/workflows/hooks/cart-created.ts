import { createCartWorkflow } from "@medusajs/core-flows";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { COMPANY_MODULE } from "../../modules/company";
import { CartDTO } from "@medusajs/framework/types";

/**
 * Link a new cart to the purchasing company.
 *
 * SECURITY (P0-SEC-1): the company was previously taken from
 * `cart.metadata.company_id` -- a value written by the client. That made the
 * company association of a cart client-controlled, with two consequences:
 *
 *   1. Omitting it detached the cart from any company, so the approval and
 *      spending-limit checks (which resolve settings through the cart's
 *      company) found nothing to enforce. Skipping one optional field was
 *      enough to escape a team's purchase controls.
 *   2. Setting it to another company's id attributed the cart -- and the order
 *      that follows it -- to a team the buyer does not belong to.
 *
 * The company is now derived server-side from the cart's customer via their
 * employee record, and any client-supplied `metadata.company_id` is ignored for
 * linking purposes. A cart with no authenticated customer, or a customer who
 * belongs to no company, is simply left unlinked.
 */
createCartWorkflow.hooks.cartCreated(
  async (
    { cart },
    { container }
  ): Promise<
    | StepResponse<undefined, null>
    | StepResponse<undefined, { cart_id: string; company_id: string }>
  > => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const cartInputdata = cart as CartDTO;

    if (!cartInputdata.customer_id) {
      return new StepResponse(undefined, null);
    }

    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "employee.id", "employee.company.id"],
      filters: { id: cartInputdata.customer_id },
    });

    const companyId = data?.[0]?.employee?.company?.id;

    if (!companyId) {
      return new StepResponse(undefined, null);
    }

    await remoteLink.create({
      [COMPANY_MODULE]: {
        company_id: companyId,
      },
      [Modules.CART]: {
        cart_id: cartInputdata.id,
      },
    });

    return new StepResponse(undefined, {
      cart_id: cartInputdata.id,
      company_id: companyId,
    });
  },
  async (
    input: { cart_id: string; company_id: string } | null,
    { container }
  ) => {
    if (!input) {
      return;
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);

    await remoteLink.dismiss({
      [COMPANY_MODULE]: {
        company_id: input.company_id,
      },
      [Modules.CART]: {
        cart_id: input.cart_id,
      },
    });
  }
);
