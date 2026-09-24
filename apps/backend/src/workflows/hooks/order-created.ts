import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createOrderWorkflow } from "@medusajs/medusa/core-flows";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { COMPANY_MODULE } from "../../modules/company";

/**
 * Attribute a new order to the purchasing company.
 *
 * SECURITY (P0-SEC-1): same defect as the cart hook -- the company came from
 * `order.metadata.company_id`, which originates with the client. An order could
 * therefore be attributed to a company the buyer does not belong to, corrupting
 * per-team order history, spend accumulation and reporting; or attributed to no
 * company at all, hiding the order from the team it was placed for.
 *
 * The company is now derived from the order's customer, with the client-supplied
 * metadata ignored for linking.
 */
createOrderWorkflow.hooks.orderCreated(
  async ({ order }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    if (!order.customer_id) {
      return new StepResponse(undefined, null);
    }

    const { data } = await query.graph({
      entity: "customer",
      fields: ["id", "employee.id", "employee.company.id"],
      filters: { id: order.customer_id },
    });

    const companyId = data?.[0]?.employee?.company?.id;

    if (!companyId) {
      return new StepResponse(undefined, null);
    }

    await remoteLink.create({
      [Modules.ORDER]: {
        order_id: order.id,
      },
      [COMPANY_MODULE]: {
        company_id: companyId,
      },
    });

    return new StepResponse(undefined, order.id);
  },
  async (orderId: string | null, { container }) => {
    if (!orderId) {
      return;
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);

    await remoteLink.dismiss({
      [Modules.ORDER]: {
        order_id: orderId,
      },
    });
  }
);
