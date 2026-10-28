require('dotenv').config();
const db=require('../config/db');
const language=require('../services/content-language.service');
const experiences=require('../services/experiences.service');
const {serialize}=require('../controllers/experiences.controller');
const news=require('../services/news.service');
(async()=>{
 await Promise.all(['en','pt'].map(async lang=>{
  for(const slug of ['terms','privacy','subscription','accessibility'])await require('../services/legal.service').getCurrent(slug,lang);
  console.log(lang,'published legal reading versions prepared');
  const items=(await experiences.list({publishedOnly:true})).rows;
  for(let i=0;i<items.length;i+=4)await Promise.all(items.slice(i,i+4).map(item=>language.experience(serialize(item),lang)));
  console.log(lang,items.length,'published experiences translated');
  for(const section of ['ny-al-dia','que-hacer']){
   const first=await news.listNews({section,perPage:20});
   for(const item of first.items.slice(0,5)){try{await language.article(await news.getNews(item.id),lang);}catch(error){throw new Error(`${lang} ${section} detail ${item.id}: ${error.message}`);}}
   for(let page=1;page<=Math.min(100,first.totalPages);page++){
    const feed=page===1?first:await news.listNews({section,page,perPage:20});
    for(let i=0;i<feed.items.length;i+=6)await Promise.all(feed.items.slice(i,i+6).map(async item=>{try{return await language.article(item,lang);}catch(error){throw new Error(`${lang} ${section} page ${page} item ${item.id}: ${error.message}`);}}));
    if(page%5===0)console.log(lang,section,'prepared page',page,'of',first.totalPages);
   }
   console.log(lang,section,'feed translated',first.total,'articles');
   // Warm the first screen of details; older articles translate on first open.

  }
 }));
})().then(()=>db.end()).catch(async e=>{console.error(e.message);await db.end();process.exitCode=1;});
