const test = require('node:test');
const assert = require('node:assert/strict');
const { serialize, deserialize, validateLocation } = require('../controllers/experiences.controller');
test('location fields round-trip and distinguish omission from clearing', () => {
  const input = deserialize({ location: '45 E 42nd St, New York', shortAddress: ' 45 E 42nd St ', mapsUrl: ' https://maps.app.goo.gl/test ' });
  assert.equal(input.short_address, '45 E 42nd St');
  const result = serialize({ location: input.location, short_address: input.short_address, maps_url: input.maps_url });
  assert.equal(result.shortAddress, '45 E 42nd St');
  assert.equal(result.mapsUrl, 'https://maps.app.goo.gl/test');
  assert.equal(deserialize({}).short_address, undefined);
  assert.equal(deserialize({ shortAddress: '', mapsUrl: null }).short_address, null);
  assert.equal(deserialize({ mapsUrl: '' }).maps_url, null);
});
test('accepts Google Maps links and rejects unrelated or executable links', () => {
  for (const mapsUrl of ['https://maps.app.goo.gl/abc', 'https://www.google.com/maps/search/?api=1&query=NY', 'https://goo.gl/maps/abc', 'https://maps.google.com/?q=NY']) assert.equal(validateLocation({ mapsUrl }), null);
  for (const mapsUrl of ['javascript:alert(1)', 'https://evil.test/maps', 'https://google.com.evil.test/maps', 'http://maps.google.com', 'https://user:pass@maps.google.com/']) assert.ok(validateLocation({ mapsUrl }));
  assert.ok(validateLocation({ shortAddress: 'a'.repeat(101) }));
  assert.ok(validateLocation({ mapsUrl: {} }));
  assert.equal(validateLocation({ shortAddress: null, mapsUrl: null }), null);
});
