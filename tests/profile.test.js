const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateProfile, isProfileImage, updateProfile, avatarFileFromRequest } = require('../controllers/profile.controller');
const users = require('../services/users.service');
const db = require('../config/db');
test('perfil permite editar datos personales sin cambiar membresía ni identidad', () => {
  assert.deepEqual(validateProfile({ name: ' José ', language: 'es', home_area: ' Manhattan ', interests: ['Museos', 'Museos'], is_premium: true, id: 99, email: 'otro@example.com', avatar_url: 'https://example.com' }), { name: 'José', language: 'es', home_area: 'Manhattan', interests: ['Museos'] });
  for (const body of [{ name: '' }, { name: 1 }, { language: 'xx' }, { home_area: 'x'.repeat(101) }, { interests: [''] }, { interests: Array(13).fill('Museos') }]) assert.throws(() => validateProfile(body));
  assert.deepEqual(validateProfile({}), {});
});
test('avatar valida los bytes de imagen, rechaza archivos con MIME falsificado', () => {
  assert.equal(isProfileImage({ mimetype: 'image/jpeg', buffer: Buffer.from([255,216,255,0]) }), true);
  assert.equal(isProfileImage({ mimetype: 'image/png', buffer: Buffer.from('<script>malicious</script>') }), false);
  assert.equal(isProfileImage({ mimetype: 'image/svg+xml', buffer: Buffer.from('<svg/>') }), false);
});
test('avatar JPEG codificado se acepta sin el archivo FormData no compatible de Expo', () => {
  const jpeg = Buffer.from([255, 216, 255, 0]);
  const file = avatarFileFromRequest({ body: { jpegBase64: jpeg.toString('base64') } });
  assert.equal(isProfileImage(file), true);
  assert.equal(avatarFileFromRequest({ body: { jpegBase64: '!!!' } }), null);
  assert.equal(isProfileImage(avatarFileFromRequest({ body: { jpegBase64: Buffer.from('<svg/>').toString('base64') } })), false);
});
test('guardar perfil solo actualiza la cuenta autenticada con valores parametrizados', async () => {
  const originalFind = users.findById;
  const originalQuery = db.query;
  let query;
  const user = { id: 7, is_active: true, name: 'José', interests: [], language: 'es' };
  users.findById = async (id) => { assert.equal(id, 7); return user; };
  db.query = async (sql, params) => { query = { sql, params }; return { rows: [] }; };
  try {
    let response;
    await updateProfile({ user: { id: 7 }, body: { id: 99, name: 'José', interests: [], is_premium: true } }, { json: (data) => { response = data; } }, (error) => { throw error; });
    assert.match(query.sql, /WHERE id = \$1/);
    assert.deepEqual(query.params, [7, 'José', []]);
    assert.doesNotMatch(query.sql, /is_premium/);
    assert.equal(response.user.id, 7);
  } finally { users.findById = originalFind; db.query = originalQuery; }
});
