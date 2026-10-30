const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serialize, deserialize, validateEditorialFlags, updateExperience } = require('../controllers/experiences.controller');
const service = require('../services/experiences.service');

test('editorial recommendation round-trips independently from premium and featured flags', () => {
  const data = deserialize({ isItcRecommended: true, access: 'premium', isFeatured: false });
  assert.equal(data.is_itc_recommended, true);
  assert.equal(data.access, 'premium');
  const output = serialize({ ...data, id: 'club', is_published: true });
  assert.equal(output.isItcRecommended, true);
  assert.equal(output.isFeatured, false);
  assert.equal(output.access, 'premium');
  assert.equal(deserialize({}).is_itc_recommended, undefined);
  assert.equal(deserialize({isItcRecommended:false}).is_itc_recommended, false);
  assert.equal(serialize({}).isItcRecommended, false);
});
test('accepts only boolean selections, including explicit false', async () => {
  for (const value of [true, false, undefined]) assert.equal(validateEditorialFlags({isItcRecommended:value}), null);
  for (const value of ['false', 1, null, {}]) assert.ok(validateEditorialFlags({isItcRecommended:value}));
  let status;
  await updateExperience({body:{isItcRecommended:'false'}}, {status(code){status=code;return this;},json(){}}, assert.fail);
  assert.equal(status, 400);
});
test('create and update persist the flag; omitted updates do not clear it', async () => {
  for (const operation of ['create','update']) {
    for (const value of [true, false, undefined]) {
      const queries = [];
      const connection = { async query(sql, params) { queries.push({sql,params}); return {rowCount:1,rows:[{id:'test'}]}; } };
      const input = {id:'test', title:'Test', access:'premium', section:'drops', is_itc_recommended:value};
      if(operation === 'create') await service.create(input,connection);
      else await service.update('test',input,connection);
      const writes = queries.filter(q=>q.sql.startsWith('UPDATE experiences SET is_itc_recommended='));
      assert.equal(writes.length,value===undefined?0:1);
      if(writes.length) assert.deepEqual(writes[0].params,['test',value]);
    }
  }
});
