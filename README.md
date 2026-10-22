# Konnect

Stays, wellness and introductions across Kenya, paid by M-Pesa. A web app built from the Pamoja product requirements and the Konnect technical architecture.

- **Stays** — apartments, cottages and villas booked by the night, with host calendars and a 30-minute hold while the guest pays.
- **Wellness** — massage, physiotherapy, beauty and spa sessions at a studio or at home, booked into open time slots, paid in full or with a deposit.
- **Connect** — members-only profiles, likes, matches and messaging, with block, report, meetup sharing and SOS.
- **Membership** — KES 999 a month or KES 8,999 a year by M-Pesa: Connect, no partner placements, priority for your listings. Referral codes add 30 days for both people.
- **Hosting** — listing editor, calendar, bookings, earnings and payouts, and paid featuring.
- **Advertising** — self-serve partner placements (CPM or CPC) shown only to people without a membership.
- **Admin console** at `/admin` — password plus authenticator code; overview and revenue, users, listing approval, verification documents, reports, SOS, bookings, payments with CSV export and refunds, payouts, ads, prices, team roles and an audit log.

## Layout

```
backend/    Express + TypeScript API (Postgres via pg; migrations run at boot)
frontend/   React + TypeScript + Vite single-page app (served by the API in production)
brand/      Logo, mark, app icon, share image and photo credits
```

The API serves the built frontend, so one Render web service runs everything.

## Running locally

```bash
npm install
```

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Without `DATABASE_URL` the API uses an embedded Postgres in `.local/pglite`. Payments are simulated, so every M-Pesa prompt confirms itself after a few seconds. The first admin is created at http://localhost:5173/admin with the setup token `local-setup`.

```bash
npm test
```

runs the end-to-end flows (sign-up and the 18+ rule, booking and paying for a stay, wellness deposits, membership-gated Connect, matching and messaging, blocking, partner placements, admin sign-in with an authenticator code).

## Database

Konnect has its own schema, `konnect`, inside the Fpesa Supabase project (`mrsxvdxaoogamhkdqejp`), owned by the role `konnect_api`. That role has no rights on Fpesa's tables or functions, and the server applies its own migrations at boot (`backend/src/migrations.ts`). Row level security is on for every table with no policies, so Supabase's `anon` and `authenticated` roles see nothing.

## Production settings

See `backend/.env.example`. To take real payments, set `MPESA_DRIVER=daraja`, `MPESA_ENV=production` and the Daraja credentials. The callback URL is `PUBLIC_URL/api/mpesa/callback/<MPESA_CALLBACK_TOKEN>`; Daraja signs nothing, so a reported success is confirmed with an STK status query before a booking or membership is released. Sample listings can be booked only while payments are simulated; remove them from Admin › Settings once real hosts are live.

Host payouts are recorded by the finance team in Admin › Payouts after sending them from the Konnect M-Pesa account.
