// Every setting the server reads, in one place. Secrets come from the environment
// only; nothing here has a usable default in production.

export type Env = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  /** Public origin of this deployment, used for M-Pesa callbacks and links in SMS. */
  publicUrl: string;
  corsOrigin: string[];
  databaseUrl: string | null;
  jwtSecret: string;
  jwtExpiresIn: string;
  /** 32-byte key that encrypts admin TOTP secrets at rest. */
  masterKey: Buffer;
  /** Lets the first admin account be created at /admin/setup while none exists. */
  adminSetupToken: string | null;
  mpesa: {
    /** "daraja" talks to Safaricom; "simulated" confirms every prompt after a few seconds. */
    driver: "daraja" | "simulated";
    env: "sandbox" | "production";
    consumerKey: string;
    consumerSecret: string;
    shortcode: string;
    passkey: string;
    /** Buy Goods till, when the shortcode is a store number rather than a Paybill. */
    till: string;
    /** Secret path segment on the callback URL; Daraja signs nothing. */
    callbackToken: string;
  };
  sms: { username: string; apiKey: string; senderId: string };
  cloudinaryUrl: string | null;
  /** Ask for a code sent by SMS before an account is active. Defaults to on when SMS is configured. */
  phoneVerification: boolean;
  /** Seed and show the sample stays and wellness listings. */
  sampleContent: boolean;
  /** Built frontend to serve, if present. */
  webDist: string | null;
};

function masterKey(raw: string | undefined, env: Env["nodeEnv"]): Buffer {
  if (raw) {
    const b = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (b.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (64 hex chars or base64)");
    return b;
  }
  if (env === "production") throw new Error("MASTER_KEY is required in production");
  return Buffer.alloc(32, 7);
}

export function loadEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = (e.NODE_ENV === "production" ? "production" : e.NODE_ENV === "test" ? "test" : "development") as Env["nodeEnv"];
  const on = (v: string | undefined, dflt: boolean) => (v == null || v === "" ? dflt : /^(1|true|on|yes)$/i.test(v));
  const smsConfigured = Boolean(e.AT_USERNAME && e.AT_API_KEY);
  const darajaConfigured = Boolean(e.MPESA_CONSUMER_KEY && e.MPESA_CONSUMER_SECRET && e.MPESA_PASSKEY);
  const publicUrl = (e.PUBLIC_URL ?? e.RENDER_EXTERNAL_URL ?? `http://localhost:${e.PORT ?? 4000}`).replace(/\/$/, "");

  const env: Env = {
    nodeEnv,
    port: Number(e.PORT ?? 4000),
    publicUrl,
    corsOrigin: (e.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
    databaseUrl: e.DATABASE_URL || null,
    jwtSecret: e.JWT_SECRET ?? (nodeEnv === "production" ? "" : "dev-only-secret-change-me"),
    jwtExpiresIn: e.JWT_EXPIRES_IN ?? "30d",
    masterKey: masterKey(e.MASTER_KEY, nodeEnv),
    adminSetupToken: e.ADMIN_SETUP_TOKEN || (nodeEnv === "production" ? null : "local-setup"),
    mpesa: {
      driver: (e.MPESA_DRIVER as "daraja" | "simulated") ?? (darajaConfigured ? "daraja" : "simulated"),
      env: e.MPESA_ENV === "production" ? "production" : "sandbox",
      consumerKey: e.MPESA_CONSUMER_KEY ?? "",
      consumerSecret: e.MPESA_CONSUMER_SECRET ?? "",
      shortcode: e.MPESA_SHORTCODE ?? "174379",
      passkey: e.MPESA_PASSKEY ?? "",
      till: e.MPESA_TILL ?? "",
      callbackToken: e.MPESA_CALLBACK_TOKEN ?? (nodeEnv === "production" ? "" : "dev-callback"),
    },
    sms: { username: e.AT_USERNAME ?? "", apiKey: e.AT_API_KEY ?? "", senderId: e.AT_SENDER_ID ?? "" },
    cloudinaryUrl: e.CLOUDINARY_URL || null,
    phoneVerification: on(e.PHONE_VERIFICATION, smsConfigured),
    sampleContent: on(e.SAMPLE_CONTENT, nodeEnv !== "test"),
    webDist: e.WEB_DIST ?? null,
  };

  if (nodeEnv === "production") {
    const missing = [
      !env.databaseUrl && "DATABASE_URL",
      env.jwtSecret.length < 32 && "JWT_SECRET (32+ chars)",
      !env.mpesa.callbackToken && "MPESA_CALLBACK_TOKEN",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing production settings: ${missing.join(", ")}`);
    if (env.mpesa.driver === "daraja" && !darajaConfigured) throw new Error("MPESA_DRIVER=daraja needs MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_PASSKEY");
  }
  return env;
}

export const env = loadEnv();
