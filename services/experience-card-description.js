const {createHash}=require('node:crypto');
const descriptions=require('../config/experience-card-descriptions.json');
const {previewFor}=require('./chat-card-preview');
// Editorial summaries apply only to the reviewed source. Editing a publication
// automatically falls back to an excerpt of its current text, never stale claims.
function cardDescriptionFor(record) {
 const source=String(record.description||'');
 if(!source.trim())return '';
 const reviewed=descriptions[record.id];
 if(reviewed?.sourceHash===createHash('sha256').update(source).digest('hex'))return reviewed.text;
 const preview=previewFor(record);
 if(Array.from(preview).length<=110)return preview;
 let text='';
 for(const word of preview.split(/\s+/)){if(Array.from((text?text+' ':'')+word).length>109)break;text+=(text?' ':'')+word;}
 return text?text.replace(/[,;:]$/,'')+'…':'';
}
module.exports={cardDescriptionFor};
