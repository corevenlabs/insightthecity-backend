const jwt = require('jsonwebtoken');

function createGuideDownloadToken(guideId, userId) {
  return jwt.sign(
    { type: 'guide_download', guideId: String(guideId), userId: String(userId) },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
}

function verifyGuideDownloadToken(token, guideId) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.type !== 'guide_download' || payload.guideId !== String(guideId)) {
    throw new Error('Enlace de descarga inválido');
  }
  return payload;
}

module.exports = { createGuideDownloadToken, verifyGuideDownloadToken };
