const R=require('./partner-rules');
async function state(db,experienceId,clientId) {
  const e=experienceId?(await db.query('SELECT id,title,is_published FROM experiences WHERE id=$1',[experienceId])).rows[0]:null;
  const d=clientId?(await db.query('SELECT id,status,payload FROM experience_drafts WHERE client_id=$1',[clientId])).rows[0]:null;
  return {publication_status:e?(e.is_published?'published':'unpublished'):d?'draft':'unlinked',experience_title:e?.title||d?.payload?.title||null,experience_published:e?.is_published??null,experience_draft_id:d?.id||null,experience_draft_status:d?.status||null};
}
async function draftClient(c,id,actor,draftId=null) {
  if(!/^[a-f0-9-]{36}$/i.test(id||''))R.fail('Selecciona un cliente válido',400);
  const row=(await c.query('SELECT * FROM partner_clients WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row || row.deleted_at || !R.canSee(actor,row))R.fail('Cliente no encontrado',404);
  if(row.blocked_at)R.fail('El cliente está bloqueado',409);
  const other=(await c.query('SELECT id FROM experience_drafts WHERE client_id=$1 AND ($2::uuid IS NULL OR id<>$2)',[id,draftId])).rows[0];
  if(other || row.experience_id)R.fail('El cliente ya tiene una experiencia o borrador. Abre el registro existente para editarlo.',409);
  return row;
}
async function link(c,row,experienceId,actor) {
  if(actor.role!=='admin')R.fail('Solo el administrador puede vincular publicaciones',403);
  if(row.blocked_at || row.deleted_at)R.fail('El cliente no está disponible para vinculación',409);
  if(row.experience_id && row.experience_id!==experienceId)R.fail('Desvincula la experiencia anterior antes de seleccionar otra',409);
  const e=(await c.query('SELECT id,title,is_published FROM experiences WHERE id=$1 FOR UPDATE',[experienceId])).rows[0];
  if(!e)R.fail('Experiencia no encontrada',404);
  if((await c.query('SELECT 1 FROM partner_clients WHERE experience_id=$1 AND id<>$2 AND deleted_at IS NULL',[experienceId,row.id])).rowCount)
    R.fail('Esta experiencia ya está vinculada a otro cliente',409);
  const drafts=(await c.query('SELECT id,client_id FROM experience_drafts WHERE experience_id=$1 FOR UPDATE',[experienceId])).rows;
  if(drafts.some(d=>d.client_id && d.client_id!==row.id))R.fail('El borrador pertenece a otro cliente',409);
  if((await c.query('SELECT 1 FROM experience_drafts WHERE client_id=$1 AND (experience_id IS NULL OR experience_id<>$2)',[row.id,experienceId])).rowCount)
    R.fail('El cliente ya tiene otro borrador. Revísalo antes de vincular.',409);
  await c.query('UPDATE experience_drafts SET client_id=$2 WHERE experience_id=$1 AND client_id IS NULL',[experienceId,row.id]);
  if(row.experience_id===experienceId)return e;
  await c.query('UPDATE partner_clients SET experience_id=$2,updated_at=NOW() WHERE id=$1',[row.id,experienceId]);
  await c.query("INSERT INTO partner_activity(client_id,actor_id,kind,note) VALUES($1,$2,'link-experience',$3)",[row.id,actor.id,`Experiencia vinculada: ${e.title} (${e.id}). Se conserva la vigencia comercial.`]);
  return e;
}
module.exports={state,link,draftClient};
