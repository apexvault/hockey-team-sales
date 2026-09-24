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

        const res = await api
          .post(`/store/carts/${cart.id}/customer`, {}, storm.headers)
          .catch((e) => e.response);
        expect(res.status).toBe(403);

        const after = (
          await api.get(`/store/carts/${cart.id}`, wolverines.headers)
        ).data.cart;

        expect(after.customer_id).toBe(wolverines.customer.id);
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
