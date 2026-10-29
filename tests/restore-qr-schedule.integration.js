const assert=require('node:assert/strict');
if(process.env.DB_DATABASE!=='itc_qr_consent_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated database required');
const db=require('../config/db'),{restore}=require('../scripts/restore-nuyores-qr.cjs');
(async()=>{const c=await db.connect();let passed=0;
const id='local-restore-qr',early=new Date(Date.now()-86400000).toISOString(),start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+3*86400000).toISOString(),options={id,earlyStart:early,originalStart:start,expectedEnd:end};
async function fixture(fn){await c.query('BEGIN');try{await c.query(`INSERT INTO experiences(id,title,category,access,is_published,benefit_action,coupon_active,coupon_starts_at,coupon_ends_at,coupon_inventory_mode,coupon_total,coupon_per_user) VALUES($1,'Local schedule test','FOOD','premium',TRUE,'qr',TRUE,$2::timestamptz+INTERVAL '456 microseconds',$3,'limited',10,2)`,[id,early,end]);await fn();passed++;}finally{await c.query('ROLLBACK');}}
try{
 await fixture(async()=>{const restored=await restore(c,options);assert.equal(restored.changed,true);assert.match(restored.previousStartStored,/\d{6}(?:[+-]\d{2}|Z)$/,'retains DB microsecond precision for compare-and-set');assert.equal((await restore(c,options)).changed,false);const row=(await c.query('SELECT * FROM experiences WHERE id=$1',[id])).rows[0];assert.equal(row.coupon_per_user,2);assert.equal(row.coupon_total,10);assert.equal(row.coupon_active,true);assert.equal(row.coupon_starts_at.toISOString(),start);assert.equal(row.coupon_ends_at.toISOString(),end);});
 await fixture(async()=>{await assert.rejects(restore(c,{...options,earlyStart:new Date(Date.now()-2*86400000).toISOString()}),/Schedule changed/);});
 await fixture(async()=>{await assert.rejects(restore(c,{...options,expectedEnd:new Date(Date.now()+4*86400000).toISOString()}),/Expiration changed/);});
 await fixture(async()=>{await assert.rejects(restore(c,{...options,originalStart:early}),/no longer in the future/);});
 console.log(JSON.stringify({scenariosPassed:passed,isolatedDatabase:true,allRolledBack:true}));
}finally{c.release();await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
