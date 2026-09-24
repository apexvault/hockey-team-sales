import { MedusaError } from "@medusajs/framework/utils";
import { createStep } from "@medusajs/framework/workflows-sdk";
import { QueryQuote } from "../../../types";

/**
 * Defence in depth for quote mutations (P0-SEC-1).
 *
 * `ensureQuoteAccess({ ownerOnly: true })` already blocks non-owners at the HTTP
 * edge. This step re-asserts the same rule inside the workflow so that any
 * future caller -- a subscriber, a job, an admin tool, or a route added without
 * the middleware -- cannot accept or reject a quote on another customer's
 * behalf. Authorization that lives only in middleware is one routing mistake
 * away from being absent.
 */
export const validateQuoteOwnershipStep = createStep(
  "validate-quote-ownership",
  async function ({
    quote,
    customer_id,
  }: {
    quote: QueryQuote & { customer_id?: string };
    customer_id: string;
  }) {
    if (!customer_id || !quote?.customer_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Not allowed to act on this quote"
      );
    }

    if (quote.customer_id !== customer_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Not allowed to act on this quote"
      );
    }
  }
);
