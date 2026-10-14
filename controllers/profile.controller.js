const users = require('../services/users.service');
const db = require('../config/db');

function validateProfile(body) {
  const data = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) throw new Error('El nombre debe tener entre 1 y 100 caracteres');
    data.name = body.name.trim();
  }
  if (body.language !== undefined) {
    if (!['es', 'en', 'pt'].includes(body.language)) throw new Error('Idioma no válido');
    data.language = body.language;
  }
  if (body.home_area !== undefined) {
    if (typeof body.home_area !== 'string' || body.home_area.trim().length > 100) throw new Error('La zona debe tener máximo 100 caracteres');
    data.home_area = body.home_area.trim();
  }
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests) || body.interests.length > 12 || body.interests.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 60)) throw new Error('Selecciona hasta 12 intereses válidos');
    data.interests = [...new Set(body.interests.map((item) => item.trim()))];
  }
  return data;
}
async function updateProfile(req, res, next) {
  let data;
  try { data = validateProfile(req.body || {}); }
  catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  try {
    const current = await users.findById(req.user.id);
    if (!current || !current.is_active) return res.status(401).json({ success: false, message: 'Sesión no válida' });
    const fields = Object.keys(data);
    if (fields.length) await db.query(`UPDATE users SET ${fields.map((field, i) => `${field} = $${i + 2}`).join(', ')} WHERE id = $1`, [req.user.id, ...fields.map((field) => data[field])]);
    res.json({ success: true, user: await users.findById(req.user.id) });
  } catch (error) { next(error); }
}
function isProfileImage(file) {
  const b = file?.buffer;
  if (!Buffer.isBuffer(b)) return false;
  return (file.mimetype === 'image/jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255)
    || (file.mimetype === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || (file.mimetype === 'image/webp' && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP');
}
function avatarFileFromRequest(req) {
  if (req.file) return req.file;
  const encoded = req.body?.jpegBase64;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > 5 * 1024 * 1024) return null;
  return { buffer, mimetype: 'image/jpeg' };
}
async function updateAvatar(req, res, next) {
  try {
    const current = await users.findById(req.user.id);
    if (!current || !current.is_active) return res.status(401).json({ success: false, message: 'Sesión no válida' });
    const file = avatarFileFromRequest(req);
    if (!isProfileImage(file)) return res.status(400).json({ success: false, message: 'Selecciona una foto JPG, PNG o WebP válida' });
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query('SELECT is_active,avatar_url FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
      if (!row?.is_active) throw Object.assign(new Error('Sesión no válida'), {status:401});
      const avatar = (await c.query(`INSERT INTO user_avatars(user_id,bytes,mime,legacy_key) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id) DO UPDATE SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,legacy_key=COALESCE(user_avatars.legacy_key,EXCLUDED.legacy_key),version=gen_random_uuid(),updated_at=NOW() RETURNING version`, [req.user.id,file.buffer,file.mimetype,row.avatar_url && !row.avatar_url.startsWith('/api/users/me/avatar?') ? `avatars/${req.user.id}/` : null])).rows[0];
      await c.query('UPDATE users SET avatar_url=$2 WHERE id=$1',[req.user.id,`/api/users/me/avatar?v=${avatar.version}`]);
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
    res.json({ success: true, user: await users.findById(req.user.id) });
  } catch (error) { next(error); }
}
async function getAvatar(req,res,next) {
  try {
    const row=(await db.query("SELECT bytes,mime FROM user_avatars WHERE user_id=$1",[req.user.id])).rows[0];
    res.set("Cache-Control","private, no-store").set("X-Content-Type-Options","nosniff");
    if(!row) return res.sendStatus(404);
    if(req.query.format === "json") return res.json({dataUrl:`data:${row.mime};base64,${row.bytes.toString("base64")}`});
    res.type(row.mime).send(row.bytes);
  }catch(e){next(e);}
}
module.exports = { getAvatar, updateProfile, updateAvatar, validateProfile, isProfileImage, avatarFileFromRequest };
