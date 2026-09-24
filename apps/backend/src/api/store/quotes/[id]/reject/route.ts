import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { RemoteQueryFunction } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { customerRejectQuoteWorkflow } from "../../../../../workflows/quote/workflows";
import { RejectQuoteType } from "../../validators";

export const POST = async (
  req: AuthenticatedMedusaRequest<RejectQuoteType>,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const query = req.scope.resolve<RemoteQueryFunction>(
    ContainerRegistrationKeys.QUERY
  );

  await customerRejectQuoteWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      quote_id: id,
      // Taken from the auth context, never the body, so a caller cannot reject
      // another customer's quote by naming them.
      customer_id: req.auth_context.actor_id,
    },
  });

  const {
    data: [quote],
  } = await query.graph(
    {
      entity: "quote",
      fields: req.queryConfig.fields,
      filters: { id },
    },
    { throwIfKeyNotFound: true }
  );

  return res.json({ quote });
};
