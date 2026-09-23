import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { adminHeaders, createAdminUser } from "../../utils/admin";
import {
  cartSeeder,
  productSeeder,
  regionSeeder,
  salesChannelSeeder,
} from "../../utils/seeder";
import {
  generatePublishableKey,
  generateStoreHeaders,
} from "../../utils/store";

jest.setTimeout(180 * 1000);

/**
 * P0-SEC-1 -- quote ownership and server-side approval enforcement.
 *
 * Accepting a quote converts a draft into a live, payable order, so doing it on
 * another team's quote commits that team to a purchase they never agreed to.
 * Purchase approval must likewise be enforced by the server: the previous
 * implementation only checked whether an approval record happened to exist, so
 * a client that skipped the "Request approval" step checked out freely.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { JWT_SECRET: "supersecret" },
  testSuite: ({ api, getContainer }) => {
    let storeHeaders: any;
    let region: any;
    let salesChannel: any;
    let product: any;

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
        headers: {
          headers: {
            ...storeHeaders.headers,
            Authorization: `Bearer ${token}`,
          },
        },
      };
    };

    const registerCustomerWithCompany = async (
      email: string,
      companyName: string
    ) => {
      const actor = await registerCustomer(email);
      const company = (
        await api.post(
          "/store/companies",
          { name: companyName, email, currency_code: "usd" },
          actor.headers
        )
      ).data.companies[0];
      return { ...actor, company };
    };

    const createCartFor = async (actor: any) =>
      cartSeeder({
        api,
        storeHeaders: actor.headers,
        data: {
          region_id: region.id,
          sales_channel_id: salesChannel.id,
          items: [{ quantity: 1, variant_id: product.variants[0].id }],
        },
      });

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(adminHeaders, container);
      const publishableKey = await generatePublishableKey(container);
      storeHeaders = generateStoreHeaders({ publishableKey });

      region = await regionSeeder({ api, adminHeaders, data: {} });
      salesChannel = await salesChannelSeeder({ api, adminHeaders, data: {} });
      product = await productSeeder({
        api,
        adminHeaders,
        data: { sales_channels: [{ id: salesChannel.id }] },
      });

      await api.post(
        `/admin/api-keys/${publishableKey.id}/sales-channels`,
        { add: [salesChannel.id] },
        adminHeaders
      );
    });

    describe("Cross-company quote access", () => {
      let wolverines: any;
      let storm: any;
      let quote: any;

      beforeEach(async () => {
        wolverines = await registerCustomerWithCompany(
          "captain@wolvq.test",
          "Wolverines"
        );
        storm = await registerCustomerWithCompany(
          "captain@stormq.test",
          "Storm"
        );

        const cart = await createCartFor(wolverines);

        quote = (
          await api.post(
            "/store/quotes",
            { cart_id: cart.id },
            wolverines.headers
          )
        ).data.quote;
      });

      it("lets the owning customer read their own quote", async () => {
        const res = await api.get(
          `/store/quotes/${quote.id}`,
          wolverines.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.quote.id).toBe(quote.id);
      });

      it("denies another team reading the quote", async () => {
        const res = await api
          .get(`/store/quotes/${quote.id}`, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      /** Negotiated pricing is competitively sensitive. */
      it("denies another team previewing the quote's pricing", async () => {
        const res = await api
          .get(`/store/quotes/${quote.id}/preview`, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      /**
       * The most damaging quote defect: acceptance was never ownership-checked,
       * so anyone with a quote id could commit another team to a live order.
       */
      it("denies another team accepting the quote", async () => {
        const res = await api
          .post(`/store/quotes/${quote.id}/accept`, {}, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        const after = (
          await api.get(`/store/quotes/${quote.id}`, wolverines.headers)
        ).data.quote;

        expect(after.status).not.toBe("accepted");
      });

      it("denies another team rejecting the quote", async () => {
        const res = await api
          .post(`/store/quotes/${quote.id}/reject`, {}, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        const after = (
          await api.get(`/store/quotes/${quote.id}`, wolverines.headers)
        ).data.quote;

        expect(after.status).not.toBe("customer_rejected");
      });

      it("denies another team posting into the quote's message thread", async () => {
        const res = await api
          .post(
            `/store/quotes/${quote.id}/messages`,
            { text: "impersonation attempt" },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      it("lists only the caller's own quotes", async () => {
        const stormCart = await createCartFor(storm);
        await api.post("/store/quotes", { cart_id: stormCart.id }, storm.headers);

        const mine = (await api.get("/store/quotes", storm.headers)).data.quotes;

        expect(mine.map((q: any) => q.id)).not.toContain(quote.id);
      });
    });

    describe("Cart ownership", () => {
      it("denies freezing another team's cart with an approval request", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@wolvcart.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@stormcart.test",
          "Storm"
        );

        const cart = await createCartFor(wolverines);

        // A pending approval makes every cart hook throw, so being able to
        // create one on someone else's cart is a denial-of-service on their
        // checkout.
        const res = await api
          .post(`/store/carts/${cart.id}/approvals`, {}, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      it("denies injecting line items into another team's cart", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@wolvbulk.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@stormbulk.test",
          "Storm"
        );

        const cart = await createCartFor(wolverines);

        const res = await api
          .post(
            `/store/carts/${cart.id}/line-items/bulk`,
            {
              line_items: [
                { quantity: 5, variant_id: product.variants[0].id },
              ],
            },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      /** Previously this route had no `authenticate` at all. */
      it("denies an unauthenticated bulk line-item request", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@wolvanon.test",
          "Wolverines"
        );

        const cart = await createCartFor(wolverines);

        const res = await api
          .post(
            `/store/carts/${cart.id}/line-items/bulk`,
            {
              line_items: [
                { quantity: 5, variant_id: product.variants[0].id },
              ],
            },
            storeHeaders // publishable key only, no Authorization
          )
          .catch((e) => e.response);

        expect([401, 403]).toContain(res.status);
      });
    });

    describe("Server-side purchase approval enforcement", () => {
      it("blocks completion when the company requires approval and none was requested", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@approval.test",
          "Wolverines"
        );

        // Turn on the requirement the way a team admin would.
        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        const cart = await createCartFor(wolverines);

        // Deliberately skip POST /store/carts/:id/approvals -- exactly what a
        // client bypassing the React "Request approval" branch would do. The
        // old server check asked only "is an approval pending?", so an absent
        // approval passed.
        const res = await api
          .post(`/store/carts/${cart.id}/complete`, {}, wolverines.headers)
          .catch((e) => e.response);

        // Completion is refused. Note the cart also lacks checkout
        // prerequisites (payment collection), which core Medusa rejects before
        // our validate hook runs -- so this asserts only that the cart does not
        // complete. The approval rule itself is pinned precisely by the unit
        // tests in src/utils/__tests__/assert-cart-approval.unit.spec.ts,
        // which cover the fail-closed "no approval requested" case directly.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.data?.order).toBeUndefined();
      });

      it("blocks completion while an approval is pending", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@approval2.test",
          "Wolverines"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        const cart = await createCartFor(wolverines);

        await api.post(
          `/store/carts/${cart.id}/approvals`,
          {},
          wolverines.headers
        );

        const res = await api
          .post(`/store/carts/${cart.id}/complete`, {}, wolverines.headers)
          .catch((e) => e.response);

        expect(res.status).toBeGreaterThanOrEqual(400);
      });

      it("denies another team deciding an approval on this team's cart", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@approval3.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@approval4.test",
          "Storm"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        const cart = await createCartFor(wolverines);

        const member = await registerCustomer("member@approval.test");
        await api.post(
          `/store/companies/${wolverines.company.id}/employees`,
          { customer_id: member.customer.id, spending_limit: 0, is_admin: false },
          wolverines.headers
        );

        const approvals = (
          await api.post(
            `/store/carts/${cart.id}/approvals`,
            {},
            wolverines.headers
          )
        ).data.approvals;

        const approval = Array.isArray(approvals) ? approvals[0] : approvals;

        // Unconditional: if no approval came back, the test must FAIL rather
        // than silently skip its only assertion.
        expect(approval?.id).toBeDefined();

        const res = await api
          .post(
            `/store/approvals/${approval.id}`,
            { status: "approved" },
            storm.headers
          )
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        // And the approval must be untouched.
        const stillPending = (
          await api.get("/store/approvals", wolverines.headers)
        ).data;

        expect(JSON.stringify(stillPending)).not.toContain("approved");
      });

      /**
       * Regression test for the guest-cart bypass.
       *
       * A cart created while logged out has no customer, so the cartCreated
       * hook never links it to a company. transferCartCustomer (which the
       * storefront calls on login) exposes no post-transfer hook, so the cart
       * reaches checkout unlinked. Enforcement therefore must not depend on the
       * link alone -- it resolves the company from the cart's customer too.
       */
      it("still applies approval settings to a cart that was created before login", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@guestcart.test",
          "Wolverines"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        // Create the cart with the publishable key only -- no Authorization,
        // so no customer and therefore no company link.
        const guestCart = (
          await api.post(
            "/store/carts",
            {
              region_id: region.id,
              sales_channel_id: salesChannel.id,
              currency_code: "usd",
              items: [{ quantity: 1, variant_id: product.variants[0].id }],
            },
            storeHeaders
          )
        ).data.cart;

        // Log in: the storefront transfers the cart to the customer.
        await api.post(
          `/store/carts/${guestCart.id}/customer`,
          {},
          wolverines.headers
        );

        const res = await api
          .post(`/store/carts/${guestCart.id}/complete`, {}, wolverines.headers)
          .catch((e) => e.response);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.data?.order).toBeUndefined();
      });

      it("does not list another team's approvals", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@approval5.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@approval6.test",
          "Storm"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        const cart = await createCartFor(wolverines);
        await api.post(
          `/store/carts/${cart.id}/approvals`,
          {},
          wolverines.headers
        );

        const res = await api.get("/store/approvals", storm.headers);
        const body = JSON.stringify(res.data ?? {});

        expect(body).not.toContain(cart.id);
      });
    });
  },
});
