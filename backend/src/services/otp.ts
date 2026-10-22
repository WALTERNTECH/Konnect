import { db, one } from "../config/db.js";
import { HttpError } from "../utils/http.js";
import { sha256, sixDigits } from "../utils/security.js";
import { sendSms } from "../utils/sms.js";

// Six-digit codes sent by SMS: ten minutes to use, five tries, one send a minute.

type Purpose = "verify" | "reset" | "login";
const hash = (phone: string, code: string) => sha256(`${phone}:${code}`);

export async function sendCode(phone: string, purpose: Purpose) {
  const recent = await one(db(), `select 1 from otp_codes where phone = $1 and purpose = $2 and created_at > now() - interval '60 seconds'`, [phone, purpose]);
  if (recent) throw new HttpError(429, "too_soon", "A code was sent less than a minute ago");
  const code = sixDigits();
  await db().query(`insert into otp_codes (phone, purpose, code_hash, expires_at) values ($1, $2, $3, now() + interval '10 minutes')`, [phone, purpose, hash(phone, code)]);
  const what = purpose === "reset" ? "reset your password" : "confirm your number";
  await sendSms(phone, `${code} is your Konnect code to ${what}. It expires in 10 minutes.`);
}

export async function checkCode(phone: string, purpose: Purpose, code: string): Promise<boolean> {
  return db().tx(async (q) => {
    const row = await one<{ id: string; code_hash: string; attempts: number }>(
      q,
      `select id, code_hash, attempts from otp_codes where phone = $1 and purpose = $2 and used_at is null and expires_at > now() order by created_at desc limit 1 for update`,
      [phone, purpose],
    );
    if (!row || row.attempts >= 5) return false;
    if (row.code_hash !== hash(phone, code.trim())) {
      await q.query(`update otp_codes set attempts = attempts + 1 where id = $1`, [row.id]);
      return false;
    }
    await q.query(`update otp_codes set used_at = now() where id = $1`, [row.id]);
    return true;
  });
}
