import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getPool, query, queryOne, getRcsQueue, RCS_QUEUES, tryAcquireTps, rcsMessageRequest, rcsContent, normalizeRcsDestination } from '@8xtel/core';
import { parse as parseCsv } from 'csv-parse/sync';
import { decryptRcsSecret, GenericHttpRcsAdapter } from '@8xtel/core';
import type { RcsProviderCredentials, RcsStatus } from '@8xtel/core';

const router = Router();
const apiPrefix = '/rcs/v1';
interface RcsApiClient { id: string; status: string; rcs_enabled: boolean; balance: string; tps_limit: number; key_id: string; permissions: string[]; ip_allowlist: string[] }

type AuthedRequest = Parameters<typeof Router>[0];

function sha256(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function requestIp(req: { ip?: string; socket: { remoteAddress?: string } }): string { return (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''); }
function ipAllowed(ip: string, rules: string[]): boolean {
  if (!rules.length) return true;
  return rules.some((rule) => {
    const [base, bitsText] = rule.split('/');
    if (base === ip) return true;
    if (!bitsText || !/^\d+\.\d+\.\d+\.\d+$/.test(base) || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    const bits = Number(bitsText); if (bits < 0 || bits > 32) return false;
    const n = (s: string): number => s.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n(base) & mask) === (n(ip) & mask);
  });
}

async function apiAuth(req: any, res: any, next: any): Promise<void> {
  const raw = (req.headers.authorization ?? '').startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
  const apiClient = raw.length >= 24 ? await queryOne<RcsApiClient>(
    `SELECT c.id,c.status,c.rcs_enabled,c.tps_limit,w.balance::text AS balance,k.id AS key_id,k.permissions,
            COALESCE(k.ip_allowlist,ARRAY[]::cidr[])::text[] AS ip_allowlist
     FROM rcs_client_api_keys k JOIN clients c ON c.id=k.client_id
     LEFT JOIN rcs_wallets w ON w.client_id=c.id
     WHERE k.key_hash=$1 AND k.is_active=true`, [sha256(raw)],
  ) : null;
  if (!apiClient) { res.status(401).json({ error: 'invalid RCS API key', code: 'AUTH_INVALID' }); return; }
  const client = { ...apiClient, balance: apiClient.balance ?? '0', permissions: apiClient.permissions ?? [], ip_allowlist: apiClient.ip_allowlist ?? [] };
  if (!ipAllowed(requestIp(req), client.ip_allowlist)) { res.status(403).json({ error: 'IP address is not allowed', code: 'IP_DENIED' }); return; }
  if (client.status !== 'active' || !client.rcs_enabled) { res.status(403).json({ error: 'RCS is not enabled for this account', code: 'RCS_DISABLED' }); return; }
  req.rcsClient = client;
  void getPool().query('UPDATE rcs_client_api_keys SET last_used_at=now() WHERE id=$1',[client.key_id]).catch(()=>undefined);
  next();
}
function getClient(req: any): RcsApiClient { return req.rcsClient as RcsApiClient; }
function needPermission(permission: string) { return (req: any,res: any,next: any): void => {
  if (!getClient(req).permissions.includes(permission)) { res.status(403).json({error:'API key lacks permission',code:'PERMISSION_DENIED'}); return; } next();
}; }

async function writeApiLog(clientId: string, keyId: string, req: any, status: number, errorCode: string | null): Promise<void> {
  await getPool().query(`INSERT INTO rcs_api_request_logs(client_id,key_id,endpoint,method,status_code,ip,error_code) VALUES($1,$2,$3,$4,$5,$6,$7)`,[clientId,keyId,String(req.path).slice(0,200),req.method,status,requestIp(req),errorCode]).catch(()=>undefined);
}

async function createMessage(clientId: string, from: string, rawTo: string, content: unknown, idempotencyKey: string | undefined, clientMessageId: string | undefined): Promise<{id:string;status:string;duplicate:boolean;price:string}> {
  const to = normalizeRcsDestination(rawTo);
  if (!to) throw Object.assign(new Error('destination must be a valid E.164 number'),{status:400,code:'INVALID_DESTINATION'});
  const parsedContent = rcsContent.safeParse(content);
  if (!parsedContent.success) throw Object.assign(new Error('invalid RCS content'),{status:400,code:'INVALID_CONTENT',details:parsedContent.error.flatten()});
  const size = Buffer.byteLength(JSON.stringify(parsedContent.data));
  const setting = await queryOne<{value: number}>('SELECT (value#>>\'{}\')::int AS value FROM rcs_settings WHERE key=$1',['max_content_bytes']);
  if (size > Number(setting?.value ?? 32768)) throw Object.assign(new Error('RCS content too large'),{status:413,code:'CONTENT_TOO_LARGE'});
  const sender = await queryOne<{status:string}>('SELECT status FROM rcs_senders WHERE client_id=$1 AND sender=$2 ORDER BY country_id NULLS LAST LIMIT 1',[clientId,from]);
  if (!sender || sender.status !== 'approved') throw Object.assign(new Error('sender is not approved for RCS'),{status:422,code:'SENDER_NOT_ALLOWED'});
  const country = await queryOne<{id:string}>('SELECT id FROM countries WHERE status=\'active\' AND $1 LIKE \'+\'||calling_code||\'%\' ORDER BY length(calling_code) DESC LIMIT 1',[to]);
  if (!country) throw Object.assign(new Error('unsupported destination country'),{status:422,code:'UNSUPPORTED_COUNTRY'});
  const db=getPool(), tx=await db.connect();
  try {
    await tx.query('BEGIN');
    if (idempotencyKey) {
      const existing=await tx.query(`SELECT id,status,price::text FROM rcs_messages WHERE client_id=$1 AND idempotency_key=$2`,[clientId,idempotencyKey]);
      if (existing.rowCount) { await tx.query('COMMIT'); return {id:existing.rows[0].id,status:existing.rows[0].status,duplicate:true,price:existing.rows[0].price}; }
    }
    const rate=await tx.query(`SELECT price::text FROM rcs_rates WHERE client_id=$1 AND country_id=$2 AND effective_from<=now() ORDER BY effective_from DESC LIMIT 1`,[clientId,country.id]);
    if (!rate.rowCount) throw Object.assign(new Error('RCS rate is not configured'),{status:422,code:'RATE_NOT_FOUND'});
    const price=String(rate.rows[0].price);
    const wallet=await tx.query('SELECT balance,reserved,credit_limit,currency FROM rcs_wallets WHERE client_id=$1 FOR UPDATE',[clientId]);
    if (!wallet.rowCount) throw Object.assign(new Error('RCS wallet is not configured'),{status:422,code:'WALLET_NOT_CONFIGURED'});
    const w=wallet.rows[0];
    if (Number(w.balance)-Number(w.reserved)+Number(w.credit_limit)<Number(price)) throw Object.assign(new Error('insufficient RCS balance'),{status:422,code:'INSUFFICIENT_BALANCE'});
    const messageId=crypto.randomUUID();
    const inserted=await tx.query(`INSERT INTO rcs_messages(id,client_id,client_message_id,idempotency_key,sender,destination,country_id,content,status,price)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9) ON CONFLICT(client_id,idempotency_key) DO NOTHING RETURNING id,status,price::text`,
    [messageId,clientId,clientMessageId??null,idempotencyKey??null,from,to,country.id,JSON.stringify(parsedContent.data),price]);
    if (!inserted.rowCount) {
      const existing=await tx.query('SELECT id,status,price::text FROM rcs_messages WHERE client_id=$1 AND idempotency_key=$2',[clientId,idempotencyKey]);
      await tx.query('COMMIT');return {id:existing.rows[0].id,status:existing.rows[0].status,duplicate:true,price:existing.rows[0].price};
    }
    const reservation=await tx.query(`INSERT INTO rcs_billing_reservations(client_id,message_id,amount) VALUES($1,$2,$3) RETURNING id`,[clientId,messageId,price]);
    const updated=await tx.query(`UPDATE rcs_wallets SET reserved=reserved+$1,updated_at=now() WHERE client_id=$2 AND balance-(reserved+$1)+credit_limit>=0 RETURNING balance,reserved,currency`,[price,clientId]);
    if (!updated.rowCount) throw Object.assign(new Error('insufficient RCS balance'),{status:422,code:'INSUFFICIENT_BALANCE'});
    await tx.query(`INSERT INTO rcs_ledger(client_id,reservation_id,message_id,type,amount,balance_after,reserved_after,event_key) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7)`,[clientId,reservation.rows[0].id,messageId,price,updated.rows[0].balance,updated.rows[0].reserved,`reserve:${messageId}`]);
    await tx.query(`INSERT INTO rcs_outbox(message_id,queue_name,dispatch_key) VALUES($1,$2,$3)`,[messageId,RCS_QUEUE_SUBMIT,'initial']);
    await tx.query('COMMIT');
    return {id:messageId,status:'queued',duplicate:false,price};
  } catch(error) { await tx.query('ROLLBACK').catch(()=>undefined); throw error; } finally { tx.release(); }
}
const RCS_QUEUE_SUBMIT = 'rcs-route';

async function publishOutbox(messageId: string): Promise<void> {
  const client=await getPool().connect();
  try {
    await client.query('BEGIN');
    const row=await client.query(`SELECT id,queue_name,dispatch_key FROM rcs_outbox WHERE message_id=$1 AND state='pending' AND dispatch_key='initial' FOR UPDATE`,[messageId]);
    if(!row.rowCount){await client.query('COMMIT');return;}
    await getRcsQueue(RCS_QUEUES.route).add('route',{message_id:messageId},{jobId:`${messageId}:outbox:${row.rows[0].dispatch_key}`});
    await client.query(`UPDATE rcs_outbox SET state='published',attempts=attempts+1,published_at=now() WHERE id=$1`,[row.rows[0].id]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

router.use(apiAuth);
router.post('/send', needPermission('send'), async(req:any,res:any)=>{
  const request=rcsMessageRequest.safeParse(req.body);
  if(!request.success){const c=getClient(req);await writeApiLog(c.id,c.key_id,req,400,'INVALID_PAYLOAD');return void res.status(400).json({error:'invalid payload',code:'INVALID_PAYLOAD',details:request.error.flatten()});}
  const client=getClient(req);
  if(!(await tryAcquireTps(`rcs-client:${client.id}`,client.tps_limit))){await writeApiLog(client.id,client.key_id,req,429,'TPS_LIMIT');return void res.status(429).json({error:'rate limit exceeded',code:'TPS_LIMIT',retry_after:1});}
  try {
    const result=await createMessage(client.id,request.data.from,request.data.to,request.data.content,request.data.idempotency_key??req.get('Idempotency-Key'),request.data.client_message_id);
    await publishOutbox(result.id);
    await writeApiLog(client.id,client.key_id,req,result.duplicate?200:202,null);
    res.status(result.duplicate?200:202).json({id:result.id,status:result.status,duplicate:result.duplicate,price:result.price});
  }catch(error){const e=error as Error&{status?:number;code?:string;details?:unknown};await writeApiLog(client.id,client.key_id,req,e.status??500,e.code??'INTERNAL');res.status(e.status??500).json({error:e.message,code:e.code??'INTERNAL',...(e.details?{details:e.details}:{})});}
});

router.post('/campaigns', needPermission('campaigns'), async(req:any,res:any)=>{
 const schema=z.object({name:z.string().min(1).max(160),from:z.string().min(1).max(40),content:rcsContent,recipients:z.array(z.string()).min(1).max(50000)});
 const p=schema.safeParse(req.body);if(!p.success)return void res.status(400).json({error:'invalid payload',details:p.error.flatten()});
 const client=getClient(req);const rows:{destination:string;state:string;reason:string|null}[]=[];const seen=new Set<string>();
 for(const original of p.data.recipients){const n=normalizeRcsDestination(original);if(!original.trim()){rows.push({destination:'',state:'empty',reason:'empty destination'});continue;}
  if(seen.has(n??original)){rows.push({destination:original.trim(),state:'duplicate',reason:'duplicate recipient'});continue;}seen.add(n??original);
  if(!n){rows.push({destination:original.trim(),state:'invalid',reason:'invalid E.164 number'});continue;}
  const country=await queryOne<{id:string}>('SELECT id FROM countries WHERE status=\'active\' AND $1 LIKE \'+\'||calling_code||\'%\' ORDER BY length(calling_code) DESC LIMIT 1',[n]);
  rows.push(country?{destination:n,state:'valid',reason:null}:{destination:n,state:'unsupported_country',reason:'country not supported'});
 }
 const valid=rows.filter(r=>r.state==='valid');
 if(!valid.length)return void res.status(422).json({error:'no valid recipients',summary:{total:rows.length,valid:0,invalid:rows.filter(r=>r.state==='invalid').length,duplicate:rows.filter(r=>r.state==='duplicate').length,empty:rows.filter(r=>r.state==='empty').length,unsupported_country:rows.filter(r=>r.state==='unsupported_country').length}});
 const rate=await queryOne<{price:string}>('SELECT max(price)::text AS price FROM rcs_rates WHERE client_id=$1 AND effective_from<=now()',[client.id]);
 if(!rate)return void res.status(422).json({error:'RCS rates are not configured'});
 const total=(Number(rate.price)*valid.length).toFixed(6);const pool=getPool(),tx=await pool.connect();let campaignId='';
 try{await tx.query('BEGIN');const wallet=await tx.query('SELECT balance,reserved,credit_limit FROM rcs_wallets WHERE client_id=$1 FOR UPDATE',[client.id]);if(!wallet.rowCount||Number(wallet.rows[0].balance)-Number(wallet.rows[0].reserved)+Number(wallet.rows[0].credit_limit)<Number(total))throw Object.assign(new Error('insufficient RCS balance'),{status:422});
 const ins=await tx.query(`INSERT INTO rcs_campaigns(client_id,name,sender,content,status,recipient_count,accepted_count,rejected_count,reserved_amount) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8) RETURNING id`,[client.id,p.data.name,p.data.from,JSON.stringify(p.data.content),rows.length,valid.length,rows.length-valid.length,total]);campaignId=ins.rows[0].id;
 for(const r of rows)await tx.query(`INSERT INTO rcs_campaign_recipients(campaign_id,destination,validation_status,reason) VALUES($1,$2,$3,$4)`,[campaignId,r.destination,r.state,r.reason]);
 const upd=await tx.query(`UPDATE rcs_wallets SET reserved=reserved+$1,updated_at=now() WHERE client_id=$2 RETURNING balance,reserved`,[total,client.id]);
 const reserve=await tx.query('INSERT INTO rcs_billing_reservations(client_id,campaign_id,amount) VALUES($1,$2,$3) RETURNING id',[client.id,campaignId,total]);
 await tx.query(`INSERT INTO rcs_ledger(client_id,reservation_id,campaign_id,type,amount,balance_after,reserved_after,event_key) VALUES($1,$2,$3,'reserve',$4,$5,$6,$7)`,[client.id,reserve.rows[0].id,campaignId,total,upd.rows[0].balance,upd.rows[0].reserved,`reserve-campaign:${campaignId}`]);
 await tx.query('COMMIT');}catch(e){await tx.query('ROLLBACK');const err=e as Error&{status?:number};return void res.status(err.status??500).json({error:err.message});}finally{tx.release();}
 await getRcsQueue(RCS_QUEUES.campaign).add('expand',{campaign_id:campaignId},{jobId:campaignId});
 res.status(202).json({campaign_id:campaignId,status:'queued',summary:{total:rows.length,valid:valid.length,invalid:rows.filter(r=>r.state==='invalid').length,duplicate:rows.filter(r=>r.state==='duplicate').length,empty:rows.filter(r=>r.state==='empty').length,unsupported_country:rows.filter(r=>r.state==='unsupported_country').length},reserved_amount:total});
});
router.get('/campaigns/:id',needPermission('campaigns'),async(req:any,res:any)=>{
 const campaign=await queryOne('SELECT * FROM rcs_campaigns WHERE id=$1 AND client_id=$2',[req.params.id,getClient(req).id]);if(!campaign)return void res.status(404).json({error:'not found'});
 const summary=await queryOne('SELECT validation_status,count(*) AS count FROM rcs_campaign_recipients WHERE campaign_id=$1 GROUP BY validation_status',[req.params.id]);
 res.json({campaign,summary});
});
router.post('/campaigns/:id/cancel',needPermission('campaigns'),async(req:any,res:any)=>{
 const row=await queryOne(`UPDATE rcs_campaigns SET status='cancelled',updated_at=now() WHERE id=$1 AND client_id=$2 AND status IN ('queued','processing','paused') RETURNING id,status`,[req.params.id,getClient(req).id]);if(!row)return void res.status(404).json({error:'campaign not found or terminal'});
 await getRcsQueue(RCS_QUEUES.campaign).add('cancel',{campaign_id:req.params.id},{jobId:`cancel:${req.params.id}`});res.json({campaign:row});
});
router.get('/status/:id',needPermission('status'),async(req:any,res:any)=>{
 const row=await queryOne(`SELECT id,client_message_id,sender,destination,status,error_code,error_description,price,submit_time,dlr_time FROM rcs_messages WHERE id=$1 AND client_id=$2`,[req.params.id,getClient(req).id]);if(!row)return void res.status(404).json({error:'not found'});res.json({message:row});
});
router.get('/balance',needPermission('balance'),async(req:any,res:any)=>{
 const row=await queryOne('SELECT balance,reserved,credit_limit,currency,(balance-reserved+credit_limit) AS available FROM rcs_wallets WHERE client_id=$1',[getClient(req).id]);res.json({balance:row??{balance:'0',reserved:'0',credit_limit:'0',currency:'USD',available:'0'}});
});
router.get('/usage',needPermission('balance'),async(req:any,res:any)=>{
 const rows=await query(`SELECT status,count(*) AS count,COALESCE(sum(price),0) AS amount FROM rcs_messages WHERE client_id=$1 AND created_at>=date_trunc('month',now()) GROUP BY status ORDER BY status`,[getClient(req).id]);res.json({usage:rows});
});
router.get('/templates',async(req:any,res:any)=>res.json({templates:await query(`SELECT id,name,content,created_at FROM rcs_templates WHERE status='active' AND (client_id=$1 OR client_id IS NULL) ORDER BY name`,[getClient(req).id])}));
router.get('/docs',(_req,res)=>res.json({base_url:'/rcs/v1',auth:'Authorization: Bearer <RCS_API_KEY>',endpoints:[
 {method:'POST',path:'/send',body:{from:'Brand',to:'+14155552671',content:{type:'text',text:'Hello'},idempotency_key:'unique-request-key'}},
 {method:'POST',path:'/campaigns',body:{name:'Campaign',from:'Brand',content:{type:'text',text:'Hello'},recipients:['+14155552671']}},
 {method:'GET',path:'/status/:id'},{method:'GET',path:'/balance'},{method:'GET',path:'/usage'},
]}));

// Public provider callback. Provider ID is a random opaque vendor id; events are
// authenticated, bounded, persisted immutably, then normalized asynchronously.
export const rcsWebhookRouter=Router();
rcsWebhookRouter.post('/:vendorId',async(req:any,res:any)=>{
 if(Buffer.byteLength(JSON.stringify(req.body??{}))>64*1024)return void res.status(413).json({error:'webhook payload too large'});
 const vendor=await queryOne<{id:string;webhook_secret_enc:string|null;provider_key:string}>('SELECT id,webhook_secret_enc,provider_key FROM rcs_vendors WHERE id=$1 AND status=\'enabled\'',[req.params.vendorId]);
 if(!vendor||!vendor.webhook_secret_enc)return void res.status(404).json({error:'not found'});
 let secret:string;try{secret=decryptRcsSecret(vendor.webhook_secret_enc);}catch{return void res.status(503).json({error:'webhook unavailable'});}
 if(vendor.provider_key!=='generic-http')return void res.status(501).json({error:'provider adapter not installed'});
 const normalized=new GenericHttpRcsAdapter().parseWebhook({body:req.body,headers:req.headers,secret});
 if(!normalized)return void res.status(401).json({error:'invalid webhook signature or payload'});
 const hash=sha256(JSON.stringify(req.body));
 const result=await getPool().query(`INSERT INTO rcs_webhook_events(vendor_id,event_hash,provider_message_id,raw_body,signature_valid) VALUES($1,$2,$3,$4,true) ON CONFLICT(vendor_id,event_hash) DO NOTHING RETURNING id`,[vendor.id,hash,normalized.provider_message_id,JSON.stringify(req.body)]);
 if(result.rowCount){await getRcsQueue(RCS_QUEUES.webhook).add('process',{event_id:result.rows[0].id,normalized},{jobId:String(result.rows[0].id)});}
 res.status(202).json({accepted:true,duplicate:!result.rowCount});
});
export default router;
