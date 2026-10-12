const { test } = require("node:test");
const assert = require("node:assert/strict");
const { snapshot } = require("../services/partner-terms.service");

test("English approval alone allows invitations and snapshots the exact contract", async () => {
  const doc = { language: "en", version: 1, content: "Approved contract" };
  const calls = [];
  const c = { query: async (...args) => { calls.push(args); return { rows: [doc] }; } };
  const row = { id: "client", offer: "founding", terms_snapshot: {} };
  assert.deepEqual(await snapshot(c, row), { en: doc });
  assert.match(calls[0][0], /language='en'/);
  assert.deepEqual(calls[0][1], ["founding"]);
  assert.deepEqual(JSON.parse(calls[1][1][1]), { en: doc });
});

test("Existing English snapshots remain unchanged", async () => {
  const row = { terms_snapshot: { en: { version: 1, content: "Original" } } };
  assert.equal(await snapshot({ query: () => assert.fail("Must preserve snapshot") }, row), row.terms_snapshot);
});

test("Missing approved English contract still blocks invitation", async () => {
  await assert.rejects(snapshot({ query: async () => ({ rows: [] }) }, {
    offer: "strategic", terms_snapshot: {},
  }), /Faltan términos aprobados en inglés/);
});
