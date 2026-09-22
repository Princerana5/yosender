import { useState } from 'react';
import { PageHeader } from '../components';

interface Section {
  id: string;
  title: string;
  body: JSX.Element;
}

function Code({ children }: { children: string }): JSX.Element {
  return (
    <pre className="text-xs font-mono bg-ink border border-line rounded-lg p-3 overflow-x-auto whitespace-pre">
      {children}
    </pre>
  );
}

function P({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-sm text-gray-300 leading-relaxed">{children}</p>;
}

function Li({ children }: { children: React.ReactNode }): JSX.Element {
  return <li className="text-sm text-gray-300 leading-relaxed list-disc ml-5">{children}</li>;
}

const SECTIONS: Section[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <div className="space-y-2">
        <P>
          8xtelSMPP sits between your clients (downstream) and your upstream vendors.
          Clients submit messages to you over SMPP or HTTPS; you route them to the
          best vendor, collect delivery reports (DLRs), and push results back to the client.
        </P>
        <Code>{`CLIENTS ──SMPP :2775 / HTTPS──▶  8xtelSMPP  ──SMPP / HTTPS──▶ VENDORS\n                                   │  routing → vendor → DLR → billing\n                                   ▼\n                          panel + live traffic + reports`}</Code>
      </div>
    ),
  },
  {
    id: 'client-smpp',
    title: 'Clients — SMPP bind',
    body: (
      <div className="space-y-2">
        <P>Give each client: host (your server IP/domain), port 2775 (or 443 if their firewall blocks 2775), system_id + password (Clients page), and ask them to whitelist-bind.</P>
        <ul className="space-y-1">
          <Li>Supported binds: <span className="font-mono">transceiver</span> (recommended — send + receive DLRs on one bind), <span className="font-mono">transmitter</span> (send only), <span className="font-mono">receiver</span> (DLRs only).</Li>
          <Li>A bind is accepted only if: correct credentials, source IP whitelisted (if any IPs configured), account <span className="font-mono">active</span>, balance + credit &gt; 0.</Li>
          <Li>Over-limit submits get <span className="font-mono">ESME_RTHROTTLED (0x58)</span> — messages queue, never drop. Receiver-only binds get <span className="font-mono">ESME_RINVBNDSTS</span> on submit.</Li>
          <Li>Hold 2–4 binds per client at high TPS — DLRs round-robin across their receiver/transceiver binds.</Li>
          <Li><span className="font-mono">enquire_link</span> is answered automatically; keep-alive every ~30s keeps NAT/firewall sessions alive.</Li>
        </ul>
        <P>DLRs arrive as <span className="font-mono">deliver_sm</span> with <span className="font-mono">esm_class=4</span>:</P>
        <Code>{`id:<message-id> sub:001 dlvrd:001 submit date:2509151430 done date:2509151432 stat:DELIVRD err:000 text:`}</Code>
      </div>
    ),
  },
  {
    id: 'client-http',
    title: 'Clients — HTTP API',
    body: (
      <div className="space-y-2">
        <P>Clients that can't do SMPP use the HTTP API (Downstream → HTTP API page to issue keys). Auth: <span className="font-mono">Authorization: Bearer &lt;key&gt;</span> or <span className="font-mono">?api_key=</span>.</P>
        <Code>{`POST /api/client/v1/send
{"from":"SENDER","to":"919876543210","text":"Hello","dlr_url":"https://client.com/dlr"}

POST /api/client/v1/send-bulk        # up to 5000 (to: array or comma-list)
GET  /api/client/v1/status/:id       # delivery status
GET  /api/client/v1/balance          # wallet`}</Code>
        <ul className="space-y-1">
          <Li>Same guards as SMPP: active account, balance, TPS (HTTP 429 when over — retry in a second), blocked sender IDs.</Li>
          <Li>DLRs: set the client's callback URL (Clients → edit) or pass <span className="font-mono">dlr_url</span> per request — we POST <span className="font-mono">{`{message_id, status, ts}`}</span> on every status change.</Li>
          <Li>Self-serve docs: clients fetch <span className="font-mono">GET /api/client/v1/docs?format=markdown</span> with their own API key — endpoints + samples, no panel login needed.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: 'vendor-smpp',
    title: 'Vendors — SMPP',
    body: (
      <div className="space-y-2">
        <P>Vendors → Add vendor → <span className="font-mono">SMPP bind</span>. Configure host, port, system_id, password (encrypted at rest, never logged), bind type, TON/NPI, TPS cap, and connection count (parallel binds — e.g. 10 for a 1000-TPS vendor).</P>
        <ul className="space-y-1">
          <Li>Bind states (live in the panel): <span className="font-mono">connected · connecting · reconnecting · disconnected · error</span>. Auto-reconnect with exponential backoff (max ~2 min).</Li>
          <Li>Submits spread randomly across connected binds; a stalled bind (no response in 10s) fails over to the next vendor in the chain.</Li>
          <Li>Vendor DLRs arrive as <span className="font-mono">deliver_sm</span> → parsed (<span className="font-mono">id:</span>/<span className="font-mono">stat:</span>) → stored immutably → client status derived → pushed to the client.</Li>
          <Li>Common bind rejections: <span className="font-mono">status=13 (EBINDFAIL)</span> — vendor refused (too many binds, bad creds, or stale sessions on their side after our restart; usually clears as their session table times out).</Li>
        </ul>
      </div>
    ),
  },
  {
    id: 'vendor-http',
    title: 'Vendors — HTTP API',
    body: (
      <div className="space-y-2">
        <P>Vendors → Add vendor → <span className="font-mono">HTTP API</span>, then Edit → HTTP send config. No SMPP bind is opened — one HTTPS request per message.</P>
        <ul className="space-y-1">
          <Li><b>Send URL template</b> with placeholders: <span className="font-mono">{`{to} {from} {text} {msg_id} {dlr_url}`}</span>. GET appends as query; POST sends the body template as JSON.</Li>
          <Li><b>Headers</b> (JSON, encrypted): e.g. <span className="font-mono">{`{"Authorization":"Bearer xxx"}`}</span>.</Li>
          <Li><b>Message-ID path</b>: dot path to their id in the JSON response (e.g. <span className="font-mono">data.id</span>) for DLR correlation.</Li>
          <Li><b>Inbound DLR webhook</b>: generate a token, give the URL to the vendor — they POST <span className="font-mono">{`{message_id, status}`}</span> and DLRs flow through the normal pipeline.</Li>
          <Li>HTTP vendors sit in the same route chains as SMPP ones — failover walks across both transports.</Li>
        </ul>
      </div>
    ),
  },
  {
    id: 'routing',
    title: 'Routing & failover',
    body: (
      <div className="space-y-2">
        <P>Routes match by client → country/prefix → sender, longest prefix wins. Strategies: <span className="font-mono">priority · failover · round_robin · least_cost · percentage</span>.</P>
        <ul className="space-y-1">
          <Li>Each route carries an ordered vendor chain. On submit failure the message fails over to the next vendor automatically; exhausted chain → <span className="font-mono">failed</span> + hold released (no charge).</Li>
          <Li>Per-client, per-route and per-vendor TPS guards pace traffic — excess queues with delay, never dropped.</Li>
          <Li>Pricing: route price/segment wins, else client rate card. Funds are held at submit and settled on DLR (delivered → charged; otherwise → refunded).</Li>
        </ul>
      </div>
    ),
  },
  {
    id: 'statuses',
    title: 'Message & DLR statuses',
    body: (
      <div className="space-y-2">
        <P>Message lifecycle: <span className="font-mono">submitted → delivered / undelivered / expired / rejected / failed</span>. <span className="font-mono">submitted</span> means accepted by the vendor, DLR pending — not stuck.</P>
        <P>Vendor DLR mapping:</P>
        <Code>{`DELIVRD → delivered      UNDELIV → undelivered\nEXPIRED → expired        REJECTD → rejected\nFAILED  → failed         ACCEPTD/ENROUTE → submitted (still in flight)`}</Code>
        <P>Raw vendor DLRs are stored immutably; traffic policies only derive the client-visible status (panel DLR Logs shows both).</P>
      </div>
    ),
  },
  {
    id: 'billing-modes',
    title: 'Billing modes',
    body: (
      <div className="space-y-2">
        <P>Billing Mode defines <b>when</b> a client is charged — set per client → country → network/MCC/MNC in Rate Notifications (destinations prefill from the client's saved rate card). Default: <span className="font-mono">On Submission</span>.</P>
        <Code>{`On Submission              SUBMITTED            charge at vendor accept (default)
On Delivery Only           DELIVERED            charge only on delivered DLR; failures cost nothing
Submission + Delivery      SUBMITTED+DELIVERED  split: submission rate now + delivery rate on DLR
Operator Submission        OPERATOR_SUBMITTED   charge when the operator accepts
Operator Delivery          OPERATOR_DELIVERED   charge only on operator-confirmed delivery
Hybrid                     OP_SUBMITTED+OP_DEL  base fee on accept + extra on delivery
On Attempt                 ROUTE_ATTEMPT        charge when 8xtel attempts the route
On Accepted                ACCEPTED             charge at platform accept (post-validation)`}</Code>
        <P>Failed / expired / rejected messages bill nothing under delivery-only modes (<span className="font-mono">billing_status=not_billed</span>). Duplicate DLRs never double-charge — one ledger row per message per component (<span className="font-mono">billing_charges</span> PK). Message Logs, DLR Logs, Live Traffic and Client Reports all show the mode + billed amount, and reports filter by both.</P>
      </div>
    ),
  },
  {
    id: 'faq',
    title: 'Troubleshooting',
    body: (
      <div className="space-y-2">
        <ul className="space-y-1">
          <Li><b>Client shows fewer DLRs than our panel:</b> their panel may count accepts (<span className="font-mono">submit_sm_resp</span>) as delivered — ask them to count <span className="font-mono">stat:DELIVRD</span> receipts. Also check they hold receiver/transceiver binds and read fast.</Li>
          <Li><b>All messages stuck on submitted:</b> check vendor binds are <span className="font-mono">connected</span> and queues are draining (all zero = waiting on vendor DLRs, not us). Ask the vendor with sample message IDs.</Li>
          <Li><b>Bind rejected status=13 after our restart:</b> vendor's session table still holds our old sockets — clears on its own; binds reconnect with backoff.</Li>
          <Li><b>THROTTLED responses:</b> client over their TPS limit — raise it (Clients → edit) or they slow down. Queued server-side either way.</Li>
        </ul>
      </div>
    ),
  },
];

export default function Docs(): JSX.Element {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Documentation"
        sub="How this gateway works — binds, routing, DLRs, APIs"
      />
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${active === s.id
              ? 'border-brand/50 bg-brand/10 text-emerald-300'
              : 'border-line text-muted hover:text-white'}`}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div className="card card-pad">
        <div className="card-title mb-3">{section.title}</div>
        {section.body}
      </div>
    </div>
  );
}
