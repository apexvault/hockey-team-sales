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

    /**
     * Give a cart a payment collection and session.
     *
     * Without this, `POST /store/carts/:id/complete` fails inside
     * `validateCartPaymentsStep`, which core runs BEFORE the `validate` hook --
     * so `validate-cart-completion.ts` is never reached and any assertion about
     * approval enforcement passes on an unrelated payment error. A test that
     * cannot fail on the bug it names is worse than no test, because it is
     * recorded as coverage.
     */
    const makeCartPayable = async (cartId: string, actor: any) => {
      const collection = (
        await api.post(
          "/store/payment-collections",
          { cart_id: cartId },
          actor.headers
        )
      ).data.payment_collection;

      await api.post(
        `/store/payment-collections/${collection.id}/payment-sessions`,
        { provider_id: "pp_system_default" },
        actor.headers
      );

      return collection;
    };

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(adminHeaders, container);
      const publishableKey = await generatePublishableKey(container);
      storeHeaders = generateStoreHeaders({ publishableKey });

      region = await regionSeeder({
        api,
        adminHeaders,
        // Enable the manual provider so a payment session can be created and
        // cart completion reaches our validate hook. Passed here rather than in
        // the shared seeder to keep the fixture repair minimal.
        data: { payment_providers: ["pp_system_default"] },
      });
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

      /**
       * The affirmative half of F-32. The handler used to re-filter on the
       * caller's own customer_id, so this capability -- which the middleware
       * explicitly authorises -- silently returned 404. Without this test,
       * re-adding that filter would pass every other test in the suite.
       */
      it("lets a company admin read a teammate's quote", async () => {
        const teammate = await registerCustomer("player@wolvq.test");

        await api.post(
          `/store/companies/${wolverines.company.id}/employees`,
          {
            customer_id: teammate.customer.id,
            spending_limit: 0,
            is_admin: false,
          },
          wolverines.headers
        );

        const teammateCart = await createCartFor(teammate);
        const teammateQuote = (
          await api.post(
            "/store/quotes",
            { cart_id: teammateCart.id },
            teammate.headers
          )
        ).data.quote;

        // wolverines is the company admin; the quote belongs to the teammate.
        const res = await api.get(
          `/store/quotes/${teammateQuote.id}`,
          wolverines.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.quote.id).toBe(teammateQuote.id);
      });

      it("still forbids a company admin from ACCEPTING a teammate's quote", async () => {
        // Reads are company-scoped; mutations are owner-only. Pins the
        // `ownerOnly` distinction, which nothing else asserts.
        const teammate = await registerCustomer("player2@wolvq.test");

        await api.post(
          `/store/companies/${wolverines.company.id}/employees`,
          {
            customer_id: teammate.customer.id,
            spending_limit: 0,
            is_admin: false,
          },
          wolverines.headers
        );

        const teammateCart = await createCartFor(teammate);
        const teammateQuote = (
          await api.post(
            "/store/quotes",
            { cart_id: teammateCart.id },
            teammate.headers
          )
        ).data.quote;

        const res = await api
          .post(
            `/store/quotes/${teammateQuote.id}/accept`,
            {},
            wolverines.headers
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
        // Satisfy the checkout prerequisites so core's own validation passes
        // and execution actually reaches our validate hook.
        await makeCartPayable(cart.id, wolverines);

        const res = await api
          .post(`/store/carts/${cart.id}/complete`, {}, wolverines.headers)
          .catch((e) => e.response);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.data?.order).toBeUndefined();
        // The refusal must be the APPROVAL one specifically -- not a payment
        // or shipping error that would mask a deleted approval check.
        expect(JSON.stringify(res.data ?? {})).toMatch(/approval/i);
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

        await makeCartPayable(guestCart.id, wolverines);

        const res = await api
          .post(`/store/carts/${guestCart.id}/complete`, {}, wolverines.headers)
          .catch((e) => e.response);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.data?.order).toBeUndefined();
        // Must be refused FOR APPROVAL. Without the customer-derived fallback
        // (and the link-repair subscriber) this cart has no company, so the
        // requirement would not be found and the cart would complete.
        expect(JSON.stringify(res.data ?? {})).toMatch(/approval/i);
      });

      /**
       * The other half of the same flow: once the link is repaired, the shopper
       * must be able to REQUEST approval. Routing around the link in the
       * completion guard alone left this returning
       * "No enabled approval types found", making the cart a dead end.
       */
      it("lets a cart created before login still request approval", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@guestcart2.test",
          "Wolverines"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

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

        await api.post(
          `/store/carts/${guestCart.id}/customer`,
          {},
          wolverines.headers
        );

        const res = await api
          .post(`/store/carts/${guestCart.id}/approvals`, {}, wolverines.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(200);
      });

      /**
       * Separation of duties applies only where a second admin exists (F-30).
       * Both directions are pinned: without the first test the deadlock
       * regression returns silently; without the second, the four-eyes rule
       * could be dropped entirely and nothing would fail.
       */
      const raiseApprovalOnOwnCart = async (actor: any, company: any) => {
        await api.post(
          `/store/companies/${company.id}/approval-settings`,
          { requires_admin_approval: true },
          actor.headers
        );

        const cart = await createCartFor(actor);

        const approvals = (
          await api.post(`/store/carts/${cart.id}/approvals`, {}, actor.headers)
        ).data.approvals;

        const approval = Array.isArray(approvals) ? approvals[0] : approvals;
        expect(approval?.id).toBeDefined();
        return approval;
      };

      it("lets the ONLY admin decide their own request, so a solo team is not deadlocked", async () => {
        const solo = await registerCustomerWithCompany(
          "captain@solo.test",
          "Solo Wolverines"
        );

        const approval = await raiseApprovalOnOwnCart(solo, solo.company);

        const res = await api.post(
          `/store/approvals/${approval.id}`,
          { status: "approved" },
          solo.headers
        );

        expect(res.status).toBe(200);
      });

      it("forbids self-approval once the team has a second admin", async () => {
        const team = await registerCustomerWithCompany(
          "captain@duo.test",
          "Duo Wolverines"
        );

        const coAdmin = await registerCustomer("assistant@duo.test");
        await api.post(
          `/store/companies/${team.company.id}/employees`,
          {
            customer_id: coAdmin.customer.id,
            spending_limit: 0,
            is_admin: true,
          },
          team.headers
        );

        const approval = await raiseApprovalOnOwnCart(team, team.company);

        const selfRes = await api
          .post(
            `/store/approvals/${approval.id}`,
            { status: "approved" },
            team.headers
          )
          .catch((e) => e.response);

        expect(selfRes.status).toBe(403);

        // ...but the other admin can decide it, so the cart is not stuck.
        const otherRes = await api.post(
          `/store/approvals/${approval.id}`,
          { status: "approved" },
          coAdmin.headers
        );

        expect(otherRes.status).toBe(200);
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
