(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 let challenge=null,proof=null,busy=false;
 const sentAt=new Map();
 function show(step){
  for(const name of ['email','code','confirm','pending'])$(name+'-step').hidden=name!==step;
  const active=step==='confirm'?1:step==='pending'?2:0;
  for(let i=0;i<3;i++)i===active?$('step-'+i).setAttribute('aria-current','step'):$('step-'+i).removeAttribute('aria-current');
  const focus=$(step==='email'?'email':step+'-title');if(focus)focus.focus();
 }
 function reset(){challenge=null;proof=null;$('code').value='';$('consent').checked=false;$('confirm-button').disabled=true;show('email');}
 async function post(path,body){
  const response=await fetch('/api/account-deletions/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit'});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(Error(),{expired:response.status===400});
  return data;
 }
 async function action(fn){
  if(busy)return;busy=true;$('main').setAttribute('aria-busy','true');$('error').hidden=true;
  const buttons=[...document.querySelectorAll('button,select')];buttons.forEach(b=>b.disabled=true);
  try{await fn();}catch(e){$('error').textContent=$('error').dataset[e.wait?'wait':e.expired?'expired':'error'];$('error').hidden=false;}
  finally{busy=false;$('main').removeAttribute('aria-busy');buttons.forEach(b=>b.disabled=false);$('confirm-button').disabled=!$('consent').checked;}
 }
 $('language').addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('lang',$('language').value);location.assign(url.pathname+url.search);});
 $('email-form').addEventListener('submit',e=>{e.preventDefault();void action(async()=>{const email=$('email').value.trim().toLowerCase();if(Date.now()-(sentAt.get(email)||0)<61000)throw {wait:true};const result=await post('request-code',{email,language:document.documentElement.lang});sentAt.set(email,Date.now());challenge=result.challenge;proof=null;show('code');});});
 $('code-form').addEventListener('submit',e=>{e.preventDefault();void action(async()=>{const result=await post('verify-code',{challenge,code:$('code').value.trim()});proof=result.proof;show('confirm');});});
 $('consent').addEventListener('change',()=>{$('confirm-button').disabled=busy||!$('consent').checked;});
 $('confirm-form').addEventListener('submit',e=>{e.preventDefault();if(!$('consent').checked||!proof)return;void action(async()=>{await post('confirm',{proof,accept:true});proof=null;challenge=null;$('email').value='';$('code').value='';show('pending');});});
 $('restart').addEventListener('click',reset);
 $('cancel').addEventListener('click',()=>{reset();$('status').textContent=$('cancel').dataset.cancelled;});
})();
