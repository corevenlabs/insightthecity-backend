const PDF=require('pdfkit');
async function render(row){
 return new Promise((resolve,reject)=>{
 const pdf=new PDF({margin:45}),parts=[];
 pdf.on('data',p=>parts.push(p));pdf.on('end',()=>resolve(Buffer.concat(parts)));pdf.on('error',reject);
 pdf.fontSize(22).text('ITC CLUB');pdf.moveDown().fontSize(16).text('Constancia de aceptación');
 pdf.moveDown().fontSize(11).text(`Registro: ${row.id}\nReferencia: ${row.user_reference || 'No registrada'}\nCliente Stripe: ${row.customer_reference || 'No registrado'}\nFecha UTC: ${new Date(row.accepted_at).toISOString()}\nContexto: ${row.context}\nCuenta eliminada: ${row.account_deleted_at ? new Date(row.account_deleted_at).toISOString() : 'No'}`);
 if(row.renewal_snapshot){pdf.moveDown().text('Condiciones registradas al iniciar el checkout (no acredita un pago):').text(JSON.stringify(row.renewal_snapshot,null,2));}
 const doc=row.document_snapshot;
 pdf.moveDown().text(doc ? `${doc.title} · V${doc.version} · ${doc.language}` : 'Evidencia incompleta: no se conserva un texto/version comprobable.');
 if(doc?.content) pdf.moveDown().text(doc.content);
 pdf.end();
 });
}
module.exports={render};
