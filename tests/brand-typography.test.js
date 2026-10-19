const {test}=require('node:test'),assert=require('node:assert/strict');
const brand=require('../services/brand-typography');
test('one email typography covers membership, deletion and text-only password codes without changing messages',()=>{
 const membership=require('../services/membership-email.service'),deletion=require('../services/account-deletion-email');
 const user={name:'Rafa',language:'es',subscription_amount_cents:499,subscription_interval:'month',subscription_currency:'usd',subscription_current_period_end:'2026-11-17T16:00:00Z'};
 const samples=['welcome','cancel','resume'].map(kind=>membership.membershipEmail(user,kind));
 for(const kind of ['code','requested','completed'])samples.push(deletion.render('es',kind,{code:'12345678'}));
 samples.push({subject:'Tu código',text:'Código: 12345678\nVence en 15 minutos.'});
 for(const before of samples){const after=brand.email(before);assert.equal(after.text,before.text);assert.equal(after.subject,before.subject);assert.match(after.html,/data-itc-typography="v2"/);assert.match(after.html,/font-family:Arial,Helvetica,sans-serif/);assert.match(after.html,/RobotoCondensed_900Black.ttf/);assert.doesNotMatch(after.html,/Impact|Arial Narrow/);assert.equal(brand.email(after).html,after.html);}
 const plain=brand.email({text:'<script>alert(1)</script>\n12345678'});assert.doesNotMatch(plain.html,/<script>/);assert.match(plain.html,/&lt;script&gt;/);
});
test('HTML page middleware adds self-hosted typography, keeps strict CSP, and leaves JSON untouched',()=>{
 const middleware=require('../middleware/brand-typography');let body;const headers={'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"};
 const res={get(k){return headers[k];},set(k,v){headers[k]=v;},send(v){body=v;return this;}};
 middleware({},res,()=>{});res.send('<!doctype html><html><head><title>Mensaje original</title></head><body>12345678</body></html>');
 assert.match(body,/brand-assets\/typography.css/);assert.match(body,/Mensaje original/);assert.match(headers['Content-Security-Policy'],/font-src 'self'/);assert.match(headers['Content-Security-Policy'],/default-src 'none'/);assert.match(headers['Content-Security-Policy'],/style-src 'unsafe-inline' 'self'/);
 const data={success:true};res.send(data);assert.equal(body,data);
});

test('email fonts are inline even in nested tables and previously normalized HTML',()=>{
 const source={subject:'Cancelación',text:'Conservas el acceso',html:`<html><head><style data-itc-typography="v2">p{font-family:Roboto}</style></head><body style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#fff"><table><tr><td><h1>Cancelación</h1><p style='font-family:Roboto;color:#ddd'>Conservas el acceso</p><a href="https://example.com" style="font-weight:700">Mi membresía</a></td></tr></table></body></html>`};
 const result=brand.email(source);
 assert.equal(result.subject,source.subject);assert.equal(result.text,source.text);
 assert.doesNotMatch(result.html,/font-family:Roboto[;}]|Segoe UI|-apple-system|Impact/);
 const tags=result.html.match(/<(?:body|table|tr|td|h1|p|a)\b[^>]*>/g);
 assert.equal(tags.length,7);
 for(const tag of tags)assert.match(tag,/font-family:(?:ITCBanner,Roboto Condensed,Arial,Helvetica|Arial,Helvetica),sans-serif!important/);
 assert.match(result.html,/color:#ddd/);assert.match(result.html,/font-weight:700/);
 assert.equal(brand.email(result).html,result.html);
});
