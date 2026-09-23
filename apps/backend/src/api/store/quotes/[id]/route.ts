import { MedusaResponse } from "@medusajs/framework";
import { RemoteQueryFunction } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CompanyScopedRequest } from "../../../middlewares/ensure-company-access";

/**
 * Retrieve a quote.
 *
 * `ensureQuoteAccess()` has already authorised the caller as either the quote's
 * owner or a company admin of the owner's company.
 *
 * The handler previously re-filtered on `customer_id: req.auth_context.actor_id`
 * with `throwIfKeyNotFound: true`. That contradicted the middleware twice over:
 * the advertised company-admin read silently returned
 * `404 "Quote id not found: <id>"`, and that 404 echoed the requested id back --
 * the exact existence oracle the rest of this change removes, and the very body
 * the sibling `/preview` route does not produce. Authorization belongs in one
 * place; the handler now trusts it and fails with the uniform denial.
 */
export const GET = async (
  req: CompanyScopedRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const query = req.scope.resolve<RemoteQueryFunction>(
    ContainerRegistrationKeys.QUERY
  );

  const { data } = await query.graph({
    entity: "quote",
    fields: req.queryConfig.fields,
    filters: { id },
  });

  const quote = data?.[0];

  if (!quote) {
    return res.status(403).json({ message: "Forbidden" });
  }

  res.json({ quote });
};
