const {test}=require('node:test'),assert=require('node:assert/strict');
const brand=require('../services/brand-typography');
test('one email typography covers membership, deletion and text-only password codes without changing messages',()=>{
 const membership=require('../services/membership-email.service'),deletion=require('../services/account-deletion-email');
 const user={name:'Rafa',language:'es',subscription_amount_cents:499,subscription_interval:'month',subscription_currency:'usd',subscription_current_period_end:'2026-11-17T16:00:00Z'};
 const samples=['welcome','cancel','resume'].map(kind=>membership.membershipEmail(user,kind));
 for(const kind of ['code','requested','completed'])samples.push(deletion.render('es',kind,{code:'12345678'}));
 samples.push({subject:'Tu código',text:'Código: 12345678\nVence en 15 minutos.'});
 for(const before of samples){const after=brand.email(before);assert.equal(after.text,before.text);assert.equal(after.subject,before.subject);assert.match(after.html,/data-itc-typography="v1"/);assert.match(after.html,/font-family:Roboto,Arial,Helvetica,sans-serif/);assert.match(after.html,/Roboto_400Regular.ttf/);assert.equal(brand.email(after).html,after.html);}
 const plain=brand.email({text:'<script>alert(1)</script>\n12345678'});assert.doesNotMatch(plain.html,/<script>/);assert.match(plain.html,/&lt;script&gt;/);
});
test('HTML page middleware adds self-hosted typography, keeps strict CSP, and leaves JSON untouched',()=>{
 const middleware=require('../middleware/brand-typography');let body;const headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"};
 const res={get(k){return headers[k];},set(k,v){headers[k]=v;},send(v){body=v;return this;}};
 middleware({},res,()=>{});res.send('<!doctype html><html><head><title>Mensaje original</title></head><body>12345678</body></html>');
 assert.match(body,/brand-assets\/typography.css/);assert.match(body,/Mensaje original/);assert.match(headers['Content-Security-Policy'],/font-src 'self'/);assert.match(headers['Content-Security-Policy'],/default-src 'none'/);assert.match(headers['Content-Security-Policy'],/style-src 'unsafe-inline' 'self'/);
 const data={success:true};res.send(data);assert.equal(body,data);
});
