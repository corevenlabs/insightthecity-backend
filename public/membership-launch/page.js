const form=document.querySelector('form'),status=document.querySelector('[role=status]'),button=document.querySelector('button[type=submit]');
// Keep the private fragment so refresh and reopening the invitation can resume registration.
// Fragments are not sent to the server or in HTTP referrers.
const invitation=location.hash.slice(1);let authToken=null;
async function request(path,body,token){
 const response=await fetch('/api/payment/launch/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Error(data.message||'No pudimos completar la solicitud.');return data;
}
(async()=>{try{
 if(!/^[a-f0-9]{64}$/.test(invitation))throw Error('Abre el enlace privado que recibiste por correo.');
 const data=await request('preview',{invitation});
 if(data.resume){document.querySelector('#step-title').textContent='Continúa tu activación';document.querySelector('#step-description').textContent='Tu cuenta ya se creó desde esta invitación. Introduce el mismo correo y la contraseña que elegiste para retomar el paso de Stripe.';document.querySelector('label[for=password]').textContent='Contraseña que creaste';form.password.autocomplete='current-password';button.textContent='Continuar mi activación';}
 button.disabled=false;
}catch(error){status.textContent=error.message;}})();
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='Preparando tu activación…';
 try{
  if(!authToken){
   const auth=await request('register',{invitation,email:form.email.value.trim(),name:form.elements.namedItem('name').value,password:form.password.value,acceptLegal:form.acceptLegal.checked});
   authToken=auth.token;form.password.value='';
   document.querySelector('#registration').hidden=true;document.querySelectorAll('#registration input').forEach(input=>input.disabled=true);
   document.querySelector('#activation').hidden=false;document.querySelector('#next-step').hidden=true;form.consent.disabled=false;
   document.querySelector('#step-title').textContent='2. Activa tus 30 días gratis';document.querySelector('#step-description').textContent='Tu cuenta está creada. La prueba comenzará cuando completes Stripe con una tarjeta de prueba. Podrás entrar a la app con el correo y la contraseña que elegiste.';
   button.textContent='Activar mis 30 días gratis';status.textContent='Revisa y acepta la renovación antes de continuar a Stripe.';button.disabled=false;return;
  }
  const data=await request('checkout',{invitation,consent:form.consent.checked},authToken);
  const url=new URL(data.checkoutUrl);if(url.origin!=='https://checkout.stripe.com')throw Error('Destino de pago inválido.');location.assign(url.href);
 }catch(error){status.textContent=error.message;button.disabled=false;}
});
