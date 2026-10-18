/* global Stripe */
const form=document.querySelector('form'),status=document.querySelector('#form-status'),button=form.querySelector('button[type=submit]');
const invitation=location.hash.slice(1),storageKey='itc-launch:'+invitation;
let authToken=null,elements,stripe,paymentComplete=false,ready=false,busy=false,activated=false,setupConfirmed=false;
function remember(token){authToken=token;try{sessionStorage.setItem(storageKey,JSON.stringify({token,until:Date.now()+30*60*1000}));}catch{/* Password resumption is still available. */}}
function forget(){authToken=null;try{sessionStorage.removeItem(storageKey);}catch{}}
function canSubmit(){return ready&&!busy&&form.checkValidity()&&(paymentComplete||setupConfirmed||activated);}
function update(){button.disabled=!canSubmit();}
async function request(path,body={},token=authToken){
 const response=await fetch('/api/payment/launch/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({invitation,...body})});
 const data=await response.json();if(!response.ok){if(response.status===401)forget();throw Error(data.message||'No pudimos completar la solicitud.');}return data;
}
function accountReady(){for(const input of [form.elements.namedItem('name'),form.email])input.readOnly=true;form.password.value='';form.password.disabled=true;document.querySelector('#account-ready').hidden=false;}
function showSuccess(data){activated=true;document.querySelector('#signup').hidden=true;document.querySelector('#success').hidden=false;document.querySelector('#banner').src='/email-assets/membership-trial-active-es-v2.png';document.querySelector('#banner').alt='YA ERES PARTE DEL CLUB';document.querySelector('#success-title').textContent=`¡Todo listo${data.name?', '+data.name:''}! 💛`;document.querySelector('#confirmed-email').textContent=data.email;document.querySelector('#success-title').focus();}
async function finish(){status.textContent='Confirmando tu mes gratis…';const data=await request('complete');showSuccess(data);}
(async()=>{try{
 if(!/^[a-f0-9]{64}$/.test(invitation))throw Error('Abre el enlace privado que recibiste por correo.');
 const data=await request('preview',{},null);activated=data.activated;
 try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.until>Date.now())authToken=saved.token;}catch{/* No persistent credentials required. */}
 // Stripe may return after bank authentication. Never trust redirect_status as proof.
 if(authToken&&(activated||new URLSearchParams(location.search).has('setup_intent'))){try{await finish();history.replaceState(null,'',location.pathname+'#'+invitation);return;}catch(error){status.textContent=error.message;}}
 if(authToken)authToken=null;
 if(data.resume){document.querySelector('#resume-notice').hidden=false;document.querySelector('label[for=password]').textContent='Contraseña que creaste';form.password.autocomplete='current-password';button.textContent=activated?'Ver mi activación':'Continuar y activar mi mes gratis';}
 if(activated){document.querySelector('#payment-section').hidden=true;ready=true;update();return;}
 if(typeof Stripe!=='function')throw Error('No se pudo cargar el formulario seguro. Recarga la página o desactiva el bloqueador para este sitio.');
 stripe=Stripe(data.publishableKey);
 elements=stripe.elements({mode:'setup',currency:'usd',paymentMethodTypes:['card'],locale:'es',fonts:[{family:'Roboto',src:`url(${location.origin}/brand-assets/fonts/Roboto_400Regular.ttf)`,weight:'400'}],appearance:{theme:'night',variables:{fontFamily:'Roboto, Arial, sans-serif',colorPrimary:'#ffdf55',colorBackground:'#171717',colorText:'#ffffff',borderRadius:'8px'}}});
 const payment=elements.create('payment',{layout:'tabs',wallets:{applePay:'never',googlePay:'never'},fields:{billingDetails:{name:'never',email:'never'}}});
 document.querySelector('#payment-element').replaceChildren();payment.mount('#payment-element');
 payment.on('ready',()=>{ready=true;update();});payment.on('change',event=>{paymentComplete=event.complete;update();});payment.on('loaderror',()=>{ready=false;status.textContent='No se pudo cargar la tarjeta. Recarga la página para intentarlo de nuevo.';update();});
}catch(error){status.textContent=error.message;}})();
form.addEventListener('input',update);form.addEventListener('change',update);
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!canSubmit())return;busy=true;update();status.textContent='Preparando tu activación…';
 try{
  if(!activated&&!setupConfirmed){const {error}=await elements.submit();if(error)throw Error(error.message);}
  if(!authToken){const auth=await request('register',{email:form.email.value.trim(),name:form.elements.namedItem('name').value,password:form.password.value,acceptLegal:form.acceptLegal.checked,consent:form.consent.checked},null);remember(auth.token);accountReady();}
  if(activated||setupConfirmed){await finish();return;}
  const data=await request('prepare',{acceptLegal:form.acceptLegal.checked,consent:form.consent.checked});
  if(data.setupStatus==='succeeded'){setupConfirmed=true;await finish();return;}
  status.textContent='Verificando tu tarjeta de forma segura…';
  const result=await stripe.confirmSetup({elements,clientSecret:data.clientSecret,confirmParams:{return_url:location.origin+location.pathname+'#'+invitation,payment_method_data:{billing_details:{name:form.elements.namedItem('name').value,email:form.email.value.trim()}}},redirect:'if_required'});
  if(result.error)throw Error(result.error.message||'No se pudo verificar la tarjeta. Revisa sus datos.');
  setupConfirmed=true;await finish();
 }catch(error){status.textContent=error.message;}
 finally{busy=false;update();}
});
const resend=document.querySelector('#resend'),resendStatus=document.querySelector('#resend-status');
resend.addEventListener('click',async()=>{if(resend.disabled)return;resend.disabled=true;resendStatus.textContent='Solicitando el reenvío…';try{const data=await request('resend');resendStatus.textContent=data.message;}catch(error){resendStatus.textContent=error.message;}let seconds=60;resend.textContent=`Reenviar en ${seconds} s`;const timer=setInterval(()=>{seconds--;resend.textContent=seconds?`Reenviar en ${seconds} s`:'Reenviar correo de bienvenida';if(!seconds){clearInterval(timer);resend.disabled=false;}},1000);});
