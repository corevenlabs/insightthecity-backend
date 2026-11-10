// Only the three explicitly reviewed business/publication pairs. No fuzzy matching.
const assert = require('node:assert/strict');
const publication = require('../services/partner-publication.service');
const reviewed = require('../config/partner-publication-repairs-20261030.json');

const unchangedFields = ({ experience_id, updated_at, ...rest }) => rest;
async function repair(db, apply = false, mapping = reviewed) {
  const c = await db.connect();
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const results = [];
    for (const target of mapping) {
      const candidates = (await c.query('SELECT * FROM partner_clients WHERE business_name=$1 AND deleted_at IS NULL' + (apply ? ' FOR UPDATE' : ''), [target.business_name])).rows;
      assert.equal(candidates.length, 1, `Expected one client: ${target.business_name}`);
      const client = candidates[0];
      if (target.client_id) assert.equal(client.id, target.client_id, 'Client identifier changed: ' + target.business_name);
      assert(!client.blocked_at, `Client blocked: ${target.business_name}`);
      assert(!client.experience_id || client.experience_id === target.experience_id, `Client linked elsewhere: ${target.business_name}`);
      const e = (await c.query('SELECT id,title,is_published FROM experiences WHERE id=$1', [target.experience_id])).rows[0];
      assert(e, `Missing experience: ${target.experience_id}`);
      assert.equal(e.title, target.experience_title, `Title changed: ${target.business_name}`);
      assert.equal(e.is_published, true, `Experience not published: ${target.business_name}`);
      // Run the same ownership/conflict validation as the administrative endpoint.
      // apply=false is always read-only; apply=true is atomic across all three clients.
      if (apply) {
        await publication.link(c, client, e.id, { role: 'admin', id: null });
        const after = (await c.query('SELECT * FROM partner_clients WHERE id=$1', [client.id])).rows[0];
        assert.deepEqual(unchangedFields(after), unchangedFields(client), 'Unrelated client data changed');
        assert.equal(after.experience_id, e.id, 'Link was not saved');
      } else {
        assert.equal((await c.query('SELECT 1 FROM partner_clients WHERE experience_id=$1 AND id<>$2 AND deleted_at IS NULL', [e.id, client.id])).rowCount, 0, 'Experience belongs to another client');
        assert.equal((await c.query('SELECT 1 FROM experience_drafts WHERE experience_id=$1 AND client_id IS NOT NULL AND client_id<>$2', [e.id, client.id])).rowCount, 0, 'Draft belongs to another client');
        assert.equal((await c.query('SELECT 1 FROM experience_drafts WHERE client_id=$1 AND (experience_id IS NULL OR experience_id<>$2)', [client.id, e.id])).rowCount, 0, 'Client has a different draft');
      }
      results.push({ business: client.business_name, experience: e.title, published: e.is_published, alreadyLinked: client.experience_id === e.id, experienceId: e.id });
    }
    await c.query('COMMIT');
    return { apply, results };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }
}
module.exports = { repair };
if (require.main === module) {
  const db = require('../config/db');
  repair(db, process.argv.includes('--apply')).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
}
