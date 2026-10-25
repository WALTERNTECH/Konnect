import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

// End-to-end flows against an in-process Postgres: sign-up, booking and paying for a stay with
// the 15/85 split and the host's automatic payout, wellness deposits, occupancy, Connect matching
// and messaging, admin sign-in with an authenticator code.

process.env.NODE_ENV = "test";
process.env.SAMPLE_CONTENT = "on";
process.env.MPESA_DRIVER = "simulated";
process.env.MPESA_SIM_DELAY_MS = "50";
process.env.ADMIN_SETUP_TOKEN = "test-setup";
process.env.PHONE_VERIFICATION = "off";

const { pgliteDb, setDb, many } = await import("../src/config/db.js");
const { migrate } = await import("../src/migrate.js");
const { seedSamples } = await import("../src/seed.js");
const { initPayments } = await import("../src/services/payments.js");
const { initPayouts } = await import("../src/services/payouts.js");
const { createApp } = await import("../src/app.js");
const { runJobsOnce } = await import("../src/jobs.js");
const { totpAt } = await import("../src/utils/security.js");
const { addDays, todayEAT } = await import("../src/utils/kenya.js");

let base = "";
let close: () => void;
let db: Awaited<ReturnType<typeof pgliteDb>>;

before(async () => {
  db = await pgliteDb();
  setDb(db);
  await migrate(db);
  await seedSamples(db);
  initPayments();
  initPayouts();
  const server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

async function call(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signup(n: number, gender: "woman" | "man", extra: Record<string, string> = {}) {
  const r = await call("POST", "/api/auth/signup", {
    fullName: `Member ${n} Test`, email: `member${n}@example.com`, phone: `07120000${String(n).padStart(2, "0")}`, password: "correct horse battery", dateOfBirth: "1994-05-12", gender, ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token as string;
}

async function payAndWait(token: string, body: unknown) {
  const push = await call("POST", "/api/mpesa/stk-push", body, token);
  assert.equal(push.status, 202, JSON.stringify(push.body));
  for (let i = 0; i < 40; i++) {
    await wait(25);
    const p = await call("GET", `/api/mpesa/payments/${push.body.paymentId}`, undefined, token);
    if (p.body.payment.status !== "PENDING") return p.body.payment;
  }
  throw new Error("payment never settled");
}

async function payoutFor(bookingId: string, want = "PAID") {
  for (let i = 0; i < 40; i++) {
    const rows = await many<{ status: string; gross_kes: number; commission_kes: number; amount_kes: number; phone: string; reference: string | null }>(db, `select * from payouts where booking_id = $1`, [bookingId]);
    if (rows[0]?.status === want) return rows[0];
    await wait(25);
  }
  throw new Error(`payout never reached ${want}`);
}

describe("Konnect", () => {
  let ann = "", ben = "", admin = "", benListing = "";

  it("rejects under-18 sign-ups and keeps a payout number", async () => {
    const young = await call("POST", "/api/auth/signup", {
      fullName: "Too Young", email: "young@example.com", phone: "0712999999", password: "correct horse battery", dateOfBirth: `${new Date().getFullYear() - 17}-01-01`, gender: "woman",
    });
    assert.equal(young.status, 400);
    ann = await signup(1, "woman");
    ben = await signup(2, "man", { payoutPhone: "0722 000 222" });
    const a = await call("GET", "/api/users/me", undefined, ann);
    assert.equal(a.body.user.phone, "+254712000001");
    assert.equal(a.body.user.payoutPhone, "+254712000001");
    assert.equal(a.body.user.premium, undefined);
    const b = await call("GET", "/api/users/me", undefined, ben);
    assert.equal(b.body.user.payoutPhone, "+254722000222");
  });

  it("changes the payout number only with the password", async () => {
    const wrong = await call("POST", "/api/users/me/payout-phone", { phone: "0733000333", password: "nope" }, ben);
    assert.equal(wrong.status, 400);
    const ok = await call("POST", "/api/users/me/payout-phone", { phone: "0733000333", password: "correct horse battery" }, ben);
    assert.equal(ok.body.user.payoutPhone, "+254733000333");
  });

  it("logs in with phone or email", async () => {
    const a = await call("POST", "/api/auth/login", { identifier: "0712 000 001", password: "correct horse battery" });
    assert.equal(a.status, 200);
    const b = await call("POST", "/api/auth/login", { identifier: "member1@example.com", password: "wrong" });
    assert.equal(b.status, 401);
  });

  it("books a stay, takes 15% and sends the host 85% automatically", async () => {
    const list = await call("GET", "/api/listings?type=STAY");
    assert.ok(list.body.total >= 10);
    const stay = list.body.items.find((l: { title: string }) => l.title === "Light-filled one-bedroom");
    assert.equal(stay.availability.status, "available");
    const checkIn = addDays(todayEAT(), 10);
    const created = await call("POST", "/api/bookings", { listingId: stay.id, checkIn, checkOut: addDays(checkIn, 3), guests: 2 }, ann);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.booking.price.total, 6500 * 3);
    assert.equal(created.body.booking.price.dueNow, 6500 * 3);
    assert.equal(created.body.booking.price.commission, undefined); // the split isn't the guest's business

    const clash = await call("POST", "/api/bookings", { listingId: stay.id, checkIn: addDays(checkIn, 1), checkOut: addDays(checkIn, 2), guests: 1 }, ben);
    assert.equal(clash.status, 409);

    const pay = await payAndWait(ann, { purpose: "BOOKING", refId: created.body.booking.id, phone: "0712000001" });
    assert.equal(pay.status, "SUCCESS");
    const b = await call("GET", `/api/bookings/${created.body.booking.id}`, undefined, ann);
    assert.equal(b.body.booking.status, "CONFIRMED");

    const payout = await payoutFor(created.body.booking.id);
    assert.equal(payout.gross_kes, 19500);
    assert.equal(payout.commission_kes, 2925);
    assert.equal(payout.amount_kes, 16575);
    assert.equal(payout.phone, "+254700000000");
    assert.match(payout.reference ?? "", /^SIM/);
  });

  it("books a wellness slot with a deposit and splits the deposit", async () => {
    const list = await call("GET", "/api/listings?type=WELLNESS&category=massage");
    const l = list.body.items.find((x: { title: string }) => x.title === "Deep tissue massage");
    assert.equal(l.availability, null);
    const day = addDays(todayEAT(), 3);
    const slots = await call("GET", `/api/listings/${l.id}/slots?date=${day}`);
    assert.ok(slots.body.slots.length > 5);
    const r = await call("POST", "/api/bookings", { listingId: l.id, startsAt: slots.body.slots[0], serviceMode: "studio", payMode: "deposit" }, ben);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.booking.price.dueNow, Math.ceil(4500 * 0.3));
    assert.equal(r.body.booking.price.payLater, 4500 - Math.ceil(4500 * 0.3));
    await payAndWait(ben, { purpose: "BOOKING", refId: r.body.booking.id, phone: "0712000002" });
    const payout = await payoutFor(r.body.booking.id);
    assert.equal(payout.gross_kes, 1350);
    assert.equal(payout.amount_kes, 1350 - Math.round(1350 * 0.15));
  });

  it("opens Connect without any membership, then matches and messages", async () => {
    for (const [t, interestedIn] of [[ann, ["man"]], [ben, ["woman"]]] as const) {
      const p = await call("PUT", "/api/connect/profile", { intent: "dating", interestedIn, ageMin: 21, ageMax: 50, interests: ["Travel"], headline: "Hello" }, t);
      assert.equal(p.status, 200, JSON.stringify(p.body));
    }
    const browse = await call("GET", "/api/connect/browse", undefined, ann);
    assert.equal(browse.status, 200);
    const benCard = browse.body.items[0];
    assert.equal(benCard.name, "Member");
    assert.equal(benCard.phone, undefined);

    const like1 = await call("POST", `/api/connect/profiles/${benCard.userId}/like`, {}, ann);
    assert.equal(like1.body.matched, false);
    const annId = (await call("GET", "/api/users/me", undefined, ann)).body.user.id;
    const like2 = await call("POST", `/api/connect/profiles/${annId}/like`, {}, ben);
    assert.equal(like2.body.matched, true);

    const sent = await call("POST", `/api/messages/${like2.body.matchId}`, { content: "Hi Ann" }, ben);
    assert.equal(sent.status, 201);
    const thread = await call("GET", `/api/messages/${like2.body.matchId}`, undefined, ann);
    assert.equal(thread.body.items[0].content, "Hi Ann");

    await call("POST", `/api/safety/block/${benCard.userId}`, {}, ann);
    const after = await call("POST", `/api/messages/${like2.body.matchId}`, { content: "Still there?" }, ben);
    assert.equal(after.status, 403);
  });

  it("has no membership endpoints left", async () => {
    const r = await call("GET", "/api/subscriptions/plans");
    assert.equal(r.status, 404);
    const push = await call("POST", "/api/mpesa/stk-push", { purpose: "SUBSCRIPTION", period: "monthly", phone: "0712000001" }, ann);
    assert.equal(push.status, 400);
  });

  it("creates the one control-centre account and refuses a second", async () => {
    const before = await call("GET", "/api/admin/setup");
    assert.equal(before.body.needed, true);
    const badKey = await call("POST", "/api/admin/setup", { token: "wrong", email: "owner@example.com", password: "a long admin password" });
    assert.equal(badKey.status, 403);
    const setup = await call("POST", "/api/admin/setup", { token: "test-setup", email: "Owner@Example.com", password: "a long admin password" });
    assert.equal(setup.status, 201, JSON.stringify(setup.body));
    admin = setup.body.token;
    const me = await call("GET", "/api/admin/me", undefined, admin);
    assert.equal(me.body.admin.email, "owner@example.com");

    const again = await call("POST", "/api/admin/setup", { token: "test-setup", email: "x@example.com", password: "another long password" });
    assert.equal(again.status, 409);
    assert.equal((await call("GET", "/api/admin/setup")).body.needed, false);
    // Even straight into the database, a second account can't exist.
    await assert.rejects(db.query(`insert into admin_users (email, name, role, password_hash) values ('second@example.com', 'X', 'admin', 'x')`));
    assert.equal((await call("GET", "/api/admin/team", undefined, admin)).status, 404);

    const login = await call("POST", "/api/admin/login", { email: "owner@example.com", password: "a long admin password" });
    assert.equal(login.body.needsCode, false);
    const wrong = await call("POST", "/api/admin/login", { email: "owner@example.com", password: "nope" });
    assert.equal(wrong.status, 401);
  });

  it("lets the owner add an authenticator, and recover with the setup key", async () => {
    const start = await call("POST", "/api/admin/security/totp/start", {}, admin);
    const code = () => totpAt(start.body.secret, Math.floor(Date.now() / 30_000));
    const on = await call("POST", "/api/admin/security/totp/confirm", { code: code() }, admin);
    assert.equal(on.body.totpEnabled, true);
    const step1 = await call("POST", "/api/admin/login", { email: "owner@example.com", password: "a long admin password" });
    assert.equal(step1.body.needsCode, true);
    assert.equal((await call("GET", "/api/admin/overview", undefined, step1.body.token)).status, 401);
    const step2 = await call("POST", "/api/admin/totp", { code: code() }, step1.body.token);
    assert.equal(step2.status, 200);

    const rec = await call("POST", "/api/admin/recover", { token: "test-setup", password: "a brand new password" });
    assert.equal(rec.status, 200);
    assert.equal((await call("GET", "/api/admin/overview", undefined, admin)).status, 401); // old sessions end
    admin = rec.body.token;
    const after = await call("POST", "/api/admin/login", { email: "owner@example.com", password: "a brand new password" });
    assert.equal(after.body.needsCode, false); // recovery removes the authenticator
    admin = after.body.token;
  });

  it("approves a listing from the control centre", async () => {

    const draft = await call("POST", "/api/listings", { type: "STAY", title: "Quiet flat in Kileleshwa", city: "Nairobi", neighbourhood: "Kileleshwa", priceKes: 5000, bedrooms: 1, maxGuests: 2 }, ben);
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    benListing = draft.body.id;
    const ov = await call("GET", "/api/admin/overview", undefined, admin);
    assert.equal(ov.status, 200);
    assert.equal(ov.body.revenue.commission, 2925 + Math.round(1350 * 0.15));
    const ok = await call("POST", `/api/admin/listings/${benListing}/action`, { action: "approve" }, admin);
    assert.equal(ok.status, 200);
    const csv = await fetch(`${base}/api/admin/payments.csv`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.match(await csv.text(), /BOOKING/);
  });

  it("lets a host mark a stay occupied until check-out, which blocks those nights", async () => {
    const until = new Date(`${addDays(todayEAT(), 2)}T10:00:00+03:00`).toISOString();
    const notMine = await call("PUT", `/api/listings/${benListing}/occupancy`, { status: "occupied", until }, ann);
    assert.equal(notMine.status, 403);
    const past = await call("PUT", `/api/listings/${benListing}/occupancy`, { status: "occupied", until: new Date(Date.now() - 60_000).toISOString() }, ben);
    assert.equal(past.status, 400);
    const set = await call("PUT", `/api/listings/${benListing}/occupancy`, { status: "occupied", until }, ben);
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.listing.availability.status, "occupied");

    const avail = await call("GET", `/api/listings/${benListing}/availability?from=${todayEAT()}&to=${addDays(todayEAT(), 4)}`);
    // Tonight and tomorrow night are taken; the check-out day (10:00, before 14:00 check-in) is free.
    assert.deepEqual(avail.body.unavailable, [todayEAT(), addDays(todayEAT(), 1)]);
    const blocked = await call("POST", "/api/bookings", { listingId: benListing, checkIn: todayEAT(), checkOut: addDays(todayEAT(), 1) }, ann);
    assert.equal(blocked.status, 409);
    const free = await call("GET", "/api/listings?type=STAY&availableNow=true");
    assert.ok(!free.body.items.some((l: { id: string }) => l.id === benListing));

    const clear = await call("PUT", `/api/listings/${benListing}/occupancy`, { status: "available" }, ben);
    assert.equal(clear.body.listing.availability.status, "available");
  });

  it("controls the site: switches, edits and announcements", async () => {
    // Sign-ups and bookings off.
    await call("PUT", "/api/admin/settings", { signups_open: false, bookings_open: false, site_banner: "Back at 6pm" }, admin);
    await wait(10_050); // the settings cache
    const site = await call("GET", "/api/site");
    assert.equal(site.body.banner, "Back at 6pm");
    assert.equal(site.body.signupsOpen, false);
    const s = await call("POST", "/api/auth/signup", { fullName: "Late Comer", email: "late@example.com", phone: "0712000099", password: "correct horse battery", dateOfBirth: "1990-01-01", gender: "man" });
    assert.equal(s.status, 403);
    assert.equal(s.body.error.code, "signups_closed");
    const b = await call("POST", "/api/bookings", { listingId: benListing, checkIn: addDays(todayEAT(), 20), checkOut: addDays(todayEAT(), 21) }, ann);
    assert.equal(b.body.error.code, "bookings_closed");
    await call("PUT", "/api/admin/settings", { signups_open: true, bookings_open: true, site_banner: "" }, admin);

    // Edit a user and a listing.
    const users = await call("GET", "/api/admin/users?kind=hosts", undefined, admin);
    const benRow = users.body.items.find((u: { email: string }) => u.email === "member2@example.com");
    assert.ok(benRow);
    const edit = await call("PATCH", `/api/admin/users/${benRow.id}`, { payoutPhone: "0744000444", fullName: "Benson Test" }, admin);
    assert.equal(edit.status, 200);
    const me = await call("GET", "/api/users/me", undefined, ben);
    assert.equal(me.body.user.payoutPhone, "+254744000444");
    const lp = await call("PATCH", `/api/admin/listings/${benListing}`, { priceKes: 5500 }, admin);
    assert.equal(lp.status, 200);
    assert.equal((await call("GET", `/api/listings/${benListing}`)).body.listing.priceKes, 5500);

    // A message to all hosts lands in their notifications.
    const ann1 = await call("POST", "/api/admin/announcements", { audience: "hosts", title: "New payout times", body: "Payouts now go out instantly." }, admin);
    assert.equal(ann1.status, 201);
    assert.equal(ann1.body.recipients, 1);
    const notes = await call("GET", "/api/notifications", undefined, ben);
    assert.ok(notes.body.items.some((n: { title: string }) => n.title === "New payout times"));
    const annNotes = await call("GET", "/api/notifications", undefined, ann);
    assert.ok(!annNotes.body.items.some((n: { title: string }) => n.title === "New payout times"));
  });

  it("runs the minute jobs without error", async () => {
    await runJobsOnce();
  });
});
