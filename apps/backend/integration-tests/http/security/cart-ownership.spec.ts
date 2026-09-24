import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { adminHeaders, createAdminUser } from "../../utils/admin";
import {
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
 * P0-SEC-7 -- possession of a cart ID is never sufficient authority.
 *
 * Core's `POST /store/carts/:id/customer` passed `req.params.id` straight into
 * `transferCartCustomerWorkflow` and returned the full refetched cart, so any
 * authenticated customer holding any cart id could claim someone else's basket
 * and read its contents. Every other `/store/carts/:id*` route had the same
 * shape.
 *
 * The rule has to hold in two worlds at once: anonymous shopping, where the
 * cart id legitimately IS the bearer token, and authenticated ownership, where
 * it must not be. These tests pin both.
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

    /** A cart created with no Authorization header -- anonymous. */
    const createAnonymousCart = async () =>
      (
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

    /** A cart created while authenticated -- owned. */
    const createOwnedCart = async (actor: any) =>
      (
        await api.post(
          "/store/carts",
          {
            region_id: region.id,
            sales_channel_id: salesChannel.id,
            currency_code: "usd",
            items: [{ quantity: 1, variant_id: product.variants[0].id }],
          },
          actor.headers
        )
      ).data.cart;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(adminHeaders, container);
      const publishableKey = await generatePublishableKey(container);
      storeHeaders = generateStoreHeaders({ publishableKey });

      region = await regionSeeder({
        api,
        adminHeaders,
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

    describe("Authenticated cross-customer takeover", () => {
      it("denies transferring another customer's cart to yourself", async () => {
        const victim = await registerCustomer("victim@takeover.test");
        const attacker = await registerCustomer("attacker@takeover.test");

        const cart = await createOwnedCart(victim);

        const res = await api
          .post(`/store/carts/${cart.id}/customer`, {}, attacker.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);

        // The cart must still belong to the victim.
        const after = (await api.get(`/store/carts/${cart.id}`, victim.headers))
          .data.cart;
        expect(after.customer_id).toBe(victim.customer.id);
      });

      it("denies INSPECTING another customer's cart", async () => {
        const victim = await registerCustomer("victim2@takeover.test");
        const attacker = await registerCustomer("attacker2@takeover.test");

        const cart = await createOwnedCart(victim);

        const res = await api
          .get(`/store/carts/${cart.id}`, attacker.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
        // The denial must not carry the basket. The takeover route returned the
        // full refetched cart, which is how the contents leaked.
        expect(res.data?.cart).toBeUndefined();
        expect(JSON.stringify(res.data ?? {})).not.toContain(
          product.variants[0].id
        );
      });

      it("denies MUTATING another customer's cart", async () => {
        const victim = await registerCustomer("victim3@takeover.test");
        const attacker = await registerCustomer("attacker3@takeover.test");

        const cart = await createOwnedCart(victim);

        const update = await api
          .post(
            `/store/carts/${cart.id}`,
            { email: "attacker3@takeover.test" },
            attacker.headers
          )
          .catch((e) => e.response);
        expect(update.status).toBe(403);

        const lineItem = await api
          .post(
            `/store/carts/${cart.id}/line-items`,
            { quantity: 5, variant_id: product.variants[0].id },
            attacker.headers
          )
          .catch((e) => e.response);
        expect(lineItem.status).toBe(403);
      });

      it("denies COMPLETING another customer's cart", async () => {
        const victim = await registerCustomer("victim4@takeover.test");
        const attacker = await registerCustomer("attacker4@takeover.test");

        const cart = await createOwnedCart(victim);

        const res = await api
          .post(`/store/carts/${cart.id}/complete`, {}, attacker.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });

      it("denies an UNAUTHENTICATED caller reaching an owned cart", async () => {
        const victim = await registerCustomer("victim5@takeover.test");
        const cart = await createOwnedCart(victim);

        const res = await api
          .get(`/store/carts/${cart.id}`, storeHeaders)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
      });
    });

    describe("Anonymous-to-authenticated ownership transition", () => {
      /**
       * The flow P0-SEC-1 repaired and this must not re-break: shop logged out,
       * sign in at checkout, keep the basket.
       */
      it("allows claiming an anonymous cart", async () => {
        const shopper = await registerCustomer("shopper@anon.test");
        const cart = await createAnonymousCart();

        const res = await api.post(
          `/store/carts/${cart.id}/customer`,
          {},
          shopper.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.cart.customer_id).toBe(shopper.customer.id);
      });

      it("allows an anonymous caller to read and mutate an unclaimed cart", async () => {
        // For an unclaimed cart the id legitimately is the bearer token; this
        // is Medusa's guest-shopping model and must keep working.
        const cart = await createAnonymousCart();

        const read = await api.get(`/store/carts/${cart.id}`, storeHeaders);
        expect(read.status).toBe(200);

        const update = await api.post(
          `/store/carts/${cart.id}`,
          { email: "guest@anon.test" },
          storeHeaders
        );
        expect(update.status).toBe(200);
      });

      it("closes the cart to everyone else once it is claimed", async () => {
        const shopper = await registerCustomer("shopper2@anon.test");
        const other = await registerCustomer("other2@anon.test");
        const cart = await createAnonymousCart();

        await api.post(`/store/carts/${cart.id}/customer`, {}, shopper.headers);

        // The owner keeps access...
        const owner = await api.get(`/store/carts/${cart.id}`, shopper.headers);
        expect(owner.status).toBe(200);

        // ...and the id alone no longer works for anyone else.
        const stranger = await api
          .get(`/store/carts/${cart.id}`, other.headers)
          .catch((e) => e.response);
        expect(stranger.status).toBe(403);

        const anon = await api
          .get(`/store/carts/${cart.id}`, storeHeaders)
          .catch((e) => e.response);
        expect(anon.status).toBe(403);
      });

      /**
       * S-4. The `has_account === false` branch had NO coverage: the test above
       * only ever reaches the "no customer at all" branch, because Medusa
       * creates the guest customer *as part of* the request that sets the email.
       * Deleting the guest branch alone therefore left every test green while
       * breaking guest checkout at the very next request. This is the test that
       * was missing.
       */
      it("keeps a guest shopper working after they enter their email", async () => {
        const cart = await createAnonymousCart();

        // Setting an email attaches a has_account:false customer to the cart.
        const setEmail = await api.post(
          `/store/carts/${cart.id}`,
          { email: "parent@guest.test" },
          storeHeaders
        );
        expect(setEmail.status).toBe(200);
        expect(setEmail.data.cart.customer_id).toBeTruthy();

        // From here the cart HAS a customer, so every subsequent request takes
        // the guest branch rather than the unclaimed one.
        const read = await api.get(`/store/carts/${cart.id}`, storeHeaders);
        expect(read.status).toBe(200);

        const addItem = await api.post(
          `/store/carts/${cart.id}/line-items`,
          { quantity: 1, variant_id: product.variants[0].id },
          storeHeaders
        );
        expect(addItem.status).toBe(200);

        // ...and it is still claimable by the shopper when they sign in.
        const shopper = await registerCustomer("parent@guest-signup.test");
        const claim = await api.post(
          `/store/carts/${cart.id}/customer`,
          {},
          shopper.headers
        );
        expect(claim.status).toBe(200);
        expect(claim.data.cart.customer_id).toBe(shopper.customer.id);
      });

      it("is idempotent when the owner re-claims their own cart", async () => {
        const shopper = await registerCustomer("shopper3@anon.test");
        const cart = await createAnonymousCart();

        await api.post(`/store/carts/${cart.id}/customer`, {}, shopper.headers);

        const again = await api.post(
          `/store/carts/${cart.id}/customer`,
          {},
          shopper.headers
        );

        expect(again.status).toBe(200);
        expect(again.data.cart.customer_id).toBe(shopper.customer.id);
      });
    });

    describe("Company-link and approval-queue preservation", () => {
      /**
       * The link-repair subscriber moves a cart's company link on transfer, so
       * a takeover would also have moved the cart out of the victim team
       * admin's approval queue and put a pending approval under the attacker's
       * company. Blocking the takeover must preserve both.
       */
      it("keeps the company link with the owning team after a blocked takeover", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@cartlink.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@cartlink2.test",
          "Storm"
        );

        const cart = await createOwnedCart(wolverines);

        // Read the company LINK directly through the container. The store cart
        // route does not expose `company` as a selectable field, and asserting
        // customer_id alone would only duplicate the takeover tests above.
        const linkedCompanyId = async () => {
          const query = getContainer().resolve("query");
          const { data } = await query.graph({
            entity: "cart",
            fields: ["id", "company.id"],
            filters: { id: cart.id },
          });
          return (data?.[0] as any)?.company?.id;
        };

        // Precondition: the cart is linked to the Wolverines before the attack,
        // otherwise "the link was preserved" would be vacuously true.
        expect(await linkedCompanyId()).toBe(wolverines.company.id);

        const res = await api
          .post(`/store/carts/${cart.id}/customer`, {}, storm.headers)
          .catch((e) => e.response);
        expect(res.status).toBe(403);

        const after = (
          await api.get(`/store/carts/${cart.id}`, wolverines.headers)
        ).data.cart;
        expect(after.customer_id).toBe(wolverines.customer.id);

        // The actual company-link assertion. A successful takeover would have
        // moved this to Storm via the link-repair subscriber.
        const companyAfter = await linkedCompanyId();
        expect(companyAfter).toBe(wolverines.company.id);
        expect(companyAfter).not.toBe(storm.company.id);
      });

      it("keeps a pending approval in the owning team's queue", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@cartq.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@cartq2.test",
          "Storm"
        );

        await api.post(
          `/store/companies/${wolverines.company.id}/approval-settings`,
          { requires_admin_approval: true },
          wolverines.headers
        );

        const cart = await createOwnedCart(wolverines);
        await api.post(
          `/store/carts/${cart.id}/approvals`,
          {},
          wolverines.headers
        );

        // Attempted takeover.
        const takeover = await api
          .post(`/store/carts/${cart.id}/customer`, {}, storm.headers)
          .catch((e) => e.response);
        expect(takeover.status).toBe(403);

        // The Storm admin must not see the Wolverines' cart in their queue.
        const stormQueue = await api.get("/store/approvals", storm.headers);
        expect(JSON.stringify(stormQueue.data ?? {})).not.toContain(cart.id);

        // The Wolverines admin still does.
        const ownQueue = await api.get("/store/approvals", wolverines.headers);
        expect(JSON.stringify(ownQueue.data ?? {})).toContain(cart.id);
      });
    });

    /**
     * The cause is "a cart id is treated as authority", not "/store/carts/** is
     * unguarded". These routes take a cart id from a BODY or QUERY STRING and
     * were missed by the first pass, which only covered path parameters.
     */
    describe("Cart ID as authority via body and query", () => {
      it("denies creating a quote from another team's cart", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@quoteleak.test",
          "Wolverines"
        );
        const storm = await registerCustomerWithCompany(
          "captain@quoteleak2.test",
          "Storm"
        );

        const cart = await createOwnedCart(wolverines);

        // createRequestForQuoteWorkflow reads the cart's items and addresses and
        // builds a draft order under the CALLER's customer_id -- so the quote is
        // legitimately the attacker's and passes every later ownership check.
        // The victim is never notified.
        const res = await api
          .post("/store/quotes", { cart_id: cart.id }, storm.headers)
          .catch((e) => e.response);

        expect(res.status).toBe(403);
        expect(JSON.stringify(res.data ?? {})).not.toContain(
          product.variants[0].id
        );

        // And no quote was created for the attacker.
        const stormQuotes = (await api.get("/store/quotes", storm.headers)).data
          .quotes;
        expect(stormQuotes).toHaveLength(0);
      });

      it("still allows quoting your own cart", async () => {
        const wolverines = await registerCustomerWithCompany(
          "captain@quoteok.test",
          "Wolverines"
        );
        const cart = await createOwnedCart(wolverines);

        const res = await api.post(
          "/store/quotes",
          { cart_id: cart.id },
          wolverines.headers
        );

        expect(res.status).toBe(200);
        expect(res.data.quote.cart_id).toBe(cart.id);
      });

      it("denies reading another customer's basket total via free-shipping prices", async () => {
        const victim = await registerCustomer("victim@freeship.test");
        const attacker = await registerCustomer("attacker@freeship.test");

        const cart = await createOwnedCart(victim);

        const res = await api
          .get(`/store/free-shipping/prices?cart_id=${cart.id}`, attacker.headers)
          .catch((e) => e.response);
        expect(res.status).toBe(403);

        // The route previously needed no credentials at all.
        const anon = await api
          .get(`/store/free-shipping/prices?cart_id=${cart.id}`, storeHeaders)
          .catch((e) => e.response);
        expect(anon.status).toBe(403);
      });

      it("no longer distinguishes a real cart from an unknown one on free-shipping prices", async () => {
        const victim = await registerCustomer("victim2@freeship.test");
        const attacker = await registerCustomer("attacker2@freeship.test");
        const cart = await createOwnedCart(victim);

        const real = await api
          .get(`/store/free-shipping/prices?cart_id=${cart.id}`, attacker.headers)
          .catch((e) => e.response);
        const fake = await api
          .get(
            "/store/free-shipping/prices?cart_id=cart_01DOESNOTEXIST",
            attacker.headers
          )
          .catch((e) => e.response);

        // Previously 200 vs 404 -- a clean cart-existence oracle.
        expect(real.status).toBe(403);
        expect(fake.status).toBe(403);
        expect(real.data?.message).toBe(fake.data?.message);
      });

      it("denies creating a payment collection on another customer's cart", async () => {
        const victim = await registerCustomer("victim@paycol.test");
        const attacker = await registerCustomer("attacker@paycol.test");

        const cart = await createOwnedCart(victim);

        // The response carried `amount` -- the victim's basket total -- and the
        // call also created state on their checkout.
        const res = await api
          .post("/store/payment-collections", { cart_id: cart.id }, attacker.headers)
          .catch((e) => e.response);
        expect(res.status).toBe(403);

        const anon = await api
          .post("/store/payment-collections", { cart_id: cart.id }, storeHeaders)
          .catch((e) => e.response);
        expect(anon.status).toBe(403);
      });

      it("still allows a payment collection on your own cart", async () => {
        const shopper = await registerCustomer("shopper@paycol.test");
        const cart = await createOwnedCart(shopper);

        const res = await api.post(
          "/store/payment-collections",
          { cart_id: cart.id },
          shopper.headers
        );

        expect(res.status).toBe(200);
      });
    });

    describe("Safe error behaviour", () => {
      it("returns the same denial for an unknown cart id as for a forbidden one", async () => {
        const victim = await registerCustomer("victim@oracle.test");
        const attacker = await registerCustomer("attacker@oracle.test");

        const cart = await createOwnedCart(victim);

        const forbidden = await api
          .get(`/store/carts/${cart.id}`, attacker.headers)
          .catch((e) => e.response);

        const unknown = await api
          .get("/store/carts/cart_does_not_exist", attacker.headers)
          .catch((e) => e.response);

        // Distinguishable responses would turn the endpoint into an oracle for
        // which cart ids exist.
        expect(forbidden.status).toBe(403);
        expect(unknown.status).toBe(403);
        expect(unknown.data?.message).toBe(forbidden.data?.message);
      });

      it("does not leak cart contents or the owner's identity in a denial", async () => {
        const victim = await registerCustomer("victim2@oracle.test");
        const attacker = await registerCustomer("attacker2@oracle.test");

        const cart = await createOwnedCart(victim);

        const res = await api
          .post(`/store/carts/${cart.id}/customer`, {}, attacker.headers)
          .catch((e) => e.response);

        const body = JSON.stringify(res.data ?? {});
        expect(res.status).toBe(403);
        expect(body).not.toContain(victim.customer.id);
        expect(body).not.toContain("victim2@oracle.test");
        expect(body).not.toContain(product.variants[0].id);
      });
    });
  },
});
