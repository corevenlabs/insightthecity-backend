// Design-time renderer. Run with Playwright installed (NODE_PATH may point to it).
// A single font file and weight keep the banner family consistent. Body copy is
// deliberately outside this renderer and is not modified.
const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public/email');
const data=[
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
const font=fs.readFileSync(path.join(root,'public/brand/fonts/RobotoCondensed_900Black.ttf')).toString('base64');
const image=fs.readFileSync(path.join(out,'membership-phone-background-v1.png')).toString('base64');
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(item){const [name,lines,subtitle,gold,x,y,size]=item;return `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:ITCBanner;src:url(data:font/ttf;base64,${font});font-weight:100 900}*{box-sizing:border-box}body{margin:0}.banner{position:relative;width:1200px;height:564px;background:url(data:image/png;base64,${image}) center/cover}.text{position:absolute;left:${x}px;top:${y}px;color:#fff;font-family:ITCBanner,sans-serif;font-weight:900;font-size:${size}px;line-height:1.04;letter-spacing:-.5px}.line{white-space:nowrap}.gold{color:#FDDD56}.sub{font-family:ITCBanner,sans-serif;font-weight:700;font-size:29px;line-height:1.2;letter-spacing:0;margin-top:24px;white-space:nowrap}</style><div class="banner"><div class="text">${lines.map((line,i)=>`<div class="line ${i===gold?'gold':''}">${esc(line)}</div>`).join('')}${subtitle?`<div class="sub">${esc(subtitle)}</div>`:''}</div></div>`;}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});try{for(const item of data){const page=await browser.newPage({viewport:{width:1200,height:564},deviceScaleFactor:1.5});await page.setContent(html(item));await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.locator('.text').evaluate(e=>{while(e.getBoundingClientRect().width>565&&parseFloat(getComputedStyle(e).fontSize)>40)e.style.fontSize=(parseFloat(getComputedStyle(e).fontSize)-1)+'px';});const width=await page.locator('.text').evaluate(e=>e.getBoundingClientRect().width);if(width>600)throw Error('Text exceeds safe area: '+item[0]+' '+width);await page.locator('.banner').screenshot({path:path.join(out,item[0])});await page.close();}console.log('Rendered '+data.length+' consistent banners; messages unchanged.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
