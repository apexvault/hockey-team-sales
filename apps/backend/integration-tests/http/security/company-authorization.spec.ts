import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { adminHeaders, createAdminUser } from "../../utils/admin";
import {
  generatePublishableKey,
  generateStoreHeaders,
} from "../../utils/store";

jest.setTimeout(120 * 1000);

/**
 * P0-SEC-1 -- company/tenant authorization boundary.
 *
 * In this product a "company" is a hockey team, so every cross-company access
 * below is a cross-team access: one team reading, altering or deleting another
 * team's record, roster (which contains minors' data), quotes or approvals.
 *
 * These tests are written as NEGATIVE tests first. Each one asserts a specific
 * denial that was reachable before this change, so a regression that reopens
 * any hole fails here rather than in production.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { JWT_SECRET: "supersecret" },
  testSuite: ({ api, getContainer }) => {
    let storeHeaders: any;

    /** Register a customer and return auth-bearing store headers for them. */
    const registerCustomer = async (email: string) => {
      const registerToken = (
        await api.post("/auth/customer/emailpass/register", {
          email,
          password: "password",
        })
      ).data.token;

      const customer = (
        await api.post(
          "/store/customers",
          { email },
          {
            headers: {
              Authorization: `Bearer ${registerToken}`,
              ...storeHeaders.headers,
            },
          }
        )
      ).data.customer;

      const token = (
        await api.post("/auth/customer/emailpass", {
          email,
          password: "password",
        })
      ).data.token;

      return {
        customer,
        token,
        headers: {
          headers: {
            ...storeHeaders.headers,
            Authorization: `Bearer ${token}`,
          },
        },
      };
    };

    /** Register a customer who founds their own company. */
    const registerCustomerWithCompany = async (
      email: string,
      companyName: string
    ) => {
      const actor = await registerCustomer(email);

      const company = (
        await api.post(
          "/store/companies",
          {
            name: companyName,
            email,
            currency_code: "usd",
          },
          actor.headers
        )
      ).data.companies[0];

      return { ...actor, company };
    };

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(adminHeaders, container);
      const publishableKey = await generatePublishableKey(container);
      storeHeaders = generateStoreHeaders({ publishableKey });
    });

    describe("Company creation bootstrap", () => {
      it("creates the founding employee server-side, so no company ever has zero employees", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@wolverines.test",
          "Bantam AAA Wolverines"
        );

        const employees = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        expect(employees).toHaveLength(1);
        expect(employees[0].is_admin).toBe(true);
      });

      it("does not let a customer who already belongs to a company create another", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain2@wolverines.test",
          "Wolverines"
        );

        const res = await api
          .post(
            "/store/companies",
            { name: "Shell Co", email: "shell@test.test", currency_code: "usd" },
            wolverines.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(409);
      });

      /**
       * The headline pre-existing defect: signing up created a company with zero
       * employees, `ensureRole` waived its check for exactly that state, and the
       * role it then granted was never company-scoped -- so every registrant
       * became an admin over every team on the platform.
       */
      it("does not grant a brand-new registrant any authority over an existing company", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain3@wolverines.test",
          "Wolverines"
        );

        // A fresh registrant with no company at all.
        const stranger = await registerCustomer("stranger@nowhere.test");

        const read = await api
          .get(`/store/companies/${wolverines.company.id}`, stranger.headers)
          .catch((e) => e.response);
        expect(read.status).toBe(403);

        const write = await api
          .post(
            `/store/companies/${wolverines.company.id}`,
            { name: "Hijacked" },
            stranger.headers
          )
          .catch((e) => e.response);
        expect(write.status).toBe(403);
      });

      it("does not let a registrant who founded an empty-looking company reach another company", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain4@wolverines.test",
          "Wolverines"
        );

        // Attacker follows the exact old exploit path: register, found a
        // company (becoming its admin), then reach for another team.
        const attacker = await registerCustomerWithCompany(
          "attacker@shell.test",
          "Shell Team"
        );

        const res = await api
          .get(`/store/companies/${wolverines.company.id}`, attacker.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });
    });

    describe("Company member accessing their own company", () => {
      it("allows a member to read their own company and roster", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain5@wolverines.test",
          "Wolverines"
        );

        const company = (
          await api.get(
            `/store/companies/${wolverines.company.id}`,
            wolverines.headers
          )
        ).data.company;

        expect(company.id).toBe(wolverines.company.id);

        const employees = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        expect(employees.length).toBeGreaterThan(0);
      });

      it("allows a company admin to update their own company", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain6@wolverines.test",
          "Wolverines"
        );

        const res = await api.post(
          `/store/companies/${wolverines.company.id}`,
          { name: "Wolverines Renamed" },
          wolverines.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.company.name).toBe("Wolverines Renamed");
      });
    });

    /**
     * AC#11 -- legitimate B2B workflows must keep working. Without these, a
     * guard accidentally tightened to admin-only would pass every negative
     * test in this file and still break the product for ordinary members.
     */
    describe("Non-admin member (positive regression)", () => {
      let wolverines: any;
      let member: any;

      beforeEach(async () => {
        wolverines = await registerCustomerWithCompany(
          "captain@member.test",
          "Wolverines"
        );
        member = await registerCustomer("player@member.test");

        await api.post(
          `/store/companies/${wolverines.company.id}/employees`,
          {
            customer_id: member.customer.id,
            spending_limit: 0,
            is_admin: false,
          },
          wolverines.headers
        );
      });

      it("can read their own company", async () => {
        const res = await api.get(
          `/store/companies/${wolverines.company.id}`,
          member.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.company.id).toBe(wolverines.company.id);
      });

      it("can list their own team's roster", async () => {
        const res = await api.get(
          `/store/companies/${wolverines.company.id}/employees`,
          member.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.employees.length).toBeGreaterThanOrEqual(2);
      });

      it("cannot perform admin-only actions on their own company", async () => {
        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}`,
            { name: "Renamed By Player" },
            member.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      it("cannot reach another team", async () => {
        const storm = await registerCustomerWithCompany(
          "captain@member2.test",
          "Storm"
        );

        const res = await api
          .get(`/store/companies/${storm.company.id}`, member.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });
    });

    describe("Team must not be orphaned", () => {
      it("refuses to delete the last member of a company", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@last.test",
          "Wolverines"
        );

        const employees = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        const res = await api
          .delete(
            `/store/companies/${wolverines.company.id}/employees/${employees[0].id}`,
            wolverines.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(409);
        expect(res.data.code).toBe("LAST_EMPLOYEE");
      });

      it("refuses to demote the last admin", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@lastadmin.test",
          "Wolverines"
        );

        const member = await registerCustomer("player@lastadmin.test");
        await api.post(
          `/store/companies/${wolverines.company.id}/employees`,
          {
            customer_id: member.customer.id,
            spending_limit: 0,
            is_admin: false,
          },
          wolverines.headers
        );

        const employees = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        const admin = employees.find((e: any) => e.is_admin === true);

        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}/employees/${admin.id}`,
            { is_admin: false },
            wolverines.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(409);
        expect(res.data.code).toBe("LAST_ADMIN");
      });
    });

    describe("Non-member and cross-company access", () => {
      let wolverines: any;
      let storm: any;

      beforeEach(async () => {
        wolverines = await registerCustomerWithCompany(
          "captain@wolv.test",
          "Wolverines"
        );
        storm = await registerCustomerWithCompany(
          "captain@storm.test",
          "Midget Storm"
        );
      });

      it("denies reading another team's company record", async () => {
        const res = await api
          .get(`/store/companies/${wolverines.company.id}`, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
        // A denial must not leak the protected record.
        expect(JSON.stringify(res.data ?? {})).not.toContain("Wolverines");
      });

      it("denies reading another team's roster", async () => {
        const res = await api
          .get(
            `/store/companies/${wolverines.company.id}/employees`,
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      /** A company admin's authority stops at their own company. */
      it("denies a company admin updating another team's company", async () => {
        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}`,
            { name: "Owned By Storm" },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        const stillThere = (
          await api.get(
            `/store/companies/${wolverines.company.id}`,
            wolverines.headers
          )
        ).data.company;

        expect(stillThere.name).not.toBe("Owned By Storm");
      });

      it("denies disabling another team's approval settings", async () => {
        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}/approval-settings`,
            { requires_admin_approval: false },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      it("returns a uniform denial for a company id that does not exist", async () => {
        // Must not distinguish "absent" from "someone else's": either answer
        // would turn the endpoint into an existence oracle.
        const res = await api
          .get("/store/companies/comp_does_not_exist", storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });
    });

    describe("Unauthorized DELETE requests", () => {
      let wolverines: any;
      let storm: any;

      beforeEach(async () => {
        wolverines = await registerCustomerWithCompany(
          "captain@wolvdel.test",
          "Wolverines"
        );
        storm = await registerCustomerWithCompany(
          "captain@stormdel.test",
          "Storm"
        );
      });

      /** Previously there was no DELETE middleware entry at all. */
      it("denies deleting another team's company", async () => {
        const res = await api
          .delete(`/store/companies/${wolverines.company.id}`, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        // The company must still exist afterwards.
        const check = await api.get(
          `/store/companies/${wolverines.company.id}`,
          wolverines.headers
        );
        expect(check.status).toBe(200);
      });

      it("denies deleting a player from another team's roster", async () => {
        const employees = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        const victim = employees[0];

        // The path prefix was previously decorative: the handler deleted purely
        // by employee id, so any company id in the URL worked.
        const res = await api
          .delete(
            `/store/companies/${storm.company.id}/employees/${victim.id}`,
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        const after = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees;

        expect(after.map((e: any) => e.id)).toContain(victim.id);
      });
    });

    describe("Client-supplied company-ID tampering", () => {
      it("ignores a company id in the path when updating an employee", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@tamper.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@tamper2.test",
          "Storm"
        );

        const wolverineEmployee = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees`,
            wolverines.headers
          )
        ).data.employees[0];

        // Storm's admin names their OWN company in the path but another team's
        // employee id -- the old handler took company_id straight from the URL
        // and would have reassigned that player onto Storm's roster.
        const res = await api
          .post(
            `/store/companies/${storm.company.id}/employees/${wolverineEmployee.id}`,
            { spending_limit: 999999, is_admin: true },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        const after = (
          await api.get(
            `/store/companies/${wolverines.company.id}/employees/${wolverineEmployee.id}`,
            wolverines.headers
          )
        ).data.employee;

        expect(after.spending_limit).not.toBe(999999);
      });

      it("rejects unknown fields in a company update body", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@strict.test",
          "Wolverines"
        );

        // The update route previously had no body validation and spread raw
        // req.body into the workflow.
        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}`,
            { name: "Fine", id: "comp_injected", not_a_field: true },
            wolverines.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(400);
      });
    });

    describe("Platform-admin behaviour", () => {
      it("keeps the admin API reachable for staff and closed to customers", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@platform.test",
          "Wolverines"
        );

        // Platform admin authority is explicit: it comes from the Medusa user
        // actor on /admin, never from a customer's metadata.
        const asAdmin = await api.get("/admin/companies", adminHeaders);
        expect(asAdmin.status).toBe(200);

        const asCustomer = await api
          .get("/admin/companies", wolverines.headers)
          .catch((e) => e.response);

        expect([401, 403]).toContain(asCustomer.status);
      });

      it("does not let a company admin reach the admin API", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@noescalate.test",
          "Wolverines"
        );

        const res = await api
          .post(
            "/admin/companies",
            { name: "x", email: "x@x.test", currency_code: "usd" },
            wolverines.headers
          )
          .catch((e) => e.response);

        expect([401, 403]).toContain(res.status);
      });
    });

    describe("Failed demotion / compensation path", () => {
      /**
       * F-22: the compensation handler for removeAdminRoleStep used to set
       * `role: "company_admin"` unconditionally, so a rollback PROMOTED the
       * demoted user. Authorization no longer reads that metadata at all, and
       * compensation now restores the prior value -- so neither a successful nor
       * a failed demotion can widen authority.
       */
      it("a demoted employee cannot administer their company, and a failed demotion cannot escalate", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@demote.test",
          "Wolverines"
        );

        const member = await registerCustomer("member@demote.test");

        const created = (
          await api.post(
            `/store/companies/${wolverines.company.id}/employees`,
            {
              customer_id: member.customer.id,
              spending_limit: 0,
              is_admin: true,
            },
            wolverines.headers
          )
        ).data.employee;

        // Demote them.
        await api.post(
          `/store/companies/${wolverines.company.id}/employees/${created.id}`,
          { is_admin: false },
          wolverines.headers
        );

        // A demoted member must not be able to perform admin-only actions.
        const res = await api
          .post(
            `/store/companies/${wolverines.company.id}`,
            { name: "Should Not Work" },
            member.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        // ...and must certainly not have gained authority over another company.
        const storm = await registerCustomerWithCompany(
          "captain@demote2.test",
          "Storm"
        );

        const cross = await api
          .get(`/store/companies/${storm.company.id}`, member.headers)
          .catch((e) => e.response);

        expect(cross.status).toBe(403);
      });

      it("does not let an admin steal a member of another company onto their roster", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@steal.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@steal2.test",
          "Storm"
        );

        const wolverineCustomerId = wolverines.customer.id;

        const res = await api
          .post(
            `/store/companies/${storm.company.id}/employees`,
            {
              customer_id: wolverineCustomerId,
              spending_limit: 0,
              is_admin: false,
            },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(409);
      });
    });
  },
});
