const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ids = ['liberty-state-park-sunset', 'hoboken-food-discount'];

test('routine migrations and manual sample data never recreate the retired publications', () => {
  for (const file of ['database/schema.sql', 'database/seed.js']) {
    const source = fs.readFileSync(file, 'utf8');
    for (const id of ids) assert(!source.includes(id), `${file} recreates ${id}`);
  }
});
test('cleanup is scoped to the two exact IDs and protects customer and QR relationships', () => {
  const sql = fs.readFileSync('database/remove-retired-sample-experiences.sql', 'utf8');
  assert.deepEqual([...sql.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map(m=>m[1]), ids);
  assert.match(sql, /DELETE FROM experiences WHERE id = ANY\(retired_ids\)/);
  for (const table of ['partner_clients','experience_drafts','benefit_redemptions']) assert(sql.includes(`SELECT 1 FROM ${table} WHERE experience_id = ANY(retired_ids)`));
  assert(sql.indexOf('RAISE EXCEPTION') < sql.indexOf('DELETE FROM experiences'));
  assert(!/TRUNCATE|DELETE FROM (partner_clients|experience_drafts|benefit_redemptions)/i.test(sql));
});
test('deployment migration runner actually executes the cleanup after the schema', async () => {
  const files=[];
  let finish;
  const done=new Promise(r=>{finish=r;});
  vm.runInNewContext(fs.readFileSync('database/migrate.js','utf8'), {
    __dirname:'/database', console:{log(){},error:assert.fail},process:{},
    require(name){
      if(name==='dotenv') return {config(){}};
      if(name==='fs') return {readFileSync(file){files.push(file);return file;}};
      if(name==='path') return require('node:path');
      if(name==='../config/db') return {async query(){},async end(){finish();}};
      throw Error(name);
    },
  });
  await done;
  assert.equal(files.at(-1),'/database/remove-retired-sample-experiences.sql');
  assert(files.indexOf('/database/schema.sql') < files.indexOf(files.at(-1)));
});
