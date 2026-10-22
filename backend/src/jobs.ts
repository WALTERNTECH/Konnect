import { db, many } from "./config/db.js";
import { notify } from "./services/notify.js";
import { reconcile } from "./services/payments.js";
import { todayEAT } from "./utils/kenya.js";

// Housekeeping that runs every minute: payment follow-up, booking lifecycle and reminders.

async function tick() {
  await reconcile();

  // Unpaid bookings release their dates after the 30-minute hold.
  await db().query(`update bookings set status = 'EXPIRED' where status = 'PENDING_PAYMENT' and created_at < now() - interval '30 minutes'`);

  // Stays complete on the check-out date, appointments when they end; then ask for a review.
  const done = await many<{ id: string; user_id: string; title: string }>(
    db(),
    `update bookings b set status = 'COMPLETED', completed_at = now() from listings l
      where l.id = b.listing_id and b.status = 'CONFIRMED'
        and ((b.kind = 'STAY' and b.check_out <= $1::date) or (b.kind = 'WELLNESS' and b.ends_at < now()))
      returning b.id, b.user_id, l.title`,
    [todayEAT()],
  );
  for (const b of done) await notify(b.user_id, { kind: "review", title: `How was ${b.title}?`, body: "Leave a rating for the next guest", link: `/trips/${b.id}` });

  // Appointment reminders two hours ahead, once.
  const soon = await many<{ id: string; user_id: string; title: string; starts_at: Date; ref: string }>(
    db(),
    `select b.id, b.user_id, l.title, b.starts_at, b.ref from bookings b join listings l on l.id = b.listing_id
      where b.status = 'CONFIRMED' and b.kind = 'WELLNESS' and b.starts_at between now() and now() + interval '2 hours'
        and not exists (select 1 from notifications n where n.user_id = b.user_id and n.kind = 'reminder' and n.link = '/trips/' || b.id)`,
  );
  for (const b of soon) {
    const at = new Date(b.starts_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
    await notify(b.user_id, { kind: "reminder", title: `${b.title} at ${at}`, body: `Reference ${b.ref}`, link: `/trips/${b.id}`, sms: `Konnect: reminder, ${b.title} today at ${at}. Ref ${b.ref}.` });
  }

  // Membership ending in three days, once per period.
  const ending = await many<{ user_id: string; expires_at: Date }>(
    db(),
    `select s.user_id, max(s.expires_at) as expires_at from subscriptions s where s.status = 'ACTIVE'
      group by s.user_id having max(s.expires_at) between now() + interval '2 days' and now() + interval '3 days'
        and not exists (select 1 from notifications n where n.user_id = s.user_id and n.kind = 'membership_ending' and n.created_at > now() - interval '5 days')`,
  );
  for (const s of ending)
    await notify(s.user_id, { kind: "membership_ending", title: "Your membership ends in 3 days", body: "Renew with M-Pesa to keep Connect", link: "/membership", sms: "Konnect: your membership ends in 3 days. Renew in the app with M-Pesa." });

  // Expired rows are marked, so history reads correctly.
  await db().query(`update subscriptions set status = 'EXPIRED' where status = 'ACTIVE' and expires_at < now()`);
  await db().query(`update ads set status = 'ENDED' where status = 'ACTIVE' and ends_at is not null and ends_at < now()`);
  await db().query(`delete from otp_codes where created_at < now() - interval '2 days'`);
}

let running = false;
export function startJobs() {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      console.error("[jobs]", e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5_000).unref();
  setInterval(run, 60_000).unref();
}

export const runJobsOnce = tick;
