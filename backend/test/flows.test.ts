import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

// End-to-end flows against an in-process Postgres: sign-up, booking and paying for a stay,
// membership, Connect matching and messaging, admin sign-in with an authenticator code.

process.env.NODE_ENV = "test";
process.env.SAMPLE_CONTENT = "on";
process.env.MPESA_DRIVER = "simulated";
process.env.MPESA_SIM_DELAY_MS = "50";
process.env.ADMIN_SETUP_TOKEN = "test-setup";
process.env.PHONE_VERIFICATION = "off";

const { pgliteDb, setDb } = await import("../src/config/db.js");
const { migrate } = await import("../src/migrate.js");
const { seedSamples } = await import("../src/seed.js");
const { initPayments } = await import("../src/services/payments.js");
const { createApp } = await import("../src/app.js");
const { runJobsOnce } = await import("../src/jobs.js");
const { totpAt } = await import("../src/utils/security.js");
const { addDays, todayEAT } = await import("../src/utils/kenya.js");

let base = "";
let close: () => void;

before(async () => {
  const db = await pgliteDb();
  setDb(db);
  await migrate(db);
  await seedSamples(db);
  initPayments();
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

async function signup(n: number, gender: "woman" | "man", dob = "1994-05-12") {
  const r = await call("POST", "/api/auth/signup", {
    fullName: `Member ${n} Test`, email: `member${n}@example.com`, phone: `07120000${String(n).padStart(2, "0")}`, password: "correct horse battery", dateOfBirth: dob, gender,
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

describe("Konnect", () => {
  let ann = "", ben = "";

  it("rejects under-18 sign-ups and accepts adults", async () => {
    const young = await call("POST", "/api/auth/signup", {
      fullName: "Too Young", email: "young@example.com", phone: "0712999999", password: "correct horse battery", dateOfBirth: `${new Date().getFullYear() - 17}-01-01`, gender: "woman",
    });
    assert.equal(young.status, 400);
    ann = await signup(1, "woman");
    ben = await signup(2, "man", "1988-02-02");
    const me = await call("GET", "/api/users/me", undefined, ann);
    assert.equal(me.body.user.phone, "+254712000001");
    assert.equal(me.body.user.premium.active, false);
  });

  it("logs in with phone or email", async () => {
    const a = await call("POST", "/api/auth/login", { identifier: "0712 000 001", password: "correct horse battery" });
    assert.equal(a.status, 200);
    const b = await call("POST", "/api/auth/login", { identifier: "member1@example.com", password: "wrong" });
    assert.equal(b.status, 401);
  });

  it("lists sample stays and books one through M-Pesa", async () => {
    const list = await call("GET", "/api/listings?type=STAY");
    assert.ok(list.body.total >= 10);
    const stay = list.body.items.find((l: { title: string }) => l.title === "Light-filled one-bedroom");
    const checkIn = addDays(todayEAT(), 10);
    const created = await call("POST", "/api/bookings", { listingId: stay.id, checkIn, checkOut: addDays(checkIn, 3), guests: 2 }, ann);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.booking.price.total, 6500 * 3 + 200);

    // The same nights can't be taken while the first booking holds them.
    const clash = await call("POST", "/api/bookings", { listingId: stay.id, checkIn: addDays(checkIn, 1), checkOut: addDays(checkIn, 2), guests: 1 }, ben);
    assert.equal(clash.status, 409);

    const pay = await payAndWait(ann, { purpose: "BOOKING", refId: created.body.booking.id, phone: "0712000001" });
    assert.equal(pay.status, "SUCCESS");
    const b = await call("GET", `/api/bookings/${created.body.booking.id}`, undefined, ann);
    assert.equal(b.body.booking.status, "CONFIRMED");
    const avail = await call("GET", `/api/listings/${stay.id}/availability?from=${checkIn}&to=${addDays(checkIn, 5)}`);
    assert.deepEqual(avail.body.unavailable, [checkIn, addDays(checkIn, 1), addDays(checkIn, 2)]);
  });

  it("books a wellness slot with a deposit", async () => {
    const list = await call("GET", "/api/listings?type=WELLNESS&category=massage");
    const l = list.body.items.find((x: { title: string }) => x.title === "Deep tissue massage");
    const day = addDays(todayEAT(), 3);
    const slots = await call("GET", `/api/listings/${l.id}/slots?date=${day}`);
    assert.ok(slots.body.slots.length > 5);
    const r = await call("POST", "/api/bookings", { listingId: l.id, startsAt: slots.body.slots[0], serviceMode: "studio", payMode: "deposit" }, ben);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.booking.price.dueNow, Math.ceil(4500 * 0.3) + 200);
    const after = await call("GET", `/api/listings/${l.id}/slots?date=${day}`);
    assert.ok(!after.body.slots.includes(slots.body.slots[0]));
  });

  it("keeps Connect behind membership, then matches and messages", async () => {
    const locked = await call("GET", "/api/connect/browse", undefined, ann);
    assert.equal(locked.status, 403);
    assert.equal(locked.body.error.code, "premium_required");

    for (const [t, interestedIn] of [[ann, ["man"]], [ben, ["woman"]]] as const) {
      const p = await call("PUT", "/api/connect/profile", { intent: "dating", interestedIn, ageMin: 21, ageMax: 50, interests: ["Travel"], headline: "Hello" }, t);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const pay = await payAndWait(t, { purpose: "SUBSCRIPTION", period: "monthly", phone: "0712000001" });
      assert.equal(pay.status, "SUCCESS");
    }
    const me = await call("GET", "/api/users/me", undefined, ann);
    assert.equal(me.body.user.premium.active, true);

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

    // Blocking ends the conversation for both.
    await call("POST", `/api/safety/block/${benCard.userId}`, {}, ann);
    const after = await call("POST", `/api/messages/${like2.body.matchId}`, { content: "Still there?" }, ben);
    assert.equal(after.status, 403);
  });

  it("hides partner placements from members", async () => {
    const free = await call("GET", "/api/ads/serve");
    assert.ok(free.body.ad);
    const member = await call("GET", "/api/ads/serve", undefined, ann);
    assert.equal(member.body.ad, null);
  });

  it("sets up an admin with an authenticator and approves a listing", async () => {
    const setup = await call("POST", "/api/admin/setup", { token: "test-setup", name: "Owner", email: "owner@example.com", password: "a long admin password" });
    assert.equal(setup.status, 201);
    const secret = setup.body.enrol.secret as string;
    const noMfa = await call("GET", "/api/admin/overview", undefined, setup.body.token);
    assert.equal(noMfa.status, 401);
    const code = totpAt(secret, Math.floor(Date.now() / 30_000));
    const full = await call("POST", "/api/admin/totp", { code }, setup.body.token);
    assert.equal(full.status, 200);
    const admin = full.body.token as string;
    const again = await call("POST", "/api/admin/setup", { token: "test-setup", name: "Xavier", email: "x@example.com", password: "another long password" });
    assert.equal(again.status, 409);

    const draft = await call(
      "POST",
      "/api/listings",
      { type: "WELLNESS", title: "Reflexology at home", city: "Nairobi", neighbourhood: "Kilimani", priceKes: 3000, category: "massage", durationMin: 60, serviceModes: ["home"], hours: { "1": ["09:00", "17:00"] } },
      ben,
    );
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const ov = await call("GET", "/api/admin/overview", undefined, admin);
    assert.equal(ov.status, 200);
    assert.ok(ov.body.revenue.subscriptions >= 999 * 2);
    const ok = await call("POST", `/api/admin/listings/${draft.body.id}/action`, { action: "approve" }, admin);
    assert.equal(ok.status, 200);
    const pub = await call("GET", `/api/listings/${draft.body.id}`);
    assert.equal(pub.status, 200);
    const csv = await fetch(`${base}/api/admin/payments.csv`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.match(await csv.text(), /SUBSCRIPTION/);
  });

  it("runs the minute jobs without error", async () => {
    await runJobsOnce();
  });
});
