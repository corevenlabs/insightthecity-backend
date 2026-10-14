/* Isolated PostgreSQL integration. Never run against a production database.
   DB_DATABASE=itc_crm_test DB_PORT=55439 DB_HOST=127.0.0.1 DB_USER=... node --test tests/partner-crm.integration.js */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const jwt = require("jsonwebtoken");
if (
  process.env.DB_DATABASE !== "itc_crm_test" ||
  !["127.0.0.1", "localhost"].includes(process.env.DB_HOST)
)
  throw new Error("Use isolated local itc_crm_test database");
process.env.OPENAI_API_KEY = "test-only-never-call";
process.env.JWT_SECRET = "isolated-crm-test-secret-not-production";
process.env.PANEL_PUBLIC_URL = "http://localhost:5173";
process.env.PARTNER_STRIPE_WEBHOOK_SECRET = "whsec_isolated_partner";
process.env.STRIPE_SECRET_KEY = "sk_test_isolated_not_real";
const db = require("../config/db");
const S = require("../services/partner-crm.service");
const stripe = require("../services/stripe.service");
const smtp = require("../services/password-reset-mail.service");
stripe.retrievePartnerReceiptData = async session => require("./fixtures/partner-receipt.cjs").receiptData(session);
const emails = [];
smtp.isConfigured = () => true;
smtp.send = async (message) => {
  emails.push(message);
};
let server, base;
const actors = {};
const bearer = (role) =>
  jwt.sign({ id: actors[role].id, type: "staff" }, process.env.JWT_SECRET);
async function api(
  path,
  { role = "admin", token, method = "GET", data, form } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: token ? `Partner ${token}` : `Bearer ${bearer(role)}`,
      ...(!form ? { "Content-Type": "application/json" } : {}),
    },
    body: form || (data && JSON.stringify(data)),
  });
  const body = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body };
}
function token(row) {
  return new URL(row.link).hash.slice(1);
}
let strategic, paid;
test("complete CRM flow, authorization, consent, payment idempotency and private downloads", async (t) => {
  for (const name of [
    "schema.sql",
    "experience-gallery.sql",
    "partner-crm.sql",
  ])
    await db.query(fs.readFileSync(`database/${name}`, "utf8"));
  await db.query("TRUNCATE admins, experiences CASCADE");
  // Reapplying is a supported migration path.
  await db.query(fs.readFileSync("database/partner-crm.sql", "utf8"));
  for (const role of ["admin", "editor", "executive", "other"])
    actors[role] = (
      await db.query(
        "INSERT INTO admins(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
        [
          `${role}@example.com`,
          role,
          "unused",
          role === "other" ? "executive" : role,
        ],
      )
    ).rows[0];
  const app = require("../server");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  await t.test(
    "roles enforced server-side and staff tokens cannot be substituted by app tokens",
    async () => {
      assert.equal((await api("/staff", { role: "executive" })).status, 403);
      assert.equal((await api("/users", { role: "editor" })).status, 403);
      assert.equal(
        (await api("/experiences?published=all", { role: "executive" })).status,
        403,
      );
      const response = await fetch(base + "/staff/me", {
        headers: {
          Authorization: `Bearer ${jwt.sign({ id: actors.admin.id, type: "user" }, process.env.JWT_SECRET)}`,
        },
      });
      assert.equal(response.status, 403);
      assert.equal(
        (
          await api("/partners/clients", {
            role: "editor",
            method: "POST",
            data: {},
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "executive can create own client, cannot choose another owner, cannot invite without approved terms",
    async () => {
      const result = await api("/partners/clients", {
        role: "executive",
        method: "POST",
        data: {
          business_name: "Strategic Cafe",
          contact_name: "Owner",
          email: "cafe@example.com",
          category: "strategic",
          owner_id: actors.other.id,
          language: "pt",
        },
      });
      assert.equal(result.status, 201);
      strategic = result.body;
      assert.equal(strategic.owner_id, actors.executive.id);
      assert.equal(
        (await api(`/partners/clients/${strategic.id}`, { role: "other" }))
          .status,
        404,
      );
      assert.equal(
        (
          await api(`/partners/clients/${strategic.id}/actions`, {
            role: "executive",
            method: "POST",
            data: { action: "invite" },
          })
        ).status,
        409,
      );
      assert.equal(
        (await api("/partners/clients", { role: "other" })).body.length,
        0,
      );
    },
  );
  await t.test(
    "versioned agreements pin the original document and revoke replaced links",
    async () => {
      for (const variant of ["strategic", "founding"])
        for (const language of ["en"])
          assert.equal(
            (
              await api("/partners/terms", {
                method: "POST",
                data: {
                  variant,
                  language,
                  title: "TEST ONLY agreement",
                  content: `TEST ONLY ${variant} ${language}`,
                  approve: true,
                },
              })
            ).status,
            201,
          );
      let result = await api(`/partners/clients/${strategic.id}/actions`, {
        role: "executive",
        method: "POST",
        data: { action: "invite" },
      });
      assert.equal(result.status, 200);
      strategic = result.body;
      const oldToken = token(strategic);
      await api("/partners/terms", {
        method: "POST",
        data: {
          variant: "strategic",
          language: "en",
          title: "TEST ONLY new version",
          content: "Changed terms",
          approve: true,
        },
      });
      assert.equal(
        (await api("/partners/access", { token: oldToken })).body.terms.en
          .version,
        1,
      );
      result = await api(`/partners/clients/${strategic.id}/actions`, {
        role: "executive",
        method: "POST",
        data: { action: "resend" },
      });
      strategic = result.body;
      assert.equal(
        (await api("/partners/access", { token: oldToken })).status,
        401,
      );
    },
  );
  await t.test("admin corrects client email, revokes old link and resend targets corrected address", async () => {
    const oldToken = token(strategic);
    const data = { action: "contact", business_name: strategic.business_name,
      contact_name: strategic.contact_name, phone: "", language: "pt", email: "corrected@example.com" };
    assert.equal((await api(`/partners/clients/${strategic.id}/actions`, {
      role: "executive", method: "POST", data,
    })).status, 403);
    assert.equal((await api(`/partners/clients/${strategic.id}/actions`, {
      method: "POST", data: { ...data, email: "invalid" },
    })).status, 400);
    const result = await api(`/partners/clients/${strategic.id}/actions`, { method: "POST", data });
    assert.equal(result.status, 200);
    strategic = result.body;
    assert.equal(strategic.email, "corrected@example.com");
    assert.equal((await api("/partners/access", { token: oldToken })).status, 401);
    assert.equal(strategic.terms_snapshot.en.version, 1);
    const resent = await api(`/partners/clients/${strategic.id}/actions`, {
      method: "POST", data: { action: "resend" },
    });
    assert.equal(resent.status, 200);
    strategic = resent.body;
    assert.ok(emails.some((m) => m.to.includes("corrected@example.com")));
  });
  const content = {
    businessName: "Strategic Cafe",
    description: "Cafe description",
    address: "123 NY",
    region: "NY",
    hours: "9 AM – 5 PM",
    benefit: "2 × 1 breakfast",
    conditions: "Weekdays only",
    method: "qr",
    instructions: "Show your generated QR",
    perUser: "1",
    inventory: "unlimited",
    signerName: "Business Owner",
  };
  await t.test(
    "draft save, distinct photos, consent and locked submission",
    async () => {
      const access = token(strategic);
      assert.equal(
        (
          await api("/partners/access/save", {
            token: access,
            method: "POST",
            data: { content, language: "pt" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await api("/partners/access/submit", {
            token: access,
            method: "POST",
            data: { content, language: "pt", accept: true, authorize: true },
          })
        ).status,
        400,
      );
      for (let i = 0; i < 5; i++) {
        const f = new FormData();
        f.append("kind", i ? "photo" : "logo");
        f.append(
          "file",
          new Blob([Buffer.from([255, 216, 255, i, 1, 2, 3])], {
            type: "image/jpeg",
          }),
          `photo${i}.jpg`,
        );
        assert.equal(
          (
            await api("/partners/access/files", {
              token: access,
              method: "POST",
              form: f,
            })
          ).status,
          201,
        );
      }
      const f = new FormData();
      f.append("kind", "photo");
      f.append(
        "file",
        new Blob([Buffer.from([255, 216, 255, 1, 1, 2, 3])]),
        "duplicate.jpg",
      );
      assert.equal(
        (
          await api("/partners/access/files", {
            token: access,
            method: "POST",
            form: f,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api("/partners/access/submit", {
            token: access,
            method: "POST",
            data: { content, language: "pt", authorize: false },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api("/partners/access/submit", {
            token: access,
            method: "POST",
            data: { content: { ...content, signerName: "" }, language: "pt", authorize: true },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await api("/partners/access/save", {
            token: access,
            method: "POST",
            data: { content },
          })
        ).status,
        409,
      );
      const detail = (
        await api(`/partners/clients/${strategic.id}`, { role: "executive" })
      ).body;
      assert.equal(detail.acceptances.length, 1);
      assert.equal(detail.acceptances[0].document.version, 1);
      assert.equal(detail.acceptances[0].language, "en");
      assert.equal(detail.acceptances[0].document.language, "en");
      assert.equal(detail.acceptances[0].document.materialAuthorizationLanguage, "pt");
      assert.equal(
        detail.emails.filter((m) => m.recipient === actors.executive.email)
          .length,
        1,
      );
    },
  );
  await t.test(
    "editor is redacted, foreign private files are denied, ZIP contains PDF",
    async () => {
      const result = await api(`/partners/clients/${strategic.id}`, {
        role: "editor",
      });
      assert.equal(result.status, 200);
      for (const key of [
        "amount_cents",
        "payment_status",
        "terms_snapshot",
        "activity",
        "acceptances",
        "emails",
        "link",
      ])
        assert.equal(key in result.body, false);
      assert.equal(
        (
          await api(
            `/partners/clients/${strategic.id}/files/${result.body.files[0].id}`,
            { role: "other" },
          )
        ).status,
        404,
      );
      const zip = await api(`/partners/clients/${strategic.id}/download`, {
        role: "editor",
      });
      assert.equal(zip.status, 200);
      assert.equal(zip.body.subarray(0, 2).toString(), "PK");
      assert.ok(zip.body.includes(Buffer.from("business-information.pdf")));
      assert.ok(!zip.body.includes(Buffer.from("accepted-agreements.json")));
    },
  );
  await t.test(
    "manual approval and activation start one six-month period and one publication email",
    async () => {
      assert.equal(
        (
          await api(`/partners/clients/${strategic.id}/actions`, {
            role: "executive",
            method: "POST",
            data: { action: "activate", experience_id: "cafe" },
          })
        ).status,
        403,
      );
      await api(`/partners/clients/${strategic.id}/actions`, {
        role: "editor",
        method: "POST",
        data: { action: "ready" },
      });
      await db.query(
        "INSERT INTO experiences(id,title,category,access,is_published,image_url,gallery_urls,member_benefit,benefit_action) VALUES('cafe','Cafe','FOOD','premium',TRUE,'https://example.com/1.jpg','[\"https://example.com/2.jpg\",\"https://example.com/3.jpg\",\"https://example.com/4.jpg\"]','2 x 1','qr')",
      );
      const activated = await api(`/partners/clients/${strategic.id}/actions`, {
        role: "editor",
        method: "POST",
        data: { action: "activate", experience_id: "cafe" },
      });
      assert.equal(activated.status, 200);
      assert.ok(activated.body.activated_at);
      assert.equal(
        (
          await api(`/partners/clients/${strategic.id}/actions`, {
            role: "editor",
            method: "POST",
            data: { action: "activate", experience_id: "cafe" },
          })
        ).status,
        409,
      );
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT COUNT(*) FROM partner_periods WHERE client_id=$1",
              [strategic.id],
            )
          ).rows[0].count,
        ),
        1,
      );
    },
  );
  await t.test("publications derive partner type only from an activated unambiguous client link", async () => {
    assert.equal((await api("/experiences/cafe")).body.partnerOffer, "strategic");
    const partner = await S.create({business_name:"Disclosure cafe",contact_name:"Owner",email:"disclosure@example.com",category:"partner",offer:"founding",payment_method:"stripe"}, actors.admin);
    await db.query("INSERT INTO experiences(id,title,category,access,is_published) VALUES('disclosure','Disclosure','FOOD','premium',TRUE)");
    await db.query("UPDATE partner_clients SET experience_id='disclosure' WHERE id=$1", [partner.id]);
    assert.equal((await api("/experiences/disclosure")).body.partnerOffer, null);
    await db.query("UPDATE partner_clients SET activated_at=NOW() WHERE id=$1", [partner.id]);
    assert.equal((await api("/experiences/disclosure")).body.partnerOffer, "founding");
    const list = (await api("/experiences")).body;
    assert.equal(list.find(item=>item.id==='disclosure').partnerOffer, "founding");
    await db.query("UPDATE partner_clients SET experience_id='cafe' WHERE id=$1", [partner.id]);
    assert.equal((await api("/experiences/cafe")).body.partnerOffer, null);
    await db.query("UPDATE partner_clients SET experience_id=NULL WHERE id=$1", [partner.id]);
    assert.equal((await api("/experiences/cafe")).body.partnerOffer, "strategic");
  });
  await t.test(
    "Stripe validates actual session, amount and currency; replay does not duplicate mail or period",
    async () => {
      const created = await api("/partners/clients", {
        role: "executive",
        method: "POST",
        data: {
          business_name: "Paid cafe",
          contact_name: "Owner",
          email: "paid@example.com",
          category: "partner",
          offer: "founding",
          payment_method: "stripe",
        },
      });
      assert.equal(created.status, 201);
      paid = (
        await api(`/partners/clients/${created.body.id}/actions`, {
          role: "executive",
          method: "POST",
          data: { action: "invite" },
        })
      ).body;
      let session,
        creates = 0;
      stripe.setClient({
        checkout: {
          sessions: {
            create: async (params) => {
              creates++;
              assert.equal(params.mode, "payment");
              assert.equal(params.line_items[0].price_data.unit_amount, 30000);
              return (session = {
                id: "cs_test_itc",
                url: "https://checkout.stripe.com/test",
                status: "open",
                mode: "payment",
                payment_status: "unpaid",
                currency: "usd",
                amount_total: 30000,
                metadata: params.metadata,
                payment_intent: "pi_test_itc",
              });
            },
            retrieve: async () => session,
          },
        },
      });
      const access = token(paid);
      const consent = { language: "en", signerName: "Owner", accept: true };
      assert.equal(
        (
          await api("/partners/access/checkout", {
            token: access,
            method: "POST",
            data: { ...consent, accept: false },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api("/partners/access/checkout", {
            token: access,
            method: "POST",
            data: consent,
          })
        ).status,
        200,
      );
      await api("/partners/access/checkout", {
        token: access,
        method: "POST",
        data: consent,
      });
      assert.equal(creates, 1);
      assert.equal(
        (
          await api("/partners/access/save", {
            token: access,
            method: "POST",
            data: { content },
          })
        ).status,
        409,
      );
      await assert.rejects(() =>
        S.confirmPayment({
          ...session,
          payment_status: "paid",
          amount_total: 1,
        }),
      );
      session.payment_status = "paid";
      assert.equal(
        (await api("/partners/access/sync", { token: access, method: "POST" }))
          .body.payment_status,
        "paid",
      );
      await S.confirmPayment(session);
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT COUNT(*) FROM partner_mail WHERE dedupe_key=$1",
              [`paid:${paid.id}`],
            )
          ).rows[0].count,
        ),
        1,
      );
      assert.equal(
        (
          await api("/partners/access/checkout", {
            token: access,
            method: "POST",
            data: consent,
          })
        ).status,
        409,
      );
      assert.equal(
        (await api(`/partners/clients/${paid.id}`, { role: "executive" })).body
          .activated_at,
        null,
      );
    },
  );
  await t.test("Founding payment link requires consent, matches exact payment and isolated webhook preserves memberships", async () => {
    const L = require("../services/partner-payment-link.service");
    const Stripe = require("stripe");
    process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID = "plink_test_founding";
    try {
      const created = await S.create({ business_name: "Linked cafe", contact_name: "Owner",
        email: "linked@example.com", category: "partner", offer: "founding", payment_method: "stripe" }, actors.admin);
      let linked = await S.action(created.id, { action: "invite" }, actors.admin);
      const access = token(linked);
      const consent = { language: "en", signerName: "Owner", accept: true };
      await assert.rejects(S.checkout(access, { ...consent, accept: false }));
      const url = new URL((await S.checkout(access, consent)).url);
      assert.equal(url.origin + url.pathname, new URL(L.URL).origin + new URL(L.URL).pathname);
      assert.equal(url.searchParams.get("prefilled_promo_code"), "ITCFOUNDING75LIVE");
      assert.equal(url.searchParams.get("locked_prefilled_email"), linked.email);
      const reference = url.searchParams.get("client_reference_id");
      let session = { id: "cs_test_linked", payment_link: "plink_test_founding",
        client_reference_id: reference, mode: "payment", status: "complete", livemode: true, payment_status: "paid",
        currency: "usd", amount_total: 30000, amount_subtotal: 120000, total_details: { amount_discount: 90000, amount_tax: 0, amount_shipping: 0 }, automatic_tax: { enabled: true, status: "complete" }, payment_intent: "pi_test_linked",
        customer_details: { email: linked.email }, metadata: {} };
      assert.equal(await S.confirmPaymentLink({ ...session, payment_link: "plink_other" }), false);
      assert.equal(await S.confirmPaymentLink({ ...session, client_reference_id: reference.slice(0, -1) + "z" }), false);
      for (const invalid of [{ amount_total: 1 }, { currency: "eur" }, { mode: "subscription" },
        { customer_details: { email: "another@example.com" } }, { payment_status: "unpaid" }])
        await assert.rejects(S.confirmPaymentLink({ ...session, ...invalid }));
      const webhook = async (object, validSignature = true) => {
        const body = JSON.stringify({ id: "evt_isolated", type: "checkout.session.completed", data: { object } });
        const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_isolated_partner" });
        return fetch(base + "/partners/payment/webhook", { method: "POST", headers: {
          "Content-Type": "application/json", "stripe-signature": validSignature ? signature : "invalid" }, body });
      };
      assert.equal((await webhook(session, false)).status, 400);
      assert.equal((await webhook({ ...session, payment_link: null, mode: "subscription", client_reference_id: "123" })).status, 200);
      assert.equal((await S.detail(linked.id, actors.admin)).payment_status, "pending");
      assert.equal((await webhook(session)).status, 200);
      assert.equal((await webhook(session)).status, 200);
      linked = await S.detail(linked.id, actors.admin);
      assert.equal(linked.payment_status, "paid");
      assert.equal(linked.activated_at, null);
      assert.equal(Number((await db.query("SELECT COUNT(*) FROM partner_mail WHERE dedupe_key=$1", [`paid:${linked.id}`])).rows[0].count), 1);
      stripe.setClient({ checkout: { sessions: { retrieve: async () => session } } });
      const response = await fetch(base + "/partners/payment/return?session_id=cs_test_linked", { redirect: "manual" });
      assert.equal(response.status, 303);
      assert.ok(response.headers.get("location").startsWith("http://localhost:5173/partner#"));
      // A second client discovers the completed link payment from Stripe when checking status.
      const other = await S.create({ business_name: "Sync cafe", contact_name: "Owner",
        email: "sync@example.com", category: "partner", offer: "founding", payment_method: "stripe" }, actors.admin);
      const invited = await S.action(other.id, { action: "invite" }, actors.admin);
      const access2 = token(invited);
      const ref2 = new URL((await S.checkout(access2, consent)).url).searchParams.get("client_reference_id");
      session = { ...session, id: "cs_test_sync_link", payment_intent: "pi_test_sync_link",
        client_reference_id: ref2, customer_details: { email: invited.email } };
      stripe.setClient({ checkout: { sessions: { list: (params) => {
        assert.equal(params.payment_link, "plink_test_founding");
        return (async function* () { yield session; })();
      } } } });
      assert.equal((await S.sync(access2)).payment_status, "paid");
    } finally { delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID; }
  });
  await t.test("sandbox partner checkout confirms USD300 and zero-cost orders automatically and once", async () => {
    process.env.PARTNER_PAYMENT_LINK_TEST_MODE = "true";
    process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID = "plink_auto_founding";
    process.env.STRATEGIC_PARTNER_PAYMENT_LINK_ID = "plink_auto_strategic";
    try {
      for (const offer of ["founding", "strategic"]) {
        const created = await S.create({ business_name: `Auto ${offer}`, contact_name: "Owner", email: `auto-${offer}@example.com`, category: offer === "strategic" ? "strategic" : "partner", offer, payment_method: offer === "strategic" ? "waived" : "stripe" }, actors.admin);
        const invited = await S.action(created.id, { action: "invite" }, actors.admin);
        assert.equal(invited.payment_confirmation, "automatic");
        const access = token(invited);
        const url = new URL((await S.checkout(access, { language: "en", signerName: "Owner", accept: true })).url);
        const termsEmails = () => emails.filter(m => m.to.includes(invited.email) && m.subject.includes("Your Participation Terms and Conditions"));
        assert.equal(termsEmails().length, 1);
        const termsMail = termsEmails()[0];
        assert.equal(termsMail.attachments[0].encoding, "base64");
        assert.equal(Buffer.from(termsMail.attachments[0].content, "base64").subarray(0,4).toString(), "%PDF");
        await S.checkout(access, {language: "en", signerName: "Owner", accept: true});
        assert.equal(termsEmails().length, 1);
        const accepted = (await db.query("SELECT * FROM partner_acceptances WHERE client_id=$1 AND stage='commercial'",[invited.id])).rows;
        assert.equal(accepted.length,1);
        const documentUrl = new URL(require("../services/partner-accepted-terms.service").url(accepted[0]));
        const original = invited.terms_snapshot;
        await db.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1",[invited.id,JSON.stringify({en:{...original.en,version:99,content:"NEW unrelated terms"}})]);
        const document = await fetch(base+documentUrl.pathname.replace(/^\/api/, "")+documentUrl.search);
        assert.equal(document.status,200);
        assert.match(document.headers.get("content-type"),/application\/pdf/);
        assert.ok(document.headers.get("content-disposition").includes(`-V${original.en.version}-`));
        assert.equal(Buffer.from(await document.arrayBuffer()).subarray(0,4).toString(),"%PDF");
        assert.equal((await fetch(base+"/partners/accepted-terms?token=invalid")).status,401);
        await db.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1",[invited.id,JSON.stringify(original)]);
        const session = { id: `cs_test_auto_${offer}`, payment_link: `plink_auto_${offer}`, client_reference_id: url.searchParams.get("client_reference_id"), mode: "payment", status: "complete", livemode: false, currency: "usd", amount_total: offer === "founding" ? 30000 : 0, payment_status: offer === "founding" ? "paid" : "no_payment_required", payment_intent: offer === "founding" ? "pi_auto_founding" : null, customer_details: { email: invited.email } };
        assert.equal(await S.confirmPaymentLink({...session, payment_link: offer === "founding" ? "plink_auto_strategic" : "plink_auto_founding"}), false);
        for (const change of [{ amount_total: 1 }, {livemode: true}, {status: "open"}, {customer_details: {email: "wrong@example.com"}}]) await assert.rejects(S.confirmPaymentLink({...session, ...change}));
        stripe.setClient({checkout: {sessions: {retrieve: async (id) => {assert.equal(id, session.id); return session;}}}});
        const returned = await fetch(base+"/partners/payment/return?session_id="+session.id, {redirect: "manual"});
        assert.equal(returned.status, 303);
        assert.equal(jwt.verify(new URL(returned.headers.get("location")).hash.slice(1),process.env.JWT_SECRET).id, jwt.verify(access,process.env.JWT_SECRET).id);
        const Stripe = require("stripe");
        const body = JSON.stringify({id: `evt_auto_${offer}`, type: "checkout.session.completed", data: {object: session}});
        const signature = Stripe.webhooks.generateTestHeaderString({payload: body, secret: "whsec_isolated_partner"});
        for (let repeat=0; repeat<2; repeat++) assert.equal((await fetch(base+"/partners/payment/webhook", {method:"POST",headers:{"Content-Type":"application/json","stripe-signature":signature},body})).status, 200);
        const confirmed = await S.publicView(access);
        assert.equal(confirmed.payment_status, offer === "founding" ? "paid" : "waived");
        assert.equal((await S.detail(invited.id, actors.admin)).activated_at, null);
        assert.equal(Number((await db.query("SELECT COUNT(*) FROM partner_mail WHERE dedupe_key=$1", [`paid:${invited.id}`])).rows[0].count), 1);
        assert.ok(emails.some(m => m.to.includes(invited.email) && m.text.includes("Create my business profile")));
      }
    } finally { delete process.env.PARTNER_PAYMENT_LINK_TEST_MODE; delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID; delete process.env.STRATEGIC_PARTNER_PAYMENT_LINK_ID; }
  });
  await t.test("live partner webhook confirms both offers without checkout return and avoids duplicate email", async () => {
    process.env.PARTNER_PAYMENT_LINK_TEST_MODE = "false";
    process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID = "plink_auto_founding";
    process.env.STRATEGIC_PARTNER_PAYMENT_LINK_ID = "plink_auto_strategic";
    try {
      for (const offer of ["founding", "strategic"]) {
        const created = await S.create({ business_name: `Auto ${offer}`, contact_name: "Owner", email: `live-auto-${offer}@example.com`, category: offer === "strategic" ? "strategic" : "partner", offer, payment_method: offer === "strategic" ? "waived" : "stripe" }, actors.admin);
        const invited = await S.action(created.id, { action: "invite" }, actors.admin);
        assert.equal(invited.payment_confirmation, "automatic");
        const access = token(invited);
        const url = new URL((await S.checkout(access, { language: "en", signerName: "Owner", accept: true })).url);
        const termsEmails = () => emails.filter(m => m.to.includes(invited.email) && m.subject.includes("Your Participation Terms and Conditions"));
        assert.equal(termsEmails().length, 1);
        const termsMail = termsEmails()[0];
        assert.equal(termsMail.attachments[0].encoding, "base64");
        assert.equal(Buffer.from(termsMail.attachments[0].content, "base64").subarray(0,4).toString(), "%PDF");
        await S.checkout(access, {language: "en", signerName: "Owner", accept: true});
        assert.equal(termsEmails().length, 1);
        const accepted = (await db.query("SELECT * FROM partner_acceptances WHERE client_id=$1 AND stage='commercial'",[invited.id])).rows;
        assert.equal(accepted.length,1);
        const documentUrl = new URL(require("../services/partner-accepted-terms.service").url(accepted[0]));
        const original = invited.terms_snapshot;
        await db.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1",[invited.id,JSON.stringify({en:{...original.en,version:99,content:"NEW unrelated terms"}})]);
        const document = await fetch(base+documentUrl.pathname.replace(/^\/api/, "")+documentUrl.search);
        assert.equal(document.status,200);
        assert.match(document.headers.get("content-type"),/application\/pdf/);
        assert.ok(document.headers.get("content-disposition").includes(`-V${original.en.version}-`));
        assert.equal(Buffer.from(await document.arrayBuffer()).subarray(0,4).toString(),"%PDF");
        assert.equal((await fetch(base+"/partners/accepted-terms?token=invalid")).status,401);
        await db.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1",[invited.id,JSON.stringify(original)]);
        const session = { id: `cs_live_auto_${offer}`, payment_link: `plink_auto_${offer}`, client_reference_id: url.searchParams.get("client_reference_id"), mode: "payment", status: "complete", livemode: true, currency: "usd", amount_subtotal: offer === "founding" ? 120000 : 180000, total_details: { amount_discount: offer === "founding" ? 90000 : 180000, amount_tax: offer === "founding" ? 2000 : 0, amount_shipping: 0 }, automatic_tax: { enabled: true, status: "complete" }, amount_total: offer === "founding" ? 32000 : 0, payment_status: "paid", payment_intent: offer === "founding" ? "pi_live_auto_founding" : null, customer_details: { email: invited.email } };
        assert.equal(await S.confirmPaymentLink({...session, payment_link: offer === "founding" ? "plink_auto_strategic" : "plink_auto_founding"}), false);
        for (const change of [{ amount_total: 1 }, {livemode: false}, {status: "open"}, {customer_details: {email: "wrong@example.com"}}]) await assert.rejects(S.confirmPaymentLink({...session, ...change}));
        stripe.setClient({checkout: {sessions: {retrieve: async (id) => {assert.equal(id, session.id); return session;}}}});
        const Stripe = require("stripe");
        const body = JSON.stringify({id: `evt_auto_${offer}`, type: "checkout.session.completed", data: {object: session}});
        const signature = Stripe.webhooks.generateTestHeaderString({payload: body, secret: "whsec_isolated_partner"});
        for (let repeat=0; repeat<2; repeat++) assert.equal((await fetch(base+"/partners/payment/webhook", {method:"POST",headers:{"Content-Type":"application/json","stripe-signature":signature},body})).status, 200);
        const returned = await fetch(base+"/partners/payment/return?session_id="+session.id, {redirect: "manual"});
        assert.equal(returned.status, 303);
        assert.equal(jwt.verify(new URL(returned.headers.get("location")).hash.slice(1),process.env.JWT_SECRET).id, jwt.verify(access,process.env.JWT_SECRET).id);
        const invalidReturn=await fetch(base+"/partners/payment/return?session_id=invalid");
        assert.equal(invalidReturn.status,400);assert.match(invalidReturn.headers.get("content-type"),/text\/html/);
        const errorPage=await invalidReturn.text();assert.match(errorPage,/itc-club-logo-v1/);assert.match(errorPage,/original invitation email/);assert(!errorPage.includes("success"));
        const confirmed = await S.publicView(access);
        assert.equal(confirmed.payment_status, offer === "founding" ? "paid" : "waived");
        assert.equal((await S.detail(invited.id, actors.admin)).activated_at, null);
        const summary = (await db.query("SELECT stripe_payment_summary FROM partner_clients WHERE id=$1", [invited.id])).rows[0].stripe_payment_summary;
        assert.equal(summary.tax, offer === "founding" ? 2000 : 0);
        assert.equal(summary.total, offer === "founding" ? 32000 : 0);
        const receipt=(await db.query("SELECT stripe_payment_receipt FROM partner_clients WHERE id=$1",[invited.id])).rows[0].stripe_payment_receipt;
        assert.equal(receipt.kind, offer === "founding" ? "payment" : "participation");
        const welcome=emails.filter(m=>m.to.includes(invited.email)&&m.text.includes("Create my business profile"));
        assert.equal(welcome.length,1);assert.equal(welcome[0].attachments.length,1);assert.equal(Buffer.from(welcome[0].attachments[0].content,"base64").subarray(0,4).toString(),"%PDF");
        assert.equal(Number((await db.query("SELECT COUNT(*) FROM partner_mail WHERE dedupe_key=$1", [`paid:${invited.id}`])).rows[0].count), 1);
        assert.ok(emails.some(m => m.to.includes(invited.email) && m.text.includes("Create my business profile")));
      }
    } finally { delete process.env.PARTNER_PAYMENT_LINK_TEST_MODE; delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID; delete process.env.STRATEGIC_PARTNER_PAYMENT_LINK_ID; }
  });
  await t.test("direct Founding link needs no Stripe API and only admin can attest payment and send the form", async () => {
    const L = require("../services/partner-payment-link.service");
    process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL = "true";
    stripe.setClient({ checkout: { sessions: {
      retrieve: async () => assert.fail("Direct link must not query Stripe"),
      create: async () => assert.fail("Direct link must not create Checkout"),
      list: () => assert.fail("Manual payment status must not query Stripe"),
    } } });
    try {
      const client = await S.create({ business_name: "Manual linked cafe", contact_name: "Owner",
        email: "manual-link@example.com", category: "partner", offer: "founding", payment_method: "stripe" }, actors.executive);
      const invited = await S.action(client.id, { action: "invite" }, actors.admin);
      const access = token(invited);
      assert.equal(invited.payment_confirmation, "manual");
      const consent = { language: "en", signerName: "Owner", accept: true };
      await assert.rejects(S.checkout(access, { ...consent, accept: false }));
      const url = new URL((await S.checkout(access, consent)).url);
      assert.equal(url.origin + url.pathname, new URL(L.URL).origin + new URL(L.URL).pathname);
      assert.equal(url.searchParams.get("prefilled_promo_code"), "ITCFOUNDING75LIVE");
      assert.equal(url.searchParams.get("locked_prefilled_email"), invited.email);
      assert.equal(L.clientId(url.searchParams.get("client_reference_id")), invited.id);
      assert.equal((await S.sync(access)).payment_status, "pending");
      const data = { action: "stripe-link-paid", reference: "pi_manual_verified_300", confirm: true };
      await assert.rejects(S.action(client.id, data, actors.executive), /administrador/);
      await assert.rejects(S.action(client.id, { ...data, confirm: false }, actors.admin));
      await assert.rejects(S.action(client.id, { ...data, reference: "" }, actors.admin));
      const confirmed = await S.action(client.id, data, actors.admin);
      assert.equal(confirmed.payment_status, "paid");
      assert.equal(confirmed.payment_reference, data.reference);
      assert.equal(confirmed.payment_verified_by, actors.admin.id);
      assert.equal(confirmed.activated_at, null);
      assert.equal((await S.publicView(access)).payment_status, "paid");
      assert.ok(confirmed.activity.some(a => a.kind === "stripe-link-paid"));
      assert.ok(emails.some(m => m.to.includes(invited.email) && m.text.includes("Create my business profile")));
      await assert.rejects(S.action(client.id, data, actors.admin));
      assert.equal(Number((await db.query("SELECT COUNT(*) FROM partner_mail WHERE dedupe_key=$1", [`paid:${client.id}`])).rows[0].count), 1);
      const regular = await S.create({ business_name: "Regular cafe", contact_name: "Owner",
        email: "regular@example.com", category: "partner", offer: "regular", payment_method: "stripe" }, actors.admin);
      await assert.rejects(S.action(regular.id, data, actors.admin));
    } finally { delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL; }
  });
  await t.test("temporary partner test links select the correct offer and gate the zero-dollar form", async () => {
    const L = require("../services/partner-payment-link.service");
    process.env.PARTNER_PAYMENT_LINK_TEST_MODE = "true";
    process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL = "true";
    try {
      for (const offer of ["founding", "strategic"]) {
        const client = await S.create({ business_name: `Test ${offer}`, contact_name: "Owner", email: `${offer}-sandbox@example.com`, category: offer === "strategic" ? "strategic" : "partner", offer, payment_method: "stripe" }, actors.admin);
        const invited = await S.action(client.id, { action: "invite" }, actors.admin);
        const access = token(invited);
        const view = await S.publicView(access);
        assert.equal(view.payment_status, "pending");
        assert.equal(view.payment_method, "stripe");
        assert.equal(view.payment_test, true);
        assert.equal(view.amount_cents, offer === "strategic" ? 0 : 30000);
        await assert.rejects(S.checkout(access, { signerName: "Owner", accept: false }));
        await assert.rejects(S.save(access, { content: {} }), /no está disponible/);
        const url = new URL((await S.checkout(access, { signerName: "Owner", accept: true, language: "en" })).url);
        assert.equal(url.pathname, new URL(L.TEST_URLS[offer]).pathname);
        assert.equal(url.searchParams.get("prefilled_promo_code"), offer === "strategic" ? "ITCSTRATEGIC100" : "ITCFOUNDING75");
        assert.equal(url.searchParams.get("locked_prefilled_email"), invited.email);
        assert.equal((await S.sync(access)).payment_status, "pending");
        await S.action(client.id, { action: "stripe-link-paid", reference: `TEST cs_test_${offer}`, confirm: true }, actors.admin);
        assert.equal((await S.publicView(access)).payment_status, offer === "strategic" ? "waived" : "paid");
        await S.save(access, { content: {} });
      }
      assert.equal(L.strategicTest({offer:"strategic",amount_cents:0,payment_status:"waived",form_status:"submitted"}), false);
    } finally { delete process.env.PARTNER_PAYMENT_LINK_TEST_MODE; delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL; }
  });
  await t.test(
    "external payment requires confirmation; corrections preserve prior acceptance; renewal is manual and sends no reminder",
    async () => {
      const created = (
        await api("/partners/clients", {
          role: "executive",
          method: "POST",
          data: {
            business_name: "External cafe",
            contact_name: "Owner",
            email: "external@example.com",
            category: "partner",
            offer: "founding",
            payment_method: "external",
          },
        })
      ).body;
      assert.equal(
        (
          await api(`/partners/clients/${created.id}/actions`, {
            role: "executive",
            method: "POST",
            data: { action: "external-paid", reference: "BANK-001" },
          })
        ).status,
        400,
      );
      const verified = await api(`/partners/clients/${created.id}/actions`, {
        role: "executive",
        method: "POST",
        data: { action: "external-paid", reference: "BANK-001", confirm: true },
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.body.payment_status, "paid");
      assert.equal(
        (
          await api(`/partners/clients/${created.id}/actions`, {
            role: "executive",
            method: "POST",
            data: {
              action: "external-paid",
              reference: "BANK-001",
              confirm: true,
            },
          })
        ).status,
        400,
      );
      // Paid cafe still has an editable initial form; prepare files from fixture bytes.
      const access = token(paid);
      for (let i = 0; i < 5; i++)
        await S.filePut(
          access,
          {
            buffer: Buffer.from([255, 216, 255, i, 8, 9]),
            size: 6,
            originalname: `image${i}.jpg`,
          },
          i ? "photo" : "logo",
        );
      await S.save(
        access,
        { content, language: "en", accept: true, authorize: true },
        true,
      );
      const corrections = await api(`/partners/clients/${paid.id}/actions`, {
        role: "executive",
        method: "POST",
        data: { action: "corrections", note: "Please update your hours." },
      });
      assert.equal(corrections.body.form_status, "changes_requested");
      await S.save(
        access,
        {
          content: { ...content, hours: "10 AM – 6 PM" },
          language: "es",
          accept: true,
          authorize: true,
        },
        true,
      );
      const revised = await S.detail(paid.id, actors.executive);
      assert.equal(
        revised.acceptances.filter((a) => a.stage === "submission").length,
        2,
      );
      assert.equal(revised.submission_version, 2);
      const before = Number(
        (
          await db.query(
            "SELECT COUNT(*) FROM partner_mail WHERE client_id=$1",
            [strategic.id],
          )
        ).rows[0].count,
      );
      assert.equal(
        (
          await api(`/partners/clients/${strategic.id}/actions`, {
            role: "executive",
            method: "POST",
            data: {
              action: "renew",
              amount_cents: 40000,
              reference: "AGREED-001",
            },
          })
        ).status,
        400,
      );
      const renewed = await api(`/partners/clients/${strategic.id}/actions`, {
        role: "executive",
        method: "POST",
        data: {
          action: "renew",
          amount_cents: 40000,
          reference: "AGREED-001",
          confirm: true,
        },
      });
      assert.equal(renewed.status, 200);
      assert.equal(renewed.body.periods.length, 2);
      assert.equal(renewed.body.renewal_status, "renewed");
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT COUNT(*) FROM partner_mail WHERE client_id=$1",
              [strategic.id],
            )
          ).rows[0].count,
        ),
        before,
      );
    },
  );
  await t.test(
    "mail failure preserves committed invitation and retry delivers the same outbox item",
    async () => {
      const created = await S.create(
        {
          business_name: "Retry cafe",
          contact_name: "Owner",
          email: "retry@example.com",
          category: "strategic",
        },
        actors.executive,
      );
      const original = smtp.send;
      smtp.send = async () => {
        throw Object.assign(new Error("Test only"), {
          code: "TEST_SMTP_FAILURE",
        });
      };
      const invited = await S.action(
        created.id,
        { action: "invite" },
        actors.executive,
      );
      assert.equal(invited.form_status, "invited");
      assert.equal(invited.emails[0].status, "failed");
      smtp.send = original;
      const retried = await S.action(
        created.id,
        { action: "retry-email" },
        actors.executive,
      );
      assert.equal(retried.emails.length, 1);
      assert.equal(retried.emails[0].status, "sent");
    },
  );
  await t.test(
    "existing Stripe payment is verified against business email and cannot fund two client records",
    async () => {
      const data = {
        business_name: "Previous payment",
        contact_name: "Owner",
        email: "previous@example.com",
        category: "partner",
        offer: "founding",
        payment_method: "stripe",
      };
      const first = await S.create(data, actors.executive);
      let session = {
        id: "cs_previous_itc",
        mode: "payment",
        currency: "usd",
        amount_total: 30000,
        payment_status: "paid",
        payment_intent: "pi_previous_itc",
        customer_details: { email: "wrong@example.com" },
        metadata: {},
      };
      stripe.setClient({
        checkout: { sessions: { retrieve: async () => session } },
      });
      const verify = (id) =>
        api(`/partners/clients/${id}/actions`, {
          role: "executive",
          method: "POST",
          data: { action: "stripe-verify", session_id: session.id },
        });
      assert.equal((await verify(first.id)).status, 409);
      session.customer_details.email = data.email;
      session.metadata.purchase_type = "guide";
      assert.equal((await verify(first.id)).status, 409);
      session.metadata = {};
      assert.equal((await verify(first.id)).status, 200);
      const second = await S.create(
        { ...data, business_name: "Different record" },
        actors.executive,
      );
      assert.equal((await verify(second.id)).status, 409);
      assert.equal(
        (await S.detail(second.id, actors.executive)).payment_status,
        "pending",
      );
    },
  );
  await t.test(
    "staff access invitation is single-use; role changes and deactivation apply immediately",
    async () => {
      const response = await api("/staff", {
        method: "POST",
        data: {
          email: "invite@example.com",
          name: "New executive",
          role: "executive",
          language: "es",
        },
      });
      assert.equal(response.status, 201);
      const message = (
        await db.query(
          "SELECT message FROM partner_mail WHERE recipient='invite@example.com'",
        )
      ).rows[0].message;
      const invitationToken = message.text
        .split("\n")
        .find((v) => v.includes("/staff-invite#"))
        .split("#")[1];
      const accept = () =>
        api("/staff/accept/invitation", {
          method: "POST",
          data: { token: invitationToken, password: "long-secure-password" },
        });
      assert.equal((await accept()).status, 200);
      assert.equal((await accept()).status, 400);
      await api(`/staff/${actors.other.id}`, {
        method: "POST",
        data: { role: "executive", is_active: false },
      });
      assert.equal((await api("/staff/me", { role: "other" })).status, 401);
      await assert.rejects(() =>
        S.action(
          strategic.id,
          { action: "assign", owner_id: actors.executive.id },
          actors.executive,
        ),
      );
    },
  );
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.end();
});
