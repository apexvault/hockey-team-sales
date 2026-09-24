import { useRemoteQueryStep } from "@medusajs/core-flows";
import { createWorkflow } from "@medusajs/framework/workflows-sdk";
import { validateQuoteOwnershipStep } from "../steps/validate-quote-ownership";
import { updateQuotesWorkflow } from "./update-quote";

/*
  A workflow that rejects a quote by a customer.

  Once the customer rejects the quote, the decision then turns to the merchant to perform
  any further adjustments, or let it remain in a rejected state.
*/
export const customerRejectQuoteWorkflow = createWorkflow(
  "customer-reject-quote",
  function (input: { quote_id: string; customer_id: string }) {
    const quote = useRemoteQueryStep({
      entry_point: "quote",
      fields: ["id", "customer_id"],
      variables: { id: input.quote_id },
      list: false,
      throw_if_key_not_found: true,
    });

    // Defence in depth: rejecting destroys an in-flight negotiation, so the
    // caller must own the quote regardless of how the workflow was reached.
    validateQuoteOwnershipStep({ quote, customer_id: input.customer_id });

    updateQuotesWorkflow.runAsStep({
      input: [
        {
          id: input.quote_id,
          status: "customer_rejected",
        },
      ],
    });
  }
);
