const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
function clientSecret() {
  const { APPLE_TEAM_ID, APPLE_KEY_ID } = process.env;
  const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY || (process.env.APPLE_PRIVATE_KEY_PATH ? require('node:fs').readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8') : '');
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) throw Object.assign(new Error('Falta configurar las credenciales de Apple en el servidor local.'), { status:503 });
  return jwt.sign({}, APPLE_PRIVATE_KEY.replace(/\\n/g,'\n'), { algorithm:'ES256', keyid:APPLE_KEY_ID, issuer:APPLE_TEAM_ID, audience:'https://appleid.apple.com', subject:process.env.APPLE_CLIENT_ID || 'com.insightthecity.app', expiresIn:300 });
}
function encryptionKey() {
  const explicit = process.env.APPLE_TOKEN_ENCRYPTION_KEY;
  if (explicit) {
    if (!/^[a-f0-9]{64}$/i.test(explicit)) throw Object.assign(new Error('APPLE_TOKEN_ENCRYPTION_KEY debe ser una clave hexadecimal de 32 bytes.'), {status:503});
    return Buffer.from(explicit,'hex');
  }
  // Domain-separated key derived from the existing managed server secret.
  // Keep JWT_SECRET stable, or migrate stored Apple credentials before rotating it.
  if (!process.env.JWT_SECRET) throw Object.assign(new Error('Falta JWT_SECRET para cifrar las credenciales de Apple.'), {status:503});
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(process.env.JWT_SECRET), Buffer.from('ITC Apple token storage'), Buffer.from('itc.apple.refresh-token.v1'), 32));
}
function validateConfiguration() {
  const token = clientSecret();
  if (!token) throw new Error('APPLE_CLIENT_SECRET_CONFIGURATION_FAILED');
  encryptionKey();
  console.log('[apple] Runtime private key readable; ES256 signing and token encryption configured.');
}

function seal(value) { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv); const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64'); }
function open(value) {const bytes=Buffer.from(value,'base64');const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
async function exchange(code) {
  encryptionKey();
  if(typeof code!=='string'||!code||code.length>4000) throw Object.assign(new Error('Vuelve a identificarte con Apple.'),{status:401});
  const response=await fetch('https://appleid.apple.com/auth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.APPLE_CLIENT_ID || 'com.insightthecity.app',client_secret:clientSecret(),grant_type:'authorization_code',code}),signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw Object.assign(new Error('Apple no pudo verificar el acceso. Inténtalo de nuevo.'),{status:401});
  const data=await response.json();
  if(!data.refresh_token||!data.id_token) throw Object.assign(new Error('Apple no devolvió una credencial válida.'),{status:401});
  return {encrypted:seal(data.refresh_token),identityToken:data.id_token};
}
async function revokeForUser(connection,userId) {
  const table=await connection.query("SELECT to_regclass('apple_auth_identities') AS present");
  if(!table.rows[0]?.present) return;
  const rows=(await connection.query('SELECT subject,refresh_token_encrypted FROM apple_auth_identities WHERE user_id=$1',[userId])).rows;
  for(const row of rows) {
    if(!row.refresh_token_encrypted) throw new Error('APPLE_REFRESH_TOKEN_MISSING');
    const response=await fetch('https://appleid.apple.com/auth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.APPLE_CLIENT_ID || 'com.insightthecity.app',client_secret:clientSecret(),token:open(row.refresh_token_encrypted),token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new Error('APPLE_REVOCATION_PENDING');
  }
}
module.exports={exchange,revokeForUser,seal,open,validateConfiguration};
