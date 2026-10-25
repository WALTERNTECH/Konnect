# Konnect

Stays, wellness and introductions across Kenya, paid by M-Pesa. A web app built from the Pamoja product requirements and the Konnect technical architecture.

- **Stays** — hosts list apartments, cottages and villas booked by the night, with a calendar, and can mark a stay occupied until the current guest checks out. Guests see "Available now" or when it's free, and those nights can't be booked.
- **Wellness** — massage, physiotherapy, beauty and spa sessions at a studio or at home, booked into open time slots, paid in full or with a deposit.
- **Payments and payouts** — the guest pays the listing price by M-Pesa STK. As soon as Safaricom confirms it, Konnect keeps 15% and sends the other 85% to the host's payout number by M-Pesa B2C. The payout number is set at sign-up (the account phone unless the host gives another) and can only be changed with the password.
- **Connect** — profiles, likes, matches and messaging for signed-in adults, with block, report, meetup sharing and SOS.
- **Hosting** — listing editor, availability and calendar, bookings, earnings and payouts, and paid featuring.
- **Advertising** — self-serve partner placements (CPM or CPC) between listings.
- **Admin console** at `/admin` — password plus authenticator code; income and bookings, users, listing approval, verification documents, reports, SOS, payments with CSV export and refunds, the payout queue (send again, or record a payout made by hand), ads, the commission rate, team roles and an audit log.

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

Without `DATABASE_URL` the API uses an embedded Postgres in `.local/pglite`. Payments and payouts are simulated, so every M-Pesa prompt confirms itself after a few seconds and the host's share is marked sent. The first admin is created at http://localhost:5173/admin with the setup token `local-setup`.

```bash
npm test
```

runs the end-to-end flows: sign-up and the 18+ rule, the payout number, booking and paying for a stay with the 15/85 split and the automatic payout, wellness deposits, occupancy, Connect matching and messaging, blocking, and admin sign-in with an authenticator code.

## Database

Konnect has its own schema, `konnect`, inside the Fpesa Supabase project (`mrsxvdxaoogamhkdqejp`), owned by the role `konnect_api`. That role has no rights on Fpesa's tables or functions, and the server applies its own migrations at boot (`backend/src/migrations.ts`). Row level security is on for every table with no policies, so Supabase's `anon` and `authenticated` roles see nothing.

## Taking real money

See `backend/.env.example`.

1. **Collecting (STK Push):** set `MPESA_DRIVER=daraja`, `MPESA_ENV=production`, the Daraja consumer key and secret, the shortcode and passkey (and `MPESA_TILL` for a Buy Goods till). The callback URL is `PUBLIC_URL/api/mpesa/callback/<MPESA_CALLBACK_TOKEN>`; Daraja signs nothing, so a reported success is confirmed with an STK status query before a booking is released.
2. **Paying hosts (B2C):** set `MPESA_B2C_SHORTCODE`, `MPESA_B2C_INITIATOR` and `MPESA_B2C_SECURITY_CREDENTIAL` (the initiator password encrypted with Safaricom's certificate; the Daraja portal generates it). Results arrive at `PUBLIC_URL/api/mpesa/b2c/result/<MPESA_CALLBACK_TOKEN>`. B2C pays out of the B2C shortcode's own balance, so money collected on the Paybill or till has to be moved across to keep it funded. Until B2C is set up, payouts wait in Admin › Payouts to be sent by hand.

Sample listings can be booked only while payments are simulated; remove them from Admin › Settings once real hosts are live.
