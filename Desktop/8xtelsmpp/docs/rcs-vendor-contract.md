# RCS Vendor Contract

Provider posts JSON to our endpoint and receives webhooks back.

## 1. Send (us → provider)

`POST {endpoint}` — headers:

```
Authorization: Bearer <api_key>
Content-Type: application/json
Idempotency-Key: rcs:<messageId>:<billingCycle>
```

Body:

```json
{
  "from": "Brand",
  "to": "+919876543210",
  "content": { "type": "text", "text": "Hello" }
  // or { "type": "rich_card", "title": "Hi", "description": "...", "media_url": "https://...", "suggestions": [{ "type": "open_url", "text": "Open", "url": "https://..." }] }
  // or { "type": "carousel", "cards": [...] }
}
```

Response (2xx) must be JSON with one of:

```json
{ "message_id": "provider-123" }
{ "id": "provider-123" }
```

- `5xx` / `429` → retryable
- `401/403` → auth error
- other `4xx` → permanent failure (failover to next vendor)

Timeout defaults to `timeout_ms` on the vendor (500–60000).

## 2. Status webhook (provider → us)

`POST /rcs/webhooks/:vendorId` — headers:

```
Content-Type: application/json
x-rcs-signature: <hex hmac_sha256(JSON.stringify(body), webhook_secret)>
```

Body:

```json
{
  "message_id": "provider-123",
  "status": "delivered",
  "error_code": "OPTIONAL",
  "error": "optional description",
  "timestamp": "2026-10-02T00:00:00Z"
}
```

- `message_id` or `id` — must match the send response
- `status` — one of: `accepted|queued|submitted|delivered|read|undelivered|expired|rejected|failed` (case-insensitive; `read`→`delivered`, `not_delivered`→`undelivered`, `timeout`→`expired`, `invalid`→`rejected`)
- `event_id` — optional idempotency key for the webhook event (else hash of body)
- Duplicate `event_hash` (sha256 of body per vendor) is ignored (202 accepted duplicate)
- HMAC body is `JSON.stringify(body)` as received (exact JSON serialization matters)

## 3. Setup steps

1. Admin → RCS → Vendors → + Vendor
   - Name: e.g. "My RCS Provider"
   - Endpoint: `https://provider.example.com/rcs/send`
   - Credential: `api_key`
   - Webhook secret: shared secret for HMAC
   - Status: `enabled`
2. Admin → RCS → Routes → + Route (country/sender/strategy) → assign vendor (priority/weight) → assign clients
3. Admin → RCS → Clients → enable RCS per client
4. Admin → RCS → Rates → add per-client country price
5. Admin → RCS → Senders → add approved sender
6. Webhook wiring: provider must call `POST https://{PANEL_HOST}/rcs/webhooks/{vendorId}` with the header + body above

## 4. SMPP

- Clients with `rcs_enabled=true` and an approved RCS sender + active allocated route + rate + wallet balance can submit RCS over SMPP `submit_sm` (port 2775).
- SMPP RCS is text-only: `short_message` becomes `{type:"text", text}`.
- If wallet/rate/sender check fails, SMPP falls back to SMS (no error to the bind).
- DLR for RCS is webhook-only in v1; SMPP `deliver_sm` for RCS not emitted.

## 5. Test

- Admin → RCS → `POST /rcs/test-send` — hits provider live and returns `provider_message_id`.
- Portal → Send RCS → single `+9198…` → 202 → history → webhook flips to `delivered`.
