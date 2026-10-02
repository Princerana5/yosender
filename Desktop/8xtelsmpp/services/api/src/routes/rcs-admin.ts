import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getPool, query, queryOne, type RcsProviderCredentials, getRcsQueue, RCS_QUEUES } from '@8xtel/core';
import { requirePerm, audit } from '../middleware.js';
import { decryptRcsSecret, encryptRcsSecret } from '@8xtel/core';

const router = Router();
router.use(requirePerm('rcs.read'));
const credentialsSchema = z.record(z.string().max(4096));
const vendorSchema = z.object({
  name: z.string().min(1).max(120),
  provider_key: z.string().min(1).max(80),
  endpoint: z.string().url().max(2048),
  credentials: credentialsSchema,
  webhook_secret: z.string().max(4096).optional(),
  status: z.enum(['enabled', 'disabled', 'degraded']).default('disabled'),
  tps_limit: z.number().int().min(1).max(10000).default(10),
  timeout_ms: z.number().int().min(500).max(60000).default(10000),
  daily_limit: z.number().int().positive().nullable().optional(),
  monthly_limit: z.number().int().positive().nullable().optional(),
  capabilities: z.record(z.boolean()).default({ text: true }),
});
const routeSchema = z.object({
  name: z.string().min(1).max(120), country_id: z.string().uuid().nullable().optional(),
  sender: z.string().max(40).nullable().optional(),
  strategy: z.enum(['priority', 'percentage', 'failover']).default('priority'),
  status: z.enum(['active', 'disabled']).default('disabled'),
  tps_limit: z.number().int().positive().nullable().optional(),
  daily_limit: z.number().int().positive().nullable().optional(),
  monthly_limit: z.number().int().positive().nullable().optional(),
});

function endpointAllowed(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && !['localhost', '127.0.0.1', '::1'].includes(u.hostname.toLowerCase())
      && !u.hostname.endsWith('.local') && !u.hostname.endsWith('.internal')
      && !/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname);
  } catch { return false; }
}

router.get('/vendors', async (_req, res) => {
  const rows = await query(`SELECT id,name,provider_key,endpoint,status,tps_limit,daily_limit,monthly_limit,timeout_ms,capabilities,created_at,updated_at FROM rcs_vendors ORDER BY created_at DESC`);
  res.json({ vendors: rows });
});
router.post('/vendors', requirePerm('rcs.vendors.manage'), audit('created_rcs_vendor', 'rcs_vendor'), async (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
  const b = parsed.data;
  if (!endpointAllowed(b.endpoint)) return void res.status(400).json({ error: 'endpoint must be public HTTPS' });
  const credentials = JSON.stringify(b.credentials);
  const row = await queryOne(`INSERT INTO rcs_vendors(name,provider_key,endpoint,credentials_enc,webhook_secret_enc,status,tps_limit,timeout_ms,daily_limit,monthly_limit,capabilities)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,name,provider_key,endpoint,status,tps_limit,timeout_ms,daily_limit,monthly_limit,capabilities,created_at`,
  [b.name, b.provider_key, b.endpoint, encryptRcsSecret(credentials), b.webhook_secret ? encryptRcsSecret(b.webhook_secret) : null, b.status, b.tps_limit, b.timeout_ms, b.daily_limit ?? null, b.monthly_limit ?? null, JSON.stringify(b.capabilities)]);
  res.status(201).json({ vendor: row });
});
router.patch('/vendors/:id', requirePerm('rcs.vendors.manage'), audit('updated_rcs_vendor', 'rcs_vendor'), async (req, res) => {
  const schema = vendorSchema.partial().omit({ credentials: true, webhook_secret: true });
  const p = schema.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload' });
  const fields: Record<string, unknown> = { ...p.data };
  if (fields.daily_limit !== undefined) fields.daily_limit = fields.daily_limit ?? null;
  if (fields.monthly_limit !== undefined) fields.monthly_limit = fields.monthly_limit ?? null;
  if (req.body.credentials !== undefined) {
    const c = credentialsSchema.safeParse(req.body.credentials);
    if (!c.success) return void res.status(400).json({ error: 'invalid credentials' });
    fields.credentials_enc = encryptRcsSecret(JSON.stringify(c.data));
  }
  if (req.body.webhook_secret !== undefined) fields.webhook_secret_enc = req.body.webhook_secret ? encryptRcsSecret(String(req.body.webhook_secret)) : null;
  if (fields.endpoint && !endpointAllowed(String(fields.endpoint))) return void res.status(400).json({ error: 'endpoint must be public HTTPS' });
  const sets: string[] = [], values: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) { values.push(val); sets.push(`${key}=$${values.length}`); }
  if (!sets.length) return void res.status(400).json({ error: 'nothing to update' });
  values.push(req.params.id);
  const row = await queryOne(`UPDATE rcs_vendors SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING id,name,provider_key,endpoint,status,tps_limit,timeout_ms,daily_limit,monthly_limit,capabilities`, values);
  if (!row) return void res.status(404).json({ error: 'not found' });
  res.json({ vendor: row });
});
router.get('/routes', async (_req, res) => {
  const rows = await query(`SELECT r.*,c.name AS country_name,
    COALESCE((SELECT json_agg(json_build_object('vendor_id',v.id,'vendor_name',v.name,'priority',rv.priority,'weight',rv.weight))
      FROM rcs_route_vendors rv JOIN rcs_vendors v ON v.id=rv.vendor_id WHERE rv.route_id=r.id),'[]'::json) AS vendors,
    COALESCE((SELECT json_agg(rc.client_id) FROM rcs_route_clients rc WHERE rc.route_id=r.id),'[]'::json) AS client_ids
    FROM rcs_routes r LEFT JOIN countries c ON c.id=r.country_id ORDER BY r.created_at DESC`);
  res.json({ routes: rows });
});
router.post('/routes', requirePerm('rcs.routes.manage'), audit('created_rcs_route', 'rcs_route'), async (req, res) => {
  const p = routeSchema.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload', details: p.error.flatten() });
  const b = p.data;
  const row = await queryOne(`INSERT INTO rcs_routes(name,country_id,sender,strategy,status,tps_limit,daily_limit,monthly_limit)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [b.name,b.country_id??null,b.sender??null,b.strategy,b.status,b.tps_limit??null,b.daily_limit??null,b.monthly_limit??null]);
  res.status(201).json({ route: row });
});
router.put('/routes/:id/vendors', requirePerm('rcs.routes.manage'), audit('set_rcs_route_vendors', 'rcs_route'), async (req, res) => {
  const p = z.object({ vendors: z.array(z.object({ vendor_id: z.string().uuid(), priority: z.number().int().min(1), weight: z.number().int().min(1).max(100) })).max(100) }).safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload' });
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rcs_route_vendors WHERE route_id=$1', [req.params.id]);
    for (const v of p.data.vendors) await client.query('INSERT INTO rcs_route_vendors(route_id,vendor_id,priority,weight) VALUES($1,$2,$3,$4)', [req.params.id,v.vendor_id,v.priority,v.weight]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  res.json({ ok: true });
});
router.put('/routes/:id/clients', requirePerm('rcs.routes.manage'), audit('set_rcs_route_clients', 'rcs_route'), async (req, res) => {
  const p = z.object({ client_ids: z.array(z.string().uuid()).max(10000) }).safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload' });
  const db = getPool(), client = await db.connect();
  try {
    await client.query('BEGIN'); await client.query('DELETE FROM rcs_route_clients WHERE route_id=$1', [req.params.id]);
    for (const id of new Set(p.data.client_ids)) await client.query('INSERT INTO rcs_route_clients(route_id,client_id) VALUES($1,$2)', [req.params.id,id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  res.json({ ok: true });
});
router.get('/clients', async (_req, res) => {
  // RCS is exclusive to portal accounts (clients who have a portal login)
  res.json({ clients: await query(`SELECT id,name,system_id,portal_email,status,rcs_enabled FROM clients WHERE COALESCE(is_house,false)=false AND portal_email IS NOT NULL ORDER BY name`) });
});
router.patch('/clients/:id', requirePerm('rcs.clients.manage'), audit('updated_rcs_client', 'client'), async (req, res) => {
  const p = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload' });
  const row = await queryOne('UPDATE clients SET rcs_enabled=$1,updated_at=now() WHERE id=$2 AND COALESCE(is_house,false)=false AND portal_email IS NOT NULL RETURNING id,name,rcs_enabled', [p.data.enabled,req.params.id]);
  if (!row) return void res.status(404).json({ error: 'not found — only portal accounts can be enabled for RCS' });
  res.json({ client: row });
});
router.post('/clients/bulk', requirePerm('rcs.clients.manage'), audit('bulk_updated_rcs_clients', 'client'), async (req, res) => {
  const p = z.object({ client_ids: z.array(z.string().uuid()).min(1).max(500), enabled: z.boolean() }).safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: 'invalid payload', details: p.error.flatten() });
  const result = await getPool().query(
    `UPDATE clients SET rcs_enabled=$1,updated_at=now() WHERE id=ANY($2) AND COALESCE(is_house,false)=false AND portal_email IS NOT NULL RETURNING id`,
    [p.data.enabled, p.data.client_ids],
  );
  res.json({ updated: result.rowCount, ids: result.rows.map((r: { id: string }) => r.id) });
});
router.get('/rates', async (_req, res) => res.json({ rates: await query(`SELECT rr.*,c.name AS client_name,co.name AS country_name FROM rcs_rates rr JOIN clients c ON c.id=rr.client_id JOIN countries co ON co.id=rr.country_id ORDER BY rr.effective_from DESC LIMIT 2000`) }));
router.post('/rates', requirePerm('rcs.rates.manage'), audit('created_rcs_rate', 'rcs_rate'), async (req,res) => {
  const p=z.object({client_id:z.string().uuid(),country_id:z.string().uuid(),price:z.number().min(0).max(1000000)}).safeParse(req.body);
  if(!p.success)return void res.status(400).json({error:'invalid payload'});
  const row=await queryOne('INSERT INTO rcs_rates(client_id,country_id,price) VALUES($1,$2,$3) RETURNING *',[p.data.client_id,p.data.country_id,p.data.price]);
  res.status(201).json({rate:row});
});
router.get('/senders', async (_req,res)=>res.json({senders:await query(`SELECT s.*,c.name AS client_name,co.name AS country_name FROM rcs_senders s JOIN clients c ON c.id=s.client_id LEFT JOIN countries co ON co.id=s.country_id ORDER BY s.created_at DESC LIMIT 2000`)}));
router.post('/senders', requirePerm('rcs.senders.manage'), audit('created_rcs_sender','rcs_sender'), async(req,res)=>{
 const p=z.object({client_id:z.string().uuid(),sender:z.string().min(1).max(40),country_id:z.string().uuid().nullable().optional(),status:z.enum(['pending','approved','blocked']).default('approved')}).safeParse(req.body);
 if(!p.success)return void res.status(400).json({error:'invalid payload'});
 const row=await queryOne(`INSERT INTO rcs_senders(client_id,sender,country_id,status) VALUES($1,$2,$3,$4) ON CONFLICT(client_id,sender,country_id) DO UPDATE SET status=EXCLUDED.status RETURNING *`,[p.data.client_id,p.data.sender,p.data.country_id??null,p.data.status]);
 res.status(201).json({sender:row});
});
router.get('/traffic', async (req,res)=>{
 const limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
 const rows=await query(`SELECT m.id,m.client_id,c.name AS client_name,m.sender,m.destination,m.status,m.price,m.created_at,m.dlr_time,m.route_id,v.name AS vendor_name FROM rcs_messages m JOIN clients c ON c.id=m.client_id LEFT JOIN rcs_vendors v ON v.id=m.vendor_id ORDER BY m.created_at DESC LIMIT $1`,[limit]);
 res.json({messages:rows});
});
router.get('/campaigns', async (_req,res)=>res.json({campaigns:await query(`SELECT c.*,cl.name AS client_name FROM rcs_campaigns c JOIN clients cl ON cl.id=c.client_id ORDER BY c.created_at DESC LIMIT 1000`)}));
router.get('/reports', async (_req,res)=>{
 const totals=await queryOne(`SELECT count(*) AS total,count(*) FILTER(WHERE status='delivered') AS delivered,count(*) FILTER(WHERE status IN ('failed','undelivered','expired','rejected')) AS failed,COALESCE(sum(price) FILTER(WHERE billing_state='charged'),0) AS charged FROM rcs_messages`);
 const daily=await query(`SELECT date_trunc('day',created_at)::date AS day,count(*) AS total,count(*) FILTER(WHERE status='delivered') AS delivered FROM rcs_messages WHERE created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1`);
 res.json({totals,daily});
});
router.get('/webhooks', async (_req,res)=>res.json({events:await query(`SELECT e.id,e.vendor_id,v.name AS vendor_name,e.provider_message_id,e.signature_valid,e.processing_status,e.error,e.received_at,e.processed_at FROM rcs_webhook_events e JOIN rcs_vendors v ON v.id=e.vendor_id ORDER BY e.received_at DESC LIMIT 500`)}));
router.get('/dead-letters', async (_req,res)=>res.json({items:await query(`SELECT d.*,m.client_id,m.destination,m.status AS message_status FROM rcs_dead_letters d JOIN rcs_messages m ON m.id=d.message_id WHERE d.resolved_at IS NULL ORDER BY d.created_at DESC LIMIT 500`)}));
router.post('/test-send', requirePerm('rcs.test.send'), audit('test_rcs_send','rcs_message'), async(req,res)=>{
 const p=z.object({vendor_id:z.string().uuid(),from:z.string().min(1).max(40),to:z.string().min(7).max(20),content:z.unknown()}).safeParse(req.body);
 if(!p.success)return void res.status(400).json({error:'invalid payload'});
 const contentSchema=(await import('@8xtel/core')).rcsContent;
 const content=contentSchema.safeParse(p.data.content);if(!content.success)return void res.status(400).json({error:'invalid content',details:content.error.flatten()});
 const vendor=await queryOne<{id:string;provider_key:string;endpoint:string;credentials_enc:string;timeout_ms:number}>('SELECT id,provider_key,endpoint,credentials_enc,timeout_ms FROM rcs_vendors WHERE id=$1 AND status=\'enabled\'',[p.data.vendor_id]);
 if(!vendor)return void res.status(404).json({error:'enabled provider not found'});
 const credentials=JSON.parse(decryptRcsSecret(vendor.credentials_enc)) as RcsProviderCredentials;
 const {GenericHttpRcsAdapter}=await import('@8xtel/core');
 if(vendor.provider_key!=='generic-http')return void res.status(400).json({error:'provider adapter not installed'});
 const result=await new GenericHttpRcsAdapter().send({endpoint:vendor.endpoint,credentials,from:p.data.from,to:p.data.to,content:content.data,timeoutMs:vendor.timeout_ms});
 res.status(202).json({status:'submitted',provider_message_id:result.providerMessageId});
});
router.get('/settings', async (_req,res)=>res.json({settings:await query('SELECT key,value,updated_at FROM rcs_settings ORDER BY key')}));
router.put('/settings/:key', requirePerm('rcs.settings.manage'), audit('updated_rcs_setting','rcs_setting'), async(req,res)=>{
 const allowed=new Set(['enabled','default_billing_mode','max_campaign_recipients','max_content_bytes']);
 if(!allowed.has(req.params.key))return void res.status(400).json({error:'unsupported setting'});
 let value:unknown=req.body?.value;
 if(req.params.key==='enabled'&&typeof value!=='boolean')return void res.status(400).json({error:'value must be boolean'});
 if(req.params.key==='default_billing_mode'&&!['on_submission','on_delivery'].includes(String(value)))return void res.status(400).json({error:'invalid billing mode'});
 if(['max_campaign_recipients','max_content_bytes'].includes(req.params.key)&&(!Number.isInteger(value)||Number(value)<1||Number(value)>1000000))return void res.status(400).json({error:'value out of range'});
 const row=await queryOne('INSERT INTO rcs_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now() RETURNING key,value,updated_at',[req.params.key,JSON.stringify(value)]);
 res.json({setting:row});
});
router.post('/dead-letters/:id/replay', requirePerm('rcs.deadletters.manage'), audit('replayed_rcs_dead_letter','rcs_dead_letter'), async(req,res)=>{
 const db=getPool(),tx=await db.connect();let messageId='';let cycle=0;
 try {
  await tx.query('BEGIN');
  const dead=await tx.query(`SELECT message_id FROM rcs_dead_letters WHERE id=$1 AND resolved_at IS NULL FOR UPDATE`,[req.params.id]);
  if(!dead.rowCount){await tx.query('ROLLBACK');return void res.status(404).json({error:'not found'});}
  messageId=String(dead.rows[0].message_id);
  const message=await tx.query(`SELECT id,client_id,price::text,status,billing_state FROM rcs_messages WHERE id=$1 FOR UPDATE`,[messageId]);
  if(!message.rowCount||message.rows[0].status!=='failed'||message.rows[0].billing_state!=='released'){
   await tx.query('ROLLBACK');return void res.status(409).json({error:'message is not replayable'});
  }
  const reservation=await tx.query(`SELECT id,amount::text,state FROM rcs_billing_reservations WHERE message_id=$1 FOR UPDATE`,[messageId]);
  if(!reservation.rowCount||reservation.rows[0].state!=='released'){
   await tx.query('ROLLBACK');return void res.status(409).json({error:'message reservation is not replayable'});
  }
  const wallet=await tx.query(`SELECT balance,reserved,credit_limit FROM rcs_wallets WHERE client_id=$1 FOR UPDATE`,[message.rows[0].client_id]);
  if(!wallet.rowCount||Number(wallet.rows[0].balance)-Number(wallet.rows[0].reserved)+Number(wallet.rows[0].credit_limit)<Number(message.rows[0].price)){
   await tx.query('ROLLBACK');return void res.status(422).json({error:'insufficient RCS balance'});
  }
  const updatedWallet=await tx.query(`UPDATE rcs_wallets SET reserved=reserved+$1,updated_at=now() WHERE client_id=$2 RETURNING balance,reserved`,[message.rows[0].price,message.rows[0].client_id]);
  await tx.query(`UPDATE rcs_billing_reservations SET amount=$1,state='held',consumed_amount=0,released_amount=0,settled_at=NULL WHERE id=$2`,[message.rows[0].price,reservation.rows[0].id]);
  const updated=await tx.query(`UPDATE rcs_messages SET billing_cycle=billing_cycle+1,status='queued',billing_state='reserved',error_code=NULL,error_description=NULL,attempts=0,route_id=NULL,vendor_id=NULL,provider_message_id=NULL,updated_at=now() WHERE id=$1 RETURNING billing_cycle`,[messageId]);
  cycle=Number(updated.rows[0].billing_cycle);
  await tx.query(`UPDATE rcs_dead_letters SET resolved_at=now() WHERE id=$1`,[req.params.id]);
  await tx.query(`INSERT INTO rcs_ledger(client_id,reservation_id,message_id,type,amount,balance_after,reserved_after,event_key) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7) ON CONFLICT(event_key) DO NOTHING`,[message.rows[0].client_id,reservation.rows[0].id,messageId,message.rows[0].price,updatedWallet.rows[0].balance,updatedWallet.rows[0].reserved,`replay-reserve:${messageId}:${cycle}`]);
  await tx.query(`INSERT INTO rcs_outbox(message_id,queue_name,dispatch_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[messageId,RCS_QUEUES.route,`replay:${cycle}`]);
  await tx.query('COMMIT');
 } catch(error) { await tx.query('ROLLBACK').catch(()=>undefined); throw error; } finally { tx.release(); }
 await getRcsQueue(RCS_QUEUES.route).add('route',{message_id:messageId},{jobId:`${messageId}:replay:${cycle}`});
 res.json({ok:true,message_id:messageId,replay_cycle:cycle});
});
router.get('/campaigns/:id/rejected.csv', async(req,res)=>{
 const rows=await query<{destination:string;validation_status:string;reason:string|null}>(`SELECT destination,validation_status,reason FROM rcs_campaign_recipients WHERE campaign_id=$1 AND validation_status<>'valid' ORDER BY id`,[req.params.id]);
 const csv=['destination,status,reason',...rows.map(r=>[r.destination,r.validation_status,r.reason??''].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\r\n');
 res.type('text/csv').attachment(`rcs-rejected-${req.params.id}.csv`).send(csv);
});
router.get('/vendors/:id/credentials-check', requirePerm('rcs.vendors.manage'), async(req,res)=>{
 const row=await queryOne<{credentials_enc:string}>('SELECT credentials_enc FROM rcs_vendors WHERE id=$1',[req.params.id]);
 if(!row)return void res.status(404).json({error:'not found'});
 try{const creds=JSON.parse(decryptRcsSecret(row.credentials_enc)) as RcsProviderCredentials;res.json({valid:Boolean(creds.api_key),credential_fields:Object.keys(creds)});}catch{res.status(422).json({valid:false});}
});
export default router;
