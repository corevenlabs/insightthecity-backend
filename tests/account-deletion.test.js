const {test}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const db=require('../config/db');
const {requireUserAuth}=require('../middleware/auth');
const {render}=require('../services/account-deletion-email');
test('deletion confirmation has brand logo and localized completion copy',()=>{
 for(const lang of ['es','en','pt']) {
  const message=render(lang);
  assert.ok(message.html.includes('itc-club-logo-v1.png'));
  assert.ok(message.text.includes('Stripe'));
  assert.ok(message.text.includes('ITC Club'));
 }
 assert.match(render('es').subject,/completada/);
 assert.match(render('en').subject,/completed/);
 assert.match(render('pt').subject,/concluída/);
});
test('previous valid tokens cannot access an inactive or deleted account',async()=>{
 const original=db.query,secret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='unit-test-deletion';
 const req={headers:{authorization:`Bearer ${jwt.sign({id:7,type:'user'},process.env.JWT_SECRET)}`}};
 try{
  for(const rows of [[],[{is_active:false}]]){
   db.query=async sql=>{assert.ok(sql.includes('account_deletions'));return {rows};};
   const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
   let proceeded=false;await requireUserAuth(req,res,()=>{proceeded=true;});
   assert.equal(res.code,403);assert.equal(proceeded,false);
  }
 }finally{db.query=original;if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;}
});
