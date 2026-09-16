const users = require('../services/users.service');
const db = require('../config/db');
const { uploadImage } = require('../services/uploads.service');

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
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
    const url = await uploadImage({ ...file, originalname: `avatar${extensions[file.mimetype]}` }, `avatars/${req.user.id}`);
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [req.user.id, url]);
    res.json({ success: true, user: await users.findById(req.user.id) });
  } catch (error) { next(error); }
}
module.exports = { updateProfile, updateAvatar, validateProfile, isProfileImage, avatarFileFromRequest };
