const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const store = require('../services/news-store.service');

const post = (id, date = '2026-11-24T10:00:00') => ({ id, date, link: `https://example.test/${id}`, title: { rendered: `Nota ${id}` }, excerpt: { rendered: '<p>Resumen</p>' }, content: { rendered: '<p>Texto</p>' } });
const captcha = { status: 202, headers: { 'content-type': 'text/html', 'sg-captcha': 'challenge' }, data: '<html><meta http-equiv="refresh"></html>' };
const wpError = (status, code) => Object.assign(new Error('http'), { response: { status, headers: {}, data: { code } } });

// Fresh module each time: the service keeps an in-memory cache.
async function withNews({ get, copy = {} }, fn) {
  const originals = { get: axios.get, error: console.error, ...store };
  const state = { requests: 0, saved: [], removed: [], logs: [] };
  axios.get = async (...args) => { state.requests++; return get(...args); };
  console.error = (...args) => state.logs.push(args.join(' '));
  Object.assign(store, {
    saveList: async (...args) => { state.saved.push(args); }, savePost: async (value) => { state.saved.push(value); },
    removePost: async (id) => { state.removed.push(id); }, list: async () => copy.list ?? null, post: async () => copy.post ?? null,
  });
  delete require.cache[require.resolve('../services/news.service')];
  try { await fn(require('../services/news.service'), state); }
  finally { axios.get = originals.get; console.error = originals.error; for (const key of ['saveList', 'savePost', 'removePost', 'list', 'post']) store[key] = originals[key]; delete require.cache[require.resolve('../services/news.service')]; }
}

test('a bot-check page with a 2xx status is a failure, not an empty note', async () => {
  await withNews({ get: async () => captcha }, async (news, state) => {
    await assert.rejects(news.getNews(5), { status: 502 });
    await assert.rejects(news.listNews({ section: 'ny-al-dia' }), { status: 502 });
    assert.equal(state.saved.length, 0);
    assert.match(state.logs[0], /"status":202/);
    assert.match(state.logs[0], /"captcha":"challenge"/);
    assert.doesNotMatch(state.logs.join(' '), /<html>/);
    assert.equal(state.requests, 4); // both hosts, for each call
  });
});

test('the last stored copy is served, without insisting on WordPress for a minute', async () => {
  const copy = { list: { items: [{ id: 1 }], page: 1, perPage: 10, total: 1, totalPages: 1 }, post: { id: 5, contentHtml: 'x' } };
  await withNews({ get: async () => captcha, copy }, async (news, state) => {
    assert.deepEqual(await news.listNews({ section: 'que-hacer' }), copy.list);
    assert.deepEqual(await news.getNews(5), copy.post);
    const requests = state.requests;
    assert.deepEqual(await news.listNews({ section: 'que-hacer' }), copy.list);
    assert.deepEqual(await news.getNews(5), copy.post);
    assert.equal(state.requests, requests);
  });
});

test('valid content is served and stored; a broken store does not break it', async () => {
  await withNews({ get: async (url) => ({ status: 200, headers: { 'x-wp-total': '31', 'x-wp-totalpages': '4' }, data: url.endsWith('/posts') ? [post(2), post(1)] : post(2) }) }, async (news, state) => {
    const list = await news.listNews({ section: 'ny-al-dia', page: 1, perPage: 10 });
    assert.deepEqual([list.items.map((item) => item.id), list.total, list.totalPages], [[2, 1], 31, 4]);
    assert.equal(list.items[0].contentHtml, undefined);
    const [section, stored, range] = state.saved[0];
    assert.deepEqual([section, stored[0].contentHtml, range], ['ny-al-dia', '<p>Texto</p>', { first: true, last: false }]);
    store.savePost = async () => { throw new Error('db down'); };
    assert.equal((await news.getNews(2)).title, 'Nota 2');
  });
});

test('WordPress errors are told apart from the hosting', async () => {
  await withNews({ get: async (url) => { throw wpError(url.endsWith('/posts') ? 400 : 404, url.endsWith('/posts') ? 'rest_post_invalid_page_number' : 'rest_post_invalid_id'); } }, async (news, state) => {
    assert.deepEqual((await news.listNews({ section: 'ny-al-dia', page: 99 })).items, []);
    await assert.rejects(news.getNews(9), { status: 404 });
    assert.deepEqual(state.removed, [9]);
    assert.equal(state.requests, 2);
  });
  await withNews({ get: async () => { throw Object.assign(new Error('http'), { response: { status: 404, headers: {}, data: '<html>' } }); } }, async (news, state) => {
    await assert.rejects(news.getNews(9), { status: 502 });
    assert.deepEqual(state.removed, []);
  });
  await withNews({ get: async () => assert.fail('no request expected') }, async (news) => {
    for (const id of ['abc', '-1', '1.5', '99999999999']) await assert.rejects(news.getNews(id), { status: 400 });
  });
});
