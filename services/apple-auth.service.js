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
  require("./marketing-consent.service").validate(body.acceptMarketing);
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
      await require("./marketing-consent.service").recordRegistration(client, { userId: user.id, accepted: body.acceptMarketing, language, source: "apple-register" });
      await legal.recordAcceptance(client, { userId:user.id, language, context:'register', slugs:legal.REGISTER_SLUGS });
    }
    if (!user.is_active) throw fail(403, 'Esta cuenta está desactivada');
    const exchanged = await require('./apple-tokens.service').exchange(body.authorizationCode);
    const exchangeClaims = await verify(exchanged.identityToken, body.nonce);
    if(exchangeClaims.sub !== claims.sub) throw fail(401, 'Credencial de Apple inválida');
    await client.query('UPDATE apple_auth_identities SET refresh_token_encrypted=$1 WHERE subject=$2', [exchanged.encrypted,claims.sub]);
    await client.query('DELETE FROM apple_auth_challenges WHERE id=$1', [body.nonce]);
    await client.query('COMMIT');
    return { token:users.signToken(user,claims.sub), user:users.publicUser(user) };
  } catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') throw fail(409, 'La cuenta ya existe o ya está vinculada. Usa tu correo para acceder.'); throw error; }
  finally { client.release(); }
}
module.exports = { verify, challenge, authenticate };

// A recent Apple authentication is recorded only in a server-signed session.
// Older sessions must prove the already-linked Apple subject with a fresh challenge.
async function requestDeletion(userId, session, body) {
  if(body.confirm !== true) throw fail(400,'Confirma la eliminación de tu cuenta');
  const now=Math.floor(Date.now()/1000);
  const recent=String(session.id)===String(userId) && session.auth_provider==='apple' && Number.isInteger(session.auth_time)
    && session.auth_time<=now+30 && session.auth_time>=now-300 && typeof session.apple_sub==='string';
  let claims;
  if(!recent) {
    if(!body.identityToken) throw fail(409,'Verifica tu identidad con Apple para continuar.','APPLE_REAUTH_REQUIRED');
    claims=await verify(body.identityToken,body.nonce);
  }
  const c=await db.connect();let job;
  try {
    await c.query('BEGIN');
    if(!recent){
      const challengeRow=await c.query('SELECT id FROM apple_auth_challenges WHERE id=$1 AND expires_at>NOW() FOR UPDATE',[body.nonce]);
      if(!challengeRow.rowCount) throw fail(401,'Vuelve a verificar tu identidad con Apple','APPLE_REAUTH_REQUIRED');
    }
    const user=(await c.query('SELECT id,is_active FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
    if(!user?.is_active)throw fail(403,'Cuenta no disponible');
    const identity=(await c.query('SELECT subject FROM apple_auth_identities WHERE user_id=$1',[userId])).rows[0];
    if(!identity || identity.subject!==(recent?session.apple_sub:claims.sub))throw fail(403,'La cuenta de Apple no corresponde a este perfil');
    if(!recent)await c.query('DELETE FROM apple_auth_challenges WHERE id=$1',[body.nonce]);
    job=await require('./account-deletion.service').request(userId,c);
    if(!job)throw fail(409,'No se pudo solicitar la eliminación');
    await c.query('COMMIT');
  } catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  try{await require('./account-deletion.service').processJob(job.id);}catch{console.error('[apple deletion] REQUEST_QUEUED');}
  return {deletionStatus:'requested'};
}
module.exports.requestDeletion=requestDeletion;
