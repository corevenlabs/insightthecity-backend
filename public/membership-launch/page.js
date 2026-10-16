const form=document.querySelector('form'),status=document.querySelector('[role=status]'),button=document.querySelector('button[type=submit]');
const invitation=location.hash.slice(1);history.replaceState(null,'',location.pathname);
if(!/^[a-f0-9]{64}$/.test(invitation)){status.textContent='Abre el enlace privado que recibiste por correo.';button.disabled=true;}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='Preparando tu activación…';
 try{
  const login=await fetch('/api/users/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email.value.trim(),password:form.password.value})});
  const auth=await login.json();form.password.value='';if(!login.ok||!auth.token)throw Error(auth.message||'Revisa tu correo y contraseña.');
  const response=await fetch('/api/payment/launch/checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},body:JSON.stringify({invitation,consent:form.consent.checked})});
  const data=await response.json();if(!response.ok)throw Error(data.message||'No pudimos iniciar la prueba.');
  const url=new URL(data.checkoutUrl);if(url.origin!=='https://checkout.stripe.com')throw Error('Destino de pago inválido.');location.assign(url.href);
 }catch(error){status.textContent=error.message;button.disabled=false;}
});
