const test = require('node:test');
const assert = require('node:assert/strict');
const { serialize, deserialize, validateGallery } = require('../controllers/experiences.controller');

const photos = ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg', 'https://example.com/4.jpg'];

test('la galería Premium conserva portada y orden; la gratuita muestra solo portada', () => {
  const input = deserialize({ access: 'premium', images: photos });
  assert.equal(input.image_url, photos[0]);
  assert.deepEqual(input.gallery_urls, photos.slice(1));
  assert.deepEqual(serialize({ id: 'premium', access: 'premium', image_url: photos[0], gallery_urls: photos.slice(1) }).images, photos);
  assert.deepEqual(serialize({ id: 'free', access: 'free', image_url: photos[0], gallery_urls: photos.slice(1) }).images, [photos[0]]);
});

test('una experiencia Premium publicada necesita cuatro fotos distintas', () => {
  assert.match(validateGallery({ access: 'premium', isPublished: true, images: photos.slice(0, 3) }, true), /4 fotos/);
  assert.equal(validateGallery({ access: 'premium', isPublished: true, images: photos }, true), null);
  assert.equal(validateGallery({ access: 'premium', isPublished: false, images: photos.slice(0, 2) }, true), null);
  assert.match(validateGallery({ access: 'premium', images: [photos[0], photos[0], photos[2], photos[3]] }, true), /repitas/);
  assert.match(validateGallery({ access: 'free', images: photos }, true), /Solo las experiencias Premium/);
});
