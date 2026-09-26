const db = require('../config/db');
const { getPrivateDownloadUrl } = require('./uploads.service');
const FIELDS = `id,title,description,category,language,region,access,cover_url AS "coverUrl",pdf_name AS "pdfName",pdf_size AS "pdfSize",page_count AS "pageCount",is_featured AS "isFeatured",is_published AS "isPublished",downloads,created_at AS "createdAt",updated_at AS "updatedAt"`;
async function list(admin = false) { const { rows } = await db.query(`SELECT ${FIELDS} FROM guides ${admin ? '' : 'WHERE is_published=TRUE'} ORDER BY is_featured DESC, created_at DESC`); return rows; }
async function get(id) { const { rows } = await db.query(`SELECT ${FIELDS},pdf_key AS "pdfKey" FROM guides WHERE id=$1`,[id]); return rows[0]||null; }
async function save(id, b) {
  const vals=[b.title,b.description||null,b.category||null,b.language||'es',b.region||'NY',b.access||'premium',b.coverUrl||null,b.pdfKey,b.pdfName||null,Number(b.pdfSize)||0,b.pageCount?Number(b.pageCount):null,!!b.isFeatured,b.isPublished!==false];
  const sql=id?`UPDATE guides SET title=$1,description=$2,category=$3,language=$4,region=$5,access=$6,cover_url=$7,pdf_key=COALESCE($8,pdf_key),pdf_name=COALESCE($9,pdf_name),pdf_size=CASE WHEN $8 IS NULL THEN pdf_size ELSE $10 END,page_count=$11,is_featured=$12,is_published=$13,updated_at=NOW() WHERE id=$14 RETURNING id`:`INSERT INTO guides(title,description,category,language,region,access,cover_url,pdf_key,pdf_name,pdf_size,page_count,is_featured,is_published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`;
  if(id) vals.push(id); const {rows}=await db.query(sql,vals); return rows[0]?get(rows[0].id):null;
}
async function remove(id){const {rowCount}=await db.query('DELETE FROM guides WHERE id=$1',[id]);return rowCount>0;}
async function download(id,userId){const guide=await get(id);if(!guide||!guide.isPublished)return null;if(guide.access==='premium'){const {rows}=await db.query('SELECT is_premium,is_active FROM users WHERE id=$1',[userId]);if(!rows[0]?.is_active||!rows[0]?.is_premium){const e=new Error('Necesitas una membresía ITC Club activa.');e.status=403;throw e;}}await db.query('UPDATE guides SET downloads=downloads+1 WHERE id=$1',[id]);return {url:await getPrivateDownloadUrl(guide.pdfKey),guide};}
module.exports={list,get,save,remove,download};
