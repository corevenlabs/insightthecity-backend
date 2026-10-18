const {test}=require('node:test'),assert=require('node:assert/strict');
const {render}=require('../services/membership-invitation-email.service');
test('invitation describes registration and later activation without reusing active membership copy',()=>{
 const message=render({base:'https://example.test',url:'https://example.test/membership-invitation#'+'a'.repeat(64),sandbox:true});
 assert.match(message.html,/membership-invitation-register-es-v1.png/);
 assert.match(message.html,/Crear mi cuenta y activar mi mes gratis/);
 assert.match(message.html,/US\$4.99 al mes/);
 assert.match(message.html,/SIN COBROS REALES/);
 assert.doesNotMatch(message.html,/ya está activa|membership-welcome-es-phone|membership-trial-active/);
 assert.match(message.text,/Tu mes gratis empieza cuando completes la activación/);
});
test('worker rejects untrusted calls including malformed tokens',()=>{
 process.env.JWT_SECRET='worker-test';const middleware=require('../middleware/membership-email-worker');
 for(const authorization of ['', 'Bearer '+ 'x'.repeat(64),'Bearer '+'é'.repeat(64)]){let status;middleware({headers:{authorization}},{status(code){status=code;return this;},json(){}},()=>assert.fail('untrusted worker'));assert.equal(status,401);}
 const token=require('crypto').createHmac('sha256','worker-test').update('membership-email-worker-v1').digest('hex');let accepted=false;middleware({headers:{authorization:'Bearer '+token}},{},()=>accepted=true);assert.equal(accepted,true);
});
