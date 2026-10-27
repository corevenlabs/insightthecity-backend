const db = require('../config/db');
const crm = require('../services/partner-crm.service');
const experiences = require('../services/experiences.service');
const controller = require('./experiences.controller');
const { randomUUID } = require('node:crypto');
const fail = (status,message) => Object.assign(new Error(message),{status});
async function draft(req,res,next) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const row = await crm.get(c,req.params.id,req.admin,true);
    if(row.blocked_at) throw fail(403,'El cliente está bloqueado');
    const existing = row.experience_id ? await experiences.getById(row.experience_id,c) : null;
    if(req.method === 'GET') {
      await c.query('COMMIT');
      return res.json(controller.serialize(existing));
    }
    if(row.activated_at || existing?.is_published) throw fail(403,'Un perfil publicado solo se modifica desde la administración');
    if((await c.query("SELECT 1 FROM experience_drafts WHERE client_id=$1 AND status<>'approved'",[row.id])).rowCount)
      throw fail(409,'Este cliente ya tiene un borrador en Experiencias. Abre ese borrador desde la ficha del cliente.');
    if(row.payment_status === 'pending' || !['submitted','ready'].includes(row.form_status)) throw fail(409,'El cliente debe completar el formulario y el pago antes de preparar la experiencia');
    if(row.form_status === 'ready' && req.admin.role !== 'admin') throw fail(409,'El borrador está pendiente de aprobación. Un administrador debe devolverlo a preparación antes de editarlo');
    if(req.body.isPublished === true || req.body.is_published === true) throw fail(403,'Solo el administrador puede publicar la experiencia');
    const body = {...req.body,id:existing?.id || 'partner-'+randomUUID(),access:'premium',isPublished:false,is_published:false};
    let status = 200, result;
    const capture = {status(value){status=value;return this;},json(value){result=value;return this;}};
    await (existing ? controller.updateExperience : controller.createExperience)({...req,body,params:{id:body.id},experienceConnection:c},capture,error=>{throw error;});
    if(status>=400) throw fail(status,result?.message || 'No se pudo guardar el borrador');
    if(!result?.id) throw fail(500,'No se pudo guardar el borrador');
    await c.query('UPDATE partner_clients SET experience_id=$2,updated_at=NOW() WHERE id=$1',[row.id,result.id]);
    await c.query("INSERT INTO partner_activity(client_id,actor_id,kind,note) VALUES($1,$2,'experience-draft','Borrador guardado sin publicación')",[row.id,req.admin.id]);
    await c.query('COMMIT');
    res.status(existing?200:201).json(result);
  } catch(error) {await c.query('ROLLBACK');next(error);} finally {c.release();}
}
module.exports={draft};
