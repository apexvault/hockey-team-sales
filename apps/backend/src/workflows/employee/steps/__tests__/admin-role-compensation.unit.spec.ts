import {
  COMPANY_ADMIN_ROLE,
  roleMirrorCompensationPayload,
  withCompanyAdminRole,
  withoutRole,
} from "../role-mirror";

/**
 * F-22 regression -- workflow compensation must never ESCALATE privilege.
 *
 * `removeAdminRoleStep`'s compensator previously wrote
 * `user_metadata.role = "company_admin"` unconditionally. Because
 * `updateEmployeesWorkflow` runs that step whenever `is_admin === false`, any
 * later step failing made the rollback PROMOTE the just-demoted user -- and
 * under the old global-role semantics, to admin over every team. The escalation
 * lived entirely in the rollback branch, which no test ever drove.
 *
 * `createStep` keeps invoke/compensate in a closure, so the branch is not
 * reachable through the step object. The behaviour therefore lives in pure
 * helpers that both the steps and these tests call.
 */
describe("role mirror compensation (F-22)", () => {
  describe("roleMirrorCompensationPayload", () => {
    it("restores the EXACT prior metadata for a user who was NOT an admin", () => {
      // The dangerous case. A rollback that writes "company_admin" here hands
      // the user authority they never held.
      const payload = roleMirrorCompensationPayload({
        providerIdentityId: "pid_1",
        previousMetadata: { role: null, locale: "en-CA" },
      });

      expect(payload).toEqual({
        id: "pid_1",
        user_metadata: { role: null, locale: "en-CA" },
      });
      expect(payload!.user_metadata.role).not.toBe(COMPANY_ADMIN_ROLE);
    });

    it("restores admin only when the user WAS already an admin", () => {
      const payload = roleMirrorCompensationPayload({
        providerIdentityId: "pid_2",
        previousMetadata: { role: COMPANY_ADMIN_ROLE },
      });

      expect(payload!.user_metadata.role).toBe(COMPANY_ADMIN_ROLE);
    });

    it("never invents metadata when the prior state was empty", () => {
      const payload = roleMirrorCompensationPayload({
        providerIdentityId: "pid_3",
        previousMetadata: null,
      });

      expect(payload).toEqual({ id: "pid_3", user_metadata: {} });
      expect(payload!.user_metadata).not.toHaveProperty("role");
    });

    it("writes nothing when the forward step wrote nothing", () => {
      expect(roleMirrorCompensationPayload(null)).toBeNull();
      expect(roleMirrorCompensationPayload(undefined)).toBeNull();
      expect(
        roleMirrorCompensationPayload({
          providerIdentityId: "",
          previousMetadata: { role: COMPANY_ADMIN_ROLE },
        })
      ).toBeNull();
    });

    it("cannot be coaxed into producing an admin role from absent input", () => {
      // Property check over every "nothing happened" shape: none may yield a
      // payload that grants the role.
      for (const input of [null, undefined, { providerIdentityId: "" }] as any[]) {
        const payload = roleMirrorCompensationPayload(input);
        expect(payload?.user_metadata?.role).not.toBe(COMPANY_ADMIN_ROLE);
      }
    });
  });

  describe("withoutRole", () => {
    it("removes the role key while preserving unrelated metadata", () => {
      expect(
        withoutRole({ role: COMPANY_ADMIN_ROLE, locale: "en-CA" })
      ).toEqual({ locale: "en-CA" });
    });

    it("does not add a role key when there was none", () => {
      expect(withoutRole(null)).toEqual({});
      expect(withoutRole({ locale: "fr-CA" })).toEqual({ locale: "fr-CA" });
    });

    it("does not mutate its input", () => {
      const original = { role: COMPANY_ADMIN_ROLE, locale: "en-CA" };
      withoutRole(original);
      expect(original.role).toBe(COMPANY_ADMIN_ROLE);
    });
  });

  describe("withCompanyAdminRole", () => {
    it("sets the role while preserving unrelated metadata", () => {
      expect(withCompanyAdminRole({ locale: "en-CA" })).toEqual({
        locale: "en-CA",
        role: COMPANY_ADMIN_ROLE,
      });
    });

    it("does not mutate its input", () => {
      const original = { locale: "en-CA" };
      withCompanyAdminRole(original);
      expect(original).toEqual({ locale: "en-CA" });
    });
  });
});
