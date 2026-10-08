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
const db = require("../config/db");
const S = require("../services/partner-crm.service");
const stripe = require("../services/stripe.service");
const smtp = require("../services/password-reset-mail.service");
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
        for (const language of ["en", "es", "pt"])
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
          language: "pt",
          title: "TEST ONLY new version",
          content: "Changed terms",
          approve: true,
        },
      });
      assert.equal(
        (await api("/partners/access", { token: oldToken })).body.terms.pt
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
            data: { content, language: "pt", accept: false, authorize: true },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api("/partners/access/submit", {
            token: access,
            method: "POST",
            data: { content, language: "pt", accept: true, authorize: true },
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
      assert.equal(detail.acceptances[0].language, "pt");
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
