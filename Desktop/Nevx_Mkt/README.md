# NEVX — Where Needs Meet Offers

A needs-and-offers marketplace with **admin-mediated deals**. Buyers and sellers
never contact each other directly — every deal flows through **Buyer → NEVX Admin → Seller**.

Messenger-style UI (Telegram + WhatsApp feel): left sidebar, center feed,
right contextual panel, bottom nav on mobile.

## Quick start

```bash
npm install
npm run dev     # → http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

No external database needed — data persists to `data/nevx-db.json`
(auto-created with seed data on first run).

Optional env:

```bash
NEVX_SECRET=your-long-random-secret
```

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| 👤 User | `priya@example.com` | `password123` |
| 🛡️ Admin | `admin@nevx.io` | `admin123` |

More demo users: `rahul@`, `sophia@`, `liam@`, `anna@`, `omar@`, `diego@`, `mei@` + `@example.com` / `password123`.

## Core flows

**Post a need** → Home feed → *I need something* → sellers click **Apply**
(application goes to admin only) → admin approves → **Create deal**
→ admin chats with buyer & seller separately → payment → delivery → completed.

**Sell / offer** → Home feed → *Sell / Offer* tab → post offer → buyers post
matching needs → same mediated flow.

## Key rules (enforced in API)

- No buyer↔seller chat, ever. Deal chat is split into `buyer` / `seller` sides.
- Parties see only first name + country of the counterparty. No emails, no hashes, no telegram.
- Only admins can view applications across users, create deals, and change deal status.
- Suspended/banned users cannot log in.

## Structure

```text
app/
  page.tsx            landing page
  (auth)/login|register
  app/                user marketplace (feed, requests, offers, applications,
                      deals, deal chat, notifications, profile, settings)
  admin/              dashboard, applications, deals (+ dual chat),
                      needs & offers, users, groups, categories, reports
  api/                auth, needs, offers, applications, deals, messages,
                      notifications, reports, meta, mine, admin/*
components/           ui.tsx, cards.tsx, forms.tsx
lib/                  types.ts, db.ts (JSON store), seed.ts (demo data),
                      auth.ts (bcrypt + JWT cookie), utils.ts
```

## Tech

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · bcryptjs · jose (JWT)
