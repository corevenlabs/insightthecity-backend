// Design-time renderer. Run with Playwright installed (NODE_PATH may point to it).
// A single font file and weight keep the banner family consistent. Body copy is
// deliberately outside this renderer and is not modified.
const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public/email');
const data=[
 ['lifecycle-deletion-code-es-v1.png',['Verifica','tu correo.'],'',1,50,130,92],
 ['lifecycle-deletion-code-en-v1.png',['Verify','your email.'],'',1,50,130,92],
 ['lifecycle-deletion-code-pt-v1.png',['Verifique','seu e-mail.'],'',1,50,130,92],
 ['lifecycle-deletion-requested-es-v1.png',['Solicitud','recibida.'],'',1,50,130,92],
 ['lifecycle-deletion-requested-en-v1.png',['Request','received.'],'',1,50,130,92],
 ['lifecycle-deletion-requested-pt-v1.png',['Solicitação','recebida.'],'',1,50,130,92],
 ['lifecycle-deletion-completed-es-v1.png',['Cuenta','eliminada.'],'',1,50,130,92],
 ['lifecycle-deletion-completed-en-v1.png',['Account','deleted.'],'',1,50,130,92],
 ['lifecycle-deletion-completed-pt-v1.png',['Conta','excluída.'],'',1,50,130,92],
 ['lifecycle-alert-en-v1.png',['Review','required.'],'',1,50,130,92],
 ['lifecycle-smtp-es-v1.png',['Prueba','de correo.'],'',1,50,130,92],
 ['password-reset-es-v1.png',['Recupera','tu acceso.'],'',1,50,130,92],
 ['password-reset-en-v1.png',['Recover','your access.'],'',1,50,130,92],
 ['password-reset-pt-v1.png',['Recupere','seu acesso.'],'',1,50,130,92],
 ['membership-cancel-es-v1.png',['Renovación','cancelada.'],'',1,50,95,76],
 ['membership-resume-es-v1.png',['Renovación','reactivada.'],'',1,50,95,76],
 ['membership-cancel-en-v1.png',['Renewal','canceled.'],'',1,50,95,76],
 ['membership-resume-en-v1.png',['Renewal','reactivated.'],'',1,50,95,76],
 ['membership-cancel-pt-v1.png',['Renovação','cancelada.'],'',1,50,95,76],
 ['membership-resume-pt-v1.png',['Renovação','reativada.'],'',1,50,95,76],
 ['membership-invitation-register-es-v1.png',['¡Vamos a','estrenar la app!'],'',1,50,180,89],
 ['partner-welcome-banner-v2.png',['Welcome to','ITC CLUB.'],'Let’s build this together.',1,50,86,92],
 ['partner-invitation-banner-v2.png',['Your business.','Our community.','Let’s grow together.'],'An invitation to join ITC CLUB',2,50,70,88],
 ['partner-accepted-terms-banner-v2.png',['Your accepted terms.','For your records.'],'A copy of your participation agreement',1,50,117,90],
 ['partner-corrections-banner-v2.png',['Let’s show','what makes','your business special.'],'',2,50,88,92],
 ['membership-welcome-es-phone-v2.png',['YA ERES','PARTE DEL','CLUB.'],'Nueva York tiene más para ti.',2,50,145,77],
 ['membership-welcome-en-phone-v2.png',['YOU’RE','PART OF THE','CLUB.'],'New York has more for you.',2,50,145,77],
 ['membership-welcome-pt-phone-v2.png',['VOCÊ JÁ FAZ','PARTE DO','CLUB.'],'Nova York tem mais para você.',2,50,145,77],
 ['membership-account-created-es-v2.png',['YA TIENES','TU CUENTA'],'',1,50,195,78],
 ['membership-trial-active-es-v2.png',['YA ERES PARTE','DEL CLUB'],'',1,50,195,78],
];
// Approved bundled fonts keep every email banner consistent.
const font=fs.readFileSync(path.join(root,'public/brand/fonts/RobotoCondensed_900Black.ttf')).toString('base64');
const subtitleFont=font;
const image=fs.readFileSync(path.join(out,'membership-phone-background-v1.png')).toString('base64');
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(item){const [name,lines,subtitle,gold,x,y,size]=item;return `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:ITCBanner;src:url(data:font/ttf;base64,${font});font-weight:900}@font-face{font-family:ITCBannerSubtitle;src:url(data:font/ttf;base64,${subtitleFont});font-weight:900}*{box-sizing:border-box}body{margin:0}.banner{position:relative;width:1200px;height:564px;background:url(data:image/png;base64,${image}) center/cover}.text{position:absolute;left:${x}px;top:${y}px;color:#fff;font-family:ITCBanner,sans-serif;font-weight:900;font-size:${size}px;line-height:1.04;letter-spacing:-.5px}.line{white-space:nowrap}.gold{color:#FDDD56}.sub{font-family:ITCBannerSubtitle,sans-serif;font-weight:900;font-size:29px;line-height:1.2;letter-spacing:0;margin-top:24px;white-space:nowrap}</style><div class="banner"><div class="text">${lines.map((line,i)=>`<div class="line ${i===gold?'gold':''}">${esc(line)}</div>`).join('')}${subtitle?`<div class="sub">${esc(subtitle)}</div>`:''}</div></div>`;}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});try{for(const item of data.filter(item=>!process.env.BANNER_FILTER||item[0].startsWith(process.env.BANNER_FILTER))){const page=await browser.newPage({viewport:{width:1200,height:564},deviceScaleFactor:1.5});await page.setContent(html(item));await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.locator('.text').evaluate(e=>{while(e.getBoundingClientRect().width>565&&parseFloat(getComputedStyle(e).fontSize)>40)e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)-1)+'px';});const width=await page.locator('.text').evaluate(e=>e.getBoundingClientRect().width);const bounds=await page.locator('.text').boundingBox();if(width>565||bounds.y+bounds.height>544)throw Error('Text exceeds safe area: '+item[0]);await page.locator('.banner').screenshot({path:path.join(out,item[0])});await page.close();}const previewDir=path.join(root,'../output/tipografia-correos');fs.mkdirSync(previewDir,{recursive:true});const gallery=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});await gallery.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#080808;color:#fff;font:14px Arial}h1{font-size:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{width:100%;display:block}figcaption{padding:10px 0;color:#bbb}</style><h1>Banners de correo · Roboto Condensed Black</h1><main>'+data.map(item=>'<figure><img src="data:image/png;base64,'+fs.readFileSync(path.join(out,item[0])).toString('base64')+'"><figcaption>'+esc(item[0])+'</figcaption></figure>').join('')+'</main>');await gallery.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await gallery.screenshot({path:path.join(previewDir,'banners-roboto-condensed.png'),fullPage:true});await gallery.close();console.log('Rendered '+data.length+' consistent banners; messages unchanged.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
