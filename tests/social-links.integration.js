const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
if (process.env.DB_DATABASE !== 'itc_crm_test' || process.env.DB_HOST !== '127.0.0.1') throw Error('Isolated local DB only');
process.env.JWT_SECRET = 'social-links-local-test';
const db = require('../config/db');
const service = require('../services/experiences.service');
const controller = require('../controllers/experiences.controller');
after(() => db.end());
test('social links survive review/publication and old edits preserve them; clearing is explicit', async () => {
  await db.query(fs.readFileSync('database/experience-social-links.sql','utf8'));
  await db.query(fs.readFileSync('database/experience-social-links.sql','utf8'));
  const id = `social-${randomUUID()}`;
  const base = {id,title:'Social test',category:'Food',access:'free',isPublished:false};
  try {
    let row = await service.create(controller.deserialize({...base,instagramUrl:'instagram.com/testbusiness',tiktokUrl:'https://www.tiktok.com/@testbusiness'}));
    assert.equal(row.is_published, false);
    assert.equal(controller.serialize(row).instagramUrl, 'https://instagram.com/testbusiness');
    row = await service.update(id, controller.deserialize({...base,title:'Reviewed',isPublished:true}));
    assert.equal(row.is_published, true);
    assert.equal(row.instagram_url, 'https://instagram.com/testbusiness');
    row = await service.update(id, controller.deserialize({...base,isPublished:true,instagramUrl:null,facebookUrl:'https://facebook.com/testbusiness'}));
    assert.equal(row.instagram_url, null);
    assert.equal(row.tiktok_url, 'https://www.tiktok.com/@testbusiness');
    assert.equal(row.facebook_url, 'https://facebook.com/testbusiness');
    assert.equal((await service.list({publishedOnly:true,filter:{q:'Social test'}})).rows.some(r=>r.id===id),true);
  } finally { await db.query('DELETE FROM experiences WHERE id=$1',[id]); }
});
