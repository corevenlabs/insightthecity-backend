const {test}=require('node:test');
const assert=require('node:assert/strict');
const email=require('../services/partner-email.service');
test('administrator approval notice uses localized review wording, escaped business and direct staff link',()=>{
 for(const language of ['es','en','pt']){
  const msg=email.render('approval',{language,client:{business_name:'Cafe <script>bad()</script>',offer:'strategic'},owner:{name:'Responsible executive',email:'owner@example.test'},url:'https://panel.example.test/clientes/test-id'});
  assert.ok(msg.html.includes('https://panel.example.test/clientes/test-id'));
  assert.ok(msg.html.includes('Cafe &lt;script&gt;'));
  assert.ok(!msg.html.includes('<script>'));
  assert.ok(msg.html.includes('Responsible executive'));
  assert.ok(!msg.html.includes('/partner#'));
  assert.ok(!msg.subject.includes('undefined'));
 }
});
