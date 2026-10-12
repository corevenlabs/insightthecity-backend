const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const service = require('../services/legal.service');
const controller = require('../controllers/legal.controller');
const { requireAuth } = require('../middleware/auth');
const res = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('rechaza filtros inválidos y páginas no válidas', async () => {
  for (const query of [{page:'0'}, {page:'1.5'}, {page:[]}, {slug:'bad'}, {context:'paid'}, {search:[]}, {search:'x'.repeat(201)}]) {
    const response = res();
    await controller.acceptances({query}, response, e => { throw e; });
    assert.equal(response.code, 400);
  }
});
test('consulta paginada conserva filtros como parámetros y versiones faltantes', async () => {
  const original = db.query; const calls = [];
  db.query = async (sql, values) => { calls.push({sql,values}); return {rows: calls.length === 1 ? [{total:26}] : [{id:'8',version:null,documentId:null}]}; };
  try {
    const data = await service.listAcceptances({search:"' OR 1=1 --",slug:'terms',context:'register',page:2});
    assert.equal(data.total,26); assert.equal(data.items[0].version,null);
    assert.equal(calls[1].values[3],25);
    assert.equal(calls[1].values[0],"' OR 1=1 --");
    assert.ok(!calls[1].sql.includes("' OR 1=1 --"));
    assert.match(calls[1].sql,/LEFT JOIN legal_documents/);
  } finally { db.query = original; }
});
test('recupera la versión por ID y responde 404 si no existe', async () => {
  const original = service.get;
  service.get = async id => id === '2' ? {id:2,version:1,content:'Versión original'} : null;
  try {
    const response = res(); await controller.documentVersion({params:{id:'2'}},response,e=>{throw e;});
    assert.equal(response.body.content,'Versión original');
    const missing = res(); await controller.documentVersion({params:{id:'3'}},missing,e=>{throw e;}); assert.equal(missing.code,404);
  } finally { service.get = original; }
});
test('solo un administrador activo puede consultar los registros', async () => {
  const originalQuery = db.query; const originalVerify = jwt.verify;
  jwt.verify = () => ({id:1,type:'staff'});
  try {
    for (const role of ['editor','sales','admin']) {
      db.query = async () => ({rows:[{id:1,role,is_active:true}]});
      let passed=false; const response=res();
      await requireAuth({headers:{authorization:'Bearer test'}},response,()=>{passed=true;});
      assert.equal(passed,role==='admin'); if(role!=='admin') assert.equal(response.code,403);
    }
    jwt.verify = () => ({id:1,type:'user'});
    const response=res(); await requireAuth({headers:{authorization:'Bearer test'}},response,()=>assert.fail('usuario no autorizado'));
    assert.equal(response.code,403);
  } finally { db.query=originalQuery; jwt.verify=originalVerify; }
});
