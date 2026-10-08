const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../services/partner-rules");
const mail = require("../services/partner-email.service");
test("partner prices are fixed by offer; strategic is waived and no recurring billing is inferred", () => {
  assert.equal(R.offer("partner", "founding", "stripe").amount_cents, 30000);
  assert.equal(R.offer("partner", "regular", "external").amount_cents, 120000);
  assert.equal(
    R.offer("strategic", "founding", "stripe").payment_method,
    "waived",
  );
  assert.throws(() => R.offer("partner", "strategic", "waived"));
});
test("six-month periods clamp month-end dates and preserve UTC time", () => {
  assert.equal(
    R.addSixMonths("2026-08-31T12:30:00Z").toISOString(),
    "2027-02-28T12:30:00.000Z",
  );
  assert.equal(
    R.addSixMonths("2027-08-31T12:30:00Z").toISOString(),
    "2028-02-29T12:30:00.000Z",
  );
});
test("external benefits require HTTPS; QR requires valid limits; only allowed content fields persist", () => {
  assert.throws(() => R.content({ url: "javascript:alert(1)" }));
  assert.throws(() => R.content({ url: "https://user:pass@example.com" }));
  assert.throws(() => R.content({ perUser: "0" }));
  assert.throws(() =>
    R.content({ validFrom: "2026-03-03", validUntil: "2026-02-01" }),
  );
  assert.deepEqual(
    Object.keys(R.content({ owner_id: 42 })).includes("owner_id"),
    false,
  );
  assert.equal(R.canSee({ id: 1, role: "executive" }, { owner_id: 2 }), false);
});
test("all branded mail types use app yellow and assigned contact without HTML injection", () => {
  for (const language of ["en", "es", "pt"])
    for (const kind of [
      "payment",
      "invite",
      "received",
      "changes",
      "published",
      "executive",
      "staff",
    ]) {
      const message = mail.render(kind, {
        client: {
          business_name: "<script>bad</script>",
          offer: "founding",
          amount_cents: 30000,
        },
        owner: { email: "executive@example.com", name: "Person" },
        language,
        url: "https://example.com/private",
        note: "<b>request</b>",
      });
      assert.ok(message.html.includes("#FDDD56"));
      assert.ok(!message.html.includes("<script>bad"));
      assert.equal(message.replyTo, "executive@example.com");
      assert.ok(message.text.includes("https://example.com/private"));
    }
});
