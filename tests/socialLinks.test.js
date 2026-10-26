const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSocialUrl, validateSocialLinks } = require('../utils/socialLinks');
const rules = require('../services/partner-rules');
const controller = require('../controllers/experiences.controller');

test('optional platform links normalize, reject unsafe destinations, and retain legacy social text', () => {
  assert.equal(normalizeSocialUrl('instagramUrl', undefined), undefined);
  assert.equal(normalizeSocialUrl('instagramUrl', '  '), null);
  assert.equal(normalizeSocialUrl('instagramUrl', 'instagram.com/riseny'), 'https://instagram.com/riseny');
  assert.equal(normalizeSocialUrl('tiktokUrl', 'https://www.tiktok.com/@riseny'), 'https://www.tiktok.com/@riseny');
  assert.equal(normalizeSocialUrl('facebookUrl', 'https://m.facebook.com/riseny'), 'https://m.facebook.com/riseny');
  for (const value of ['http://instagram.com/riseny', 'javascript:alert(1)', 'https://instagram.com.evil.test/riseny', 'https://instagram.com@evil.test/riseny', 'https://user:pass@instagram.com/riseny', 'https://instagram.com:8443/riseny', 'https://instagram.com/', {}, 'x'.repeat(1001)]) {
    assert.throws(() => normalizeSocialUrl('instagramUrl', value), {status:400});
  }
  assert.throws(() => normalizeSocialUrl('facebookUrl', 'https://facebook.com/l.php?u=https://evil.test'), {status:400});
  assert.ok(validateSocialLinks({tiktokUrl:'https://instagram.com/wrong-network'}));
  assert.equal(validateSocialLinks({}), null);
  const content = rules.content({social:'Legacy social information',instagramUrl:'instagram.com/riseny'});
  assert.equal(content.social, 'Legacy social information');
  assert.equal(content.instagramUrl, 'https://instagram.com/riseny');
  const serialized = controller.serialize({instagram_url:content.instagramUrl, tiktok_url:null, facebook_url:null});
  assert.equal(serialized.instagramUrl, content.instagramUrl);
  assert.equal(serialized.tiktokUrl, null);
  assert.equal(controller.deserialize({}).instagram_url, undefined);
  assert.equal(controller.deserialize({instagramUrl:''}).instagram_url, null);
});
