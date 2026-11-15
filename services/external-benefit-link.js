const ORIGIN = 'https://itc-backend-1031252664334.us-east1.run.app';
function base() { return new URL(process.env.PUBLIC_BASE_URL || ORIGIN).origin; }
const language = value => ['es','en','pt'].includes(value) ? value : 'es';
const millis = value => value == null ? null : new Date(value).getTime();
function validDate(value) {
  if(value===null || value===undefined)return true;
  if(typeof value!=='string')return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(m && Number(m[1])>=1000 && Number(m[2])>=1 && Number(m[2])<=12 && Number(m[3])>=1 && Number(m[3])<=new Date(Date.UTC(Number(m[1]),Number(m[2]),0)).getUTCDate() && Number.isFinite(millis(value)));
}
function rangeError(starts,ends) {
  return starts!=null && ends!=null && millis(starts)>=millis(ends)
    ? 'La fecha de finalización del enlace debe ser posterior al inicio.' : null;
}
function validation(body) {
  for(const [field,label] of [['externalBenefitStartsAt','inicio'],['externalBenefitEndsAt','finalización']])
    if(!validDate(body[field]))return `La fecha de ${label} del enlace debe ser válida e incluir su zona horaria.`;
  return rangeError(body.externalBenefitStartsAt,body.externalBenefitEndsAt);
}
function managed(value) {
  try { const u=new URL(value); return u.origin===base() && /^\/benefits\/link\//.test(u.pathname); } catch { return false; }
}
function destination(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && !u.username && !u.password && !managed(value) ? value.trim() : null;
  } catch {return null;}
}
function scheduled(record) { return record.externalBenefitStartsAt!=null || record.externalBenefitEndsAt!=null; }
function url(id,lang,target='benefit') {
  const u=new URL('/benefits/link/'+encodeURIComponent(id),base());
  u.searchParams.set('lang',language(lang));
  if(target==='tickets')u.searchParams.set('target','tickets');
  return u.href;
}
function publicView(record,lang) {
  if(!record || record.access!=='premium' || record.benefitAction!=='external' || !scheduled(record))return record;
  return {...record, benefitUrl: record.benefitUrl ? url(record.id,lang) : record.benefitUrl,
    ...(record.isPaidEvent && record.ticketUrl ? {ticketUrl:url(record.id,lang,'tickets')} : {})};
}
function phase(row,now=Date.now()) {
  const starts=millis(row.external_benefit_starts_at),ends=millis(row.external_benefit_ends_at);
  if(starts!==null&&!Number.isFinite(starts) || ends!==null&&!Number.isFinite(ends) || rangeError(row.external_benefit_starts_at,row.external_benefit_ends_at))return 'unavailable';
  if(ends!==null && now>=ends)return 'expired';
  if(starts!==null && now<starts)return 'scheduled';
  return 'available';
}
async function saveSchedule(c,id,data) {
  if(data.external_benefit_starts_at===undefined && data.external_benefit_ends_at===undefined)return;
  const row=(await c.query('SELECT external_benefit_starts_at,external_benefit_ends_at FROM experiences WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)return;
  const error=rangeError(data.external_benefit_starts_at===undefined?row.external_benefit_starts_at:data.external_benefit_starts_at,data.external_benefit_ends_at===undefined?row.external_benefit_ends_at:data.external_benefit_ends_at);
  if(error)throw Object.assign(new Error(error),{status:400});
  await c.query(`UPDATE experiences SET
    external_benefit_starts_at=CASE WHEN $2::boolean THEN $3::timestamptz ELSE external_benefit_starts_at END,
    external_benefit_ends_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE external_benefit_ends_at END
    WHERE id=$1`,[id,data.external_benefit_starts_at!==undefined,data.external_benefit_starts_at??null,data.external_benefit_ends_at!==undefined,data.external_benefit_ends_at??null]);
}
module.exports={language,validDate,validation,rangeError,managed,destination,publicView,phase,url,saveSchedule};
