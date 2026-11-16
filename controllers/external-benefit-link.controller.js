const db=require('../config/db');
const links=require('../services/external-benefit-link');
const {page}=require('../services/external-benefit-page');
async function show(req,res,next) {
  res.set('Cache-Control','no-store, max-age=0').set('Referrer-Policy','no-referrer').set('X-Robots-Tag','noindex, nofollow');
  res.set('Content-Security-Policy',"default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const lang=links.language(req.query.lang);
  const render=(status,state,row)=>res.status(status).type('html').send(page({state,row,lang,target:req.query.target==='tickets'?'tickets':'benefit'}));
  if(typeof req.params.id!=='string' || req.params.id.length>120 || !/^[a-z0-9_-]+$/.test(req.params.id))return render(404,'missing');
  try {
    const row=(await db.query(`SELECT id,title,access,is_published,benefit_action,benefit_url,is_paid_event,ticket_url,
      private_benefit_code,member_benefit,member_benefit_details,card_benefit,benefit_instructions,description,recommendation,external_benefit_starts_at,external_benefit_ends_at FROM experiences WHERE id=$1`,[req.params.id])).rows[0];
    if(!row || !row.is_published || row.access!=='premium' || row.benefit_action!=='external')return render(404,'missing');
    if(req.query.target!==undefined && req.query.target!=='tickets')return render(404,'missing');
    if(require('../services/private-benefit.service').codeFor(row) && !await require('../services/private-benefit.service').authorizeLink(req.query.grant,row,req.query.target==='tickets'?'tickets':'benefit'))return render(403,'premium',row);
    const target=req.query.target==='tickets' ? (row.is_paid_event ? row.ticket_url : null) : row.benefit_url;
    const url=links.destination(target);
    if(!url)return render(503,'unavailable',row);
    const state=links.phase(row);
    if(state!=='available')return render(state==='expired'?410:state==='unavailable'?503:200,state,row);
    return res.redirect(303,url);
  }catch(error){next(error);}
}
module.exports={show};
