const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const users = require('./users.service');
const legal = require('./legal.service');
let cachedKeys;
let expires = 0;
function fail(status, message, code) { return Object.assign(new Error(message), { status, code }); }
async function verify(token, nonce) {
  if (typeof token !== 'string' || token.length > 12000 || !/^[a-f0-9]{64}$/.test(nonce || '')) throw fail(400, 'Credencial de Apple inválida');
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') throw fail(401, 'Credencial de Apple inválida');
  if (!cachedKeys || Date.now() > expires || !cachedKeys.some(k => k.kid === decoded.header.kid)) {
    const response = await fetch('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw fail(503, 'Apple no está disponible. Inténtalo de nuevo.');
    cachedKeys = (await response.json()).keys;
    expires = Date.now() + 3600000;
  }
  const key = cachedKeys.find(k => k.kid === decoded.header.kid && k.kty === 'RSA');
  if (!key) throw fail(401, 'Credencial de Apple inválida');
  let claims;
  try { claims = jwt.verify(token, crypto.createPublicKey({ key, format: 'jwk' }), {
    algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: process.env.APPLE_CLIENT_ID || 'com.insightthecity.app', maxAge: '10m',
  }); } catch { throw fail(401, 'La credencial de Apple expiró o no es válida'); }
  if (claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub) throw fail(401, 'Credencial de Apple inválida');
  return claims;
}
async function challenge() {
  const nonce = crypto.randomBytes(32).toString('hex');
  await db.query('DELETE FROM apple_auth_challenges WHERE expires_at < NOW()');
  await db.query("INSERT INTO apple_auth_challenges(id, expires_at) VALUES($1, NOW() + INTERVAL '5 minutes')", [nonce]);
  return nonce;
}
async function authenticate(body, linkUserId) {
  const claims = await verify(body.identityToken, body.nonce);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const challengeRow = await client.query('SELECT id FROM apple_auth_challenges WHERE id=$1 AND expires_at>NOW() FOR UPDATE', [body.nonce]);
    if (!challengeRow.rowCount) throw fail(401, 'Vuelve a iniciar sesión con Apple');
    const identity = await client.query('SELECT u.* FROM apple_auth_identities a JOIN users u ON u.id=a.user_id WHERE a.subject=$1 FOR UPDATE OF u', [claims.sub]);
    let user = identity.rows[0];
    if (linkUserId) {
      if (user && String(user.id) !== String(linkUserId)) throw fail(409, 'Esta cuenta de Apple ya está vinculada a otra cuenta');
      if (!user) {
        const existing = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [linkUserId]);
        user = existing.rows[0];
        if (!user || !user.is_active) throw fail(403, 'Cuenta no disponible');
        await client.query('INSERT INTO apple_auth_identities(subject,user_id) VALUES($1,$2)', [claims.sub,user.id]);
      }
    } else if (!user) {
      if (!(claims.email_verified === true || claims.email_verified === 'true') || typeof claims.email !== 'string') throw fail(400, 'Apple no proporcionó un correo verificado. Usa tu correo para acceder.');
      const email = claims.email.toLowerCase().trim();
      const existing = await client.query('SELECT id FROM users WHERE lower(email)=$1', [email]);
      if (existing.rowCount) throw fail(409, 'Ya tienes una cuenta. Entra con tu correo para vincular Apple sin perder tus datos.', 'LINK_REQUIRED');
      if (body.acceptLegal !== true) throw fail(409, 'Acepta los términos y la privacidad para crear tu cuenta.', 'REGISTRATION_REQUIRED');
      const language = ['es','en','pt'].includes(body.language) ? body.language : 'es';
      const name = typeof body.name === 'string' ? body.name.trim().slice(0,100) : '';
      user = (await client.query('INSERT INTO users(name,email,password_hash,language) VALUES($1,$2,NULL,$3) RETURNING *', [name || 'ITC Member',email,language])).rows[0];
      await client.query('INSERT INTO apple_auth_identities(subject,user_id) VALUES($1,$2)', [claims.sub,user.id]);
      await legal.recordAcceptance(client, { userId:user.id, language, context:'register', slugs:legal.REGISTER_SLUGS });
    }
    if (!user.is_active) throw fail(403, 'Esta cuenta está desactivada');
    const exchanged = await require('./apple-tokens.service').exchange(body.authorizationCode);
    const exchangeClaims = await verify(exchanged.identityToken, body.nonce);
    if(exchangeClaims.sub !== claims.sub) throw fail(401, 'Credencial de Apple inválida');
    await client.query('UPDATE apple_auth_identities SET refresh_token_encrypted=$1 WHERE subject=$2', [exchanged.encrypted,claims.sub]);
    await client.query('DELETE FROM apple_auth_challenges WHERE id=$1', [body.nonce]);
    await client.query('COMMIT');
    return { token:users.signToken(user), user:users.publicUser(user) };
  } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw fail(409, 'La cuenta ya existe o ya está vinculada. Usa tu correo para acceder.'); throw error; }
  finally { client.release(); }
}
module.exports = { verify, challenge, authenticate };
