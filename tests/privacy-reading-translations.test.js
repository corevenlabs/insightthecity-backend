const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '../legal/privacy-2026-10-31');
const source = require('../legal/privacy-2026-10-31/source.json');
const { localizePrivacy } = require('../services/privacy-reading-translations');
const contents = Object.fromEntries(['es','en','pt'].map(l=>[l,fs.readFileSync(path.join(root,l+'.md'),'utf8')]));
const document = { id:source.documentId, slug:'privacy', language:'es', version:source.version, title:'Política de Privacidad', content:contents.en, publishedAt:source.publishedAt };

test('three complete translations retain all sections, numeric terms, links, emails and policy date', () => {
  assert.equal(createHash('sha256').update(contents.en).digest('hex'),source.sourceSha256);
  const captures = [s=>s.match(/\d+/g),s=>s.match(/https?:\/\/[^\s)]+/g),s=>s.match(/[\w.+-]+@[\w.-]+/g),s=>[...s.matchAll(/^# (\d+)\./gm)].map(m=>m[1]),s=>s.trim().split(/\n\s*\n/).length];
  for (const language of ['es','en','pt']) {
    const localized = localizePrivacy(document,language);
    assert.equal(localized.language,language);
    assert.equal(localized.id,document.id);
    assert.equal(localized.version,document.version);
    assert.equal(localized.publishedAt,'2026-10-31T16:36:56.522Z');
    assert.equal(localized.content,contents[language]);
    for (const capture of captures) assert.deepEqual(capture(localized.content),capture(contents.en));
  }
  assert.match(contents.es,/^# Política de Privacidad\n/);
  assert.match(contents.es,/Última actualización:\*\* 31 de octubre de 2026/);
  assert.match(contents.en,/Last updated:\*\* October 31, 2026/);
  assert.match(contents.pt,/Última atualização:\*\* 31 de outubro de 2026/);
  assert.equal(document.content,contents.en);
});
test('translations cannot mask later publications, altered content, a different slug or an unsupported language', () => {
  for (const changes of [{id:19},{version:6},{publishedAt:'2026-11-08T12:00:00Z'},{content:contents.en+'New condition'},{slug:'terms'}]) assert.equal(localizePrivacy({...document,...changes},'es'),null);
  assert.equal(localizePrivacy(document,'fr'),null);
  assert.equal(localizePrivacy(null,'es'),null);
});
test('public reading and new acceptance snapshots resolve the same October 31 source without provider calls or historical rewrites',async()=>{
  const db=require('../config/db'),legal=require('../services/legal.service');
  const old=db.query;const reads=[];const saved=[];
  db.query=async(sql,params)=>{reads.push(sql);return {rows:[{...document,published_at:document.publishedAt}]};};
  try {
    for (const language of ['es','en','pt']) {
      const shown=await legal.getCurrent('privacy',language);
      await legal.recordAcceptance({query:async(sql,params)=>{saved.push({sql,snapshot:JSON.parse(params[6])});}},{userId:1,language,context:'register',slugs:['privacy']});
      assert.deepEqual(saved.at(-1).snapshot,JSON.parse(JSON.stringify(shown)));
      assert.equal(shown.content,contents[language]);
    }
    assert(reads.every(sql=>sql.trim().startsWith('SELECT')));
    assert(saved.every(x=>x.sql.trim().startsWith('INSERT INTO legal_acceptances')));
  } finally {db.query=old;}
});
test('web selector and HTML body use the selected language and the original policy date',async()=>{
 const legal=require('../services/legal.service'),controller=require('../controllers/legal.controller');
 const old=legal.getCurrent;
 legal.getCurrent=async(slug,language)=>localizePrivacy(document,language);
 try {
  for(const language of ['es','en','pt']) {
   let html='';const response={set(){return this;},type(){return this;},send(value){html=value;return this;}};
   await controller.page({params:{slug:'privacy'},query:{lang:language}},response,error=>{throw error;});
   assert(html.includes(`<html lang="${language}">`));
   assert(html.includes('2026-10-31'));
   assert(html.includes(localizePrivacy(document,language).title));
   assert(html.includes(`lang="${language}" aria-current="page"`));
   assert(!html.includes('2026-10-30'));
  }
 } finally {legal.getCurrent=old;}
});
