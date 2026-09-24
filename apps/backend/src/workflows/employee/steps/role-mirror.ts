export type ProviderMetadata = Record<string, unknown> | null;

export type RoleMirrorCompensation = {
  providerIdentityId: string;
  previousMetadata: ProviderMetadata;
} | null;

export const COMPANY_ADMIN_ROLE = "company_admin";

/**
 * Pure helpers behind the `user_metadata.role` mirror.
 *
 * They exist as standalone functions because `createStep` keeps its invoke and
 * compensate callbacks in a closure -- the returned step exposes only its name,
 * so a rollback branch cannot be driven from a test through the step object.
 * F-22 was a defect that lived entirely in a compensation handler, so leaving
 * that branch unexercised is exactly the gap that let it ship.
 *
 * NOTE: nothing in the authorization path reads this metadata any more.
 * Admin authority comes from the `employee.is_admin` domain column. The mirror
 * is retained only for non-security consumers.
 */

/** Forward value when granting the mirrored marker; preserves other keys. */
export const withCompanyAdminRole = (
  previous: ProviderMetadata
): Record<string, unknown> => ({
  ...(previous ?? {}),
  role: COMPANY_ADMIN_ROLE,
});

/** Forward value when clearing the marker; preserves other keys. */
export const withoutRole = (
  previous: ProviderMetadata
): Record<string, unknown> => {
  const next = { ...(previous ?? {}) };
  delete next.role;
  return next;
};

/**
 * What a compensation handler should write, given what it captured going in.
 *
 * Always the EXACT prior metadata. The previous implementation wrote a
 * hardcoded `role: "company_admin"` on rollback, so a failed demotion promoted
 * the user instead of restoring them -- privilege escalation via an error path.
 * Returning null means "nothing was written, write nothing back".
 */
export const roleMirrorCompensationPayload = (
  data: RoleMirrorCompensation | undefined
): { id: string; user_metadata: Record<string, unknown> } | null => {
  if (!data?.providerIdentityId) {
    return null;
  }

  return {
    id: data.providerIdentityId,
    user_metadata: (data.previousMetadata ?? {}) as Record<string, unknown>,
  };
};
