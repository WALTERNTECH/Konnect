import { env } from "../config/env.js";

// Africa's Talking bulk SMS. Without credentials the message is written to the log,
// which is how codes reach a developer before the account exists.

export const smsConfigured = () => Boolean(env.sms.username && env.sms.apiKey);

export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!smsConfigured()) {
    console.log(`[sms:log] to ${to}: ${message}`);
    return false;
  }
  const host = env.sms.username === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  const form = new URLSearchParams({ username: env.sms.username, to, message });
  if (env.sms.senderId) form.set("from", env.sms.senderId);
  try {
    const r = await fetch(`${host}/version1/messaging`, {
      method: "POST",
      headers: { apiKey: env.sms.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) console.error(`[sms] ${r.status} sending to ${to}`);
    return r.ok;
  } catch (e) {
    console.error("[sms] failed", (e as Error).message);
    return false;
  }
}
