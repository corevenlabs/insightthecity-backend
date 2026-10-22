const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const users = require('./users.service');
const legal = require('./legal.service');
const verifier = new OAuth2Client();
const fail = (status,message,code) => Object.assign(new Error(message),{status,code});
async function verify(identityToken) {
  if(typeof identityToken !== 'string' || identityToken.length > 12000 || identityToken.length < 20) throw fail(400,'Credencial de Google inválida');
  const audience = process.env.GOOGLE_WEB_CLIENT_ID;
  if(!audience) throw fail(503,'El inicio con Google aún no está disponible');
  let claims;
  try { claims = (await verifier.verifyIdToken({idToken:identityToken,audience})).getPayload(); }
  catch { throw fail(401,'La credencial de Google expiró o no es válida'); }
  if(!claims || typeof claims.sub !== 'string' || !claims.sub || claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email.trim()) throw fail(401,'Google no proporcionó un correo verificado');
  return claims;
}
async function authenticate(body) {
  const claims = await verify(body.identityToken);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    // Serialize first-time linking/registration for the same Google identity.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['google:'+claims.sub]);
    let user = (await c.query('SELECT u.* FROM google_auth_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=$1 FOR UPDATE OF u',[claims.sub])).rows[0];
    if(!user) {
      const email = claims.email.trim().toLowerCase();
      user = (await c.query('SELECT * FROM users WHERE lower(email)=$1 FOR UPDATE',[email])).rows[0];
      if(user) {
        if(!user.is_active) throw fail(403,'Esta cuenta está desactivada');
        if(typeof body.password !== 'string' || !body.password) throw fail(409,'Confirma tu contraseña para vincular Google a tu cuenta existente.','LINK_REQUIRED');
        if(body.password.length > 256 || !user.password_hash || !await bcrypt.compare(body.password,user.password_hash)) throw fail(401,'No se pudo verificar la cuenta. Usa tu método de inicio habitual.','LINK_REQUIRED');
      } else {
        if(body.acceptLegal !== true) throw fail(409,'Acepta los términos y la privacidad para crear tu cuenta.','REGISTRATION_REQUIRED');
        const language=['es','en','pt'].includes(body.language)?body.language:'es';
        const name=typeof claims.name==='string'?claims.name.trim().slice(0,100):'';
        user=(await c.query('INSERT INTO users(name,email,password_hash,language) VALUES($1,$2,NULL,$3) RETURNING *',[name||'ITC Member',email,language])).rows[0];
        await legal.recordAcceptance(c,{userId:user.id,language,context:'register',slugs:legal.REGISTER_SLUGS});
      }
      await c.query('INSERT INTO google_auth_identities(subject,user_id) VALUES($1,$2)',[claims.sub,user.id]);
    }
    if(!user.is_active) throw fail(403,'Esta cuenta está desactivada');
    await c.query('COMMIT');
    return {token:users.signToken(user),user:users.publicUser(user)};
  } catch(error) {
    await c.query('ROLLBACK');
    if(error.code==='23505') throw fail(409,'La cuenta ya existe o ya está vinculada. Usa tu método de inicio habitual.');
    throw error;
  } finally {c.release();}
}
module.exports={verify,authenticate};
