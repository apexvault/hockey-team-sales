import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { COMPANY_MODULE } from "../modules/company";

/**
 * Attach a cart to its company after the cart's customer changes.
 *
 * ROOT-CAUSE FIX (P0-SEC-1, F-29/NEW-1).
 *
 * `createCartWorkflow.hooks.cartCreated` links a cart to a company, but it
 * fires once, at creation, and only when the cart already has a customer. A
 * shopper who browses logged out and signs in at checkout has their customer
 * attached afterwards by `transferCartCustomerWorkflow`, which exposes only a
 * `validate` hook -- and that hook runs BEFORE the customer is written, so it
 * cannot do the linking either. Those carts stayed unlinked forever.
 *
 * Four separate places read that link, so routing around it in one of them
 * (the completion guard) fixed the security hole but left the other three
 * broken: `createApprovalStep` could not determine which approvals to create
 * and returned "No enabled approval types found"; the team admin's approval
 * queue, which enumerates `company.carts`, could never show the cart; and the
 * storefront's payment button read `cart.company` to decide whether to offer
 * "Request Approval" at all. The result was a cart that could neither be
 * completed nor approved -- fail-closed, but a dead end for an ordinary
 * browse-then-login purchase.
 *
 * Repairing the link here fixes all four readers at once. The completion guard
 * keeps its independent fallback as defence in depth, so enforcement never
 * depends on this subscriber having run.
 */
export default async function linkCartToCompanyHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const cartId = data?.id;

  if (!cartId) {
    return;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);

  const { data: cartData } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "company.id"],
    filters: { id: cartId },
  });

  const cart = cartData?.[0];

  if (!cart?.customer_id) {
    return;
  }

  // The company is derived from the customer's employee record -- never from
  // cart metadata, which the client controls.
  const { data: customerData } = await query.graph({
    entity: "customer",
    fields: ["id", "employee.id", "employee.company.id"],
    filters: { id: cart.customer_id },
  });

  const companyId = customerData?.[0]?.employee?.company?.id;

  if (!companyId) {
    return;
  }

  const existingCompanyId = (cart as any).company?.id;

  if (existingCompanyId === companyId) {
    return;
  }

  // A transferred cart may carry a link to the previous customer's company.
  if (existingCompanyId) {
    await remoteLink.dismiss({
      [COMPANY_MODULE]: { company_id: existingCompanyId },
      [Modules.CART]: { cart_id: cartId },
    });
  }

  await remoteLink.create({
    [COMPANY_MODULE]: { company_id: companyId },
    [Modules.CART]: { cart_id: cartId },
  });
}

export const config: SubscriberConfig = {
  event: "cart.customer_transferred",
};
