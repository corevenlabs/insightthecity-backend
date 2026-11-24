const { test, after } = require('node:test');
const assert = require('node:assert/strict');
if (process.env.DB_DATABASE !== 'itc_crm_test' || process.env.DB_HOST !== '127.0.0.1') throw Error('Isolated database only');
const db = require('../config/db');
const store = require('../services/news-store.service');
after(() => db.end());

const note = (id, day) => ({ id, title: `Nota ${id}`, contentHtml: `<p>${id}</p>`, date: `2026-11-${day}T10:00:00` });
const ids = async (page = 1, perPage = 10) => ((await store.list('ny-al-dia', page, perPage))?.items ?? []).map((item) => item.id);

test('the stored copy follows what WordPress publishes', async () => {
  await db.query('DELETE FROM news_posts');
  assert.equal(await store.list('ny-al-dia', 1, 10), null);

  await store.saveList('ny-al-dia', [note(5, 24), note(4, 23)], { first: true });
  await store.saveList('ny-al-dia', [note(3, 22), note(2, 21)], { last: true });
  await store.saveList('que-hacer', [note(4, 23)], { first: true, last: true });
  assert.deepEqual(await ids(), [5, 4, 3, 2]);
  assert.deepEqual(await ids(2, 3), [2]);
  assert.deepEqual(await ids(9, 3), []);
  assert.equal((await store.list('ny-al-dia', 1, 3)).totalPages, 2);
  assert.equal((await store.list('ny-al-dia', 1, 3)).items[0].contentHtml, undefined);
  assert.equal((await store.post(4)).contentHtml, '<p>4</p>');

  // 4 was removed from this section; 6 is new; 3 and 2 belong to another page and stay.
  await store.saveList('ny-al-dia', [note(6, 25), note(5, 24)], { first: true });
  assert.deepEqual(await ids(), [6, 5, 4, 3, 2]);
  await store.saveList('ny-al-dia', [note(6, 25), note(5, 24), note(3, 22)], { first: true });
  assert.deepEqual(await ids(), [6, 5, 3, 2]);
  assert.equal((await store.list('que-hacer', 1, 10)).total, 1);
  // Everything after the last page is gone.
  await store.saveList('ny-al-dia', [note(6, 25), note(5, 24)], { first: true, last: true });
  assert.deepEqual(await ids(), [6, 5]);

  await store.savePost({ ...note(5, 24), title: 'Corregida' });
  assert.equal((await store.list('ny-al-dia', 1, 10)).items[1].title, 'Corregida');
  await store.removePost(5);
  assert.deepEqual(await ids(), [6]);

  // Pages loaded at the same time (the chat catalog does it) do not deadlock.
  await Promise.all([1, 2, 3, 4].map((n) => store.saveList('ny-al-dia', [note(6, 25), note(10 + n, 10 + n)], {})));
  assert.ok((await ids()).includes(6));
});
