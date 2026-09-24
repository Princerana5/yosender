import nodemailer, { type Transporter } from 'nodemailer';

export interface MailAttachment { filename: string; content: Buffer; contentType?: string; }

let billingTransport: Transporter | null = null;
let rnTransport: Transporter | null = null;

function buildTransport(opts: { host: string; port: number; secure: boolean; user: string; pass: string }): Transporter {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass },
  });
}

export function getBillingTransport(): Transporter | null {
  const host = process.env.BILLING_SMTP_HOST ?? process.env.RN_SMTP_HOST ?? process.env.SMTP_HOST;
  const user = process.env.BILLING_SMTP_USER ?? process.env.RN_SMTP_USER;
  const pass = process.env.BILLING_SMTP_PASS ?? process.env.RN_SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (!billingTransport) {
    billingTransport = buildTransport({
      host,
      port: Number(process.env.BILLING_SMTP_PORT ?? process.env.RN_SMTP_PORT ?? process.env.SMTP_PORT ?? 587),
      secure: String(process.env.BILLING_SMTP_SECURE ?? process.env.RN_SMTP_SECURE ?? 'false') === 'true',
      user, pass,
    });
  }
  return billingTransport;
}

export function getRnTransport(): Transporter | null {
  const host = process.env.RN_SMTP_HOST;
  const user = process.env.RN_SMTP_USER;
  const pass = process.env.RN_SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (!rnTransport) {
    rnTransport = buildTransport({
      host,
      port: Number(process.env.RN_SMTP_PORT ?? 587),
      secure: String(process.env.RN_SMTP_SECURE ?? 'false') === 'true',
      user, pass,
    });
  }
  return rnTransport;
}

export function resetTransports(): void {
  billingTransport = null;
  rnTransport = null;
}

export async function sendMail(opts: {
  from: string; replyTo?: string; to: string; cc?: string[]; bcc?: string[];
  subject: string; html: string; attachments?: MailAttachment[];
  transport?: Transporter;
}): Promise<{ messageId: string }> {
  const t = opts.transport ?? getBillingTransport();
  if (!t) throw new Error('SMTP not configured — set BILLING_SMTP_HOST/BILLING_SMTP_USER/BILLING_SMTP_PASS (or RN_SMTP_*)');
  const info = await t.sendMail({
    from: opts.from,
    to: opts.to,
    cc: opts.cc?.length ? opts.cc.join(', ') : undefined,
    bcc: opts.bcc?.length ? opts.bcc.join(', ') : undefined,
    replyTo: opts.replyTo,
    subject: opts.subject,
    html: opts.html,
    attachments: (opts.attachments ?? []).map((a) => ({
      filename: a.filename, content: a.content, contentType: a.contentType ?? 'application/pdf',
    })),
  }) as { messageId?: string };
  return { messageId: info.messageId ?? '' };
}

export async function sendRnMailWithFallback(opts: {
  to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: MailAttachment[];
}): Promise<void> {
  const t = getRnTransport();
  if (!t) throw new Error('rate-notification SMTP not configured (RN_SMTP_HOST/RN_SMTP_USER/RN_SMTP_PASS)');
  try {
    await t.sendMail({
      from: '"8xtel Rate Notification" <rates@8xtel.com>',
      to: opts.to,
      cc: opts.cc?.length ? opts.cc.join(', ') : undefined,
      bcc: opts.bcc?.length ? opts.bcc.join(', ') : undefined,
      replyTo: 'rates@8xtel.com',
      subject: opts.subject,
      html: opts.html,
      attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
    });
  } catch (e) {
    const mode = (process.env.RN_MAIL_MODE ?? 'auto').toLowerCase();
    if (mode === 'smtp') throw e;
    console.warn(`[rn] smtp failed (${(e as Error).message}) — trying roundcube webmail`);
    await sendViaRoundcube(opts);
    console.log('[rn] sent via roundcube webmail fallback');
  }
}

async function sendViaRoundcube(opts: { to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: MailAttachment[] }): Promise<void> {
  const base = (process.env.RN_WEBMAIL_BASE ?? 'https://nvme05.netcloudns.com:2096').replace(/\/$/, '');
  const user = process.env.RN_SMTP_USER ?? 'rates@8xtel.com';
  const pass = process.env.RN_SMTP_PASS;
  if (!pass) throw new Error('roundcube fallback needs RN_SMTP_PASS');
  const jar: string[] = [];
  const req = async (url: string, init?: RequestInit): Promise<{ text: string; headers: Headers }> => {
    const res = await fetch(url, { ...init, redirect: 'manual', headers: { ...(init?.headers ?? {} as Record<string,string>), ...(jar.length ? { cookie: jar.join('; ') } : {}) } });
    for (const c of res.headers.getSetCookie()) jar.push(c.split(';')[0]!);
    return { text: await res.text(), headers: res.headers };
  };
  const login = await req(`${base}/login/?login_only=1`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}` });
  const sess = login.text.match(/\/cpsess\d+/)?.[0];
  if (!sess) throw new Error(`roundcube login failed: ${login.text.slice(0, 120)}`);
  const rc = `${base}${sess}/3rdparty/roundcube`;
  await req(`${rc}/index.php?login=1&post_login=1`);
  const token = (await req(`${rc}/?_task=mail`)).text.match(/"request_token":"([a-zA-Z0-9]+)"/)?.[1];
  if (!token) throw new Error('roundcube token not found');
  const comp = (await req(`${rc}/?_task=mail&_action=compose`)).text;
  const cid = comp.match(/"compose_id":"([^"]+)"/)?.[1];
  if (!cid) throw new Error('roundcube compose id not found');
  const body = new URLSearchParams({ _task: 'mail', _action: 'send', _id: cid, _token: token, _from: '2', _to: [opts.to, ...(opts.cc ?? [])].join(', '), _bcc: (opts.bcc ?? []).join(', '), _subject: opts.subject, _message: `Rate notification — please view this email in an HTML-capable client.\n\n${opts.html.replace(/<[^>]*>/g, ' ')}` });
  const send = await req(`${rc}/?_task=mail&_action=send`, { method: 'POST', body });
  if (!/Message sent/i.test(send.text)) throw new Error(`roundcube send failed: ${send.text.replace(/<[^>]*>/g, ' ').slice(0, 200)}`);
}
