import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { adminRouter } from "./routes/admin.routes.js";
import { adsRouter } from "./routes/ads.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { bookingsRouter } from "./routes/bookings.routes.js";
import { connectRouter, usersConnectHandler } from "./routes/connect.routes.js";
import { hostRouter } from "./routes/host.routes.js";
import { listingsRouter } from "./routes/listings.routes.js";
import { mediaRouter } from "./routes/media.routes.js";
import { messagesRouter } from "./routes/messages.routes.js";
import { mpesaRouter } from "./routes/mpesa.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { safetyRouter } from "./routes/safety.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { verificationRouter } from "./routes/verification.routes.js";
import { requireSwitch, siteState } from "./services/settings.js";

export function createApp() {
  const app = express();
  // Render puts Cloudflare and its own proxy in front: the visitor is three hops back.
  app.set("trust proxy", 3);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: env.corsOrigin, credentials: false }));

  // Never write secrets from URLs (callback token, stream tickets) into the log.
  morgan.token("safe-url", (req) => (req as express.Request).originalUrl.replace(/(\/api\/mpesa\/callback\/)[^/?]+/, "$1••••").replace(/ticket=[^&]+/, "ticket=••••"));
  app.use(morgan(env.nodeEnv === "production" ? ":remote-addr :method :safe-url :status :response-time ms" : "dev", { skip: (req) => req.url.startsWith("/assets/") || req.url.startsWith("/samples/") || req.url === "/health" }));

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: env.nodeEnv === "test" ? 100_000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: (req) => req.path.startsWith("/media/") || req.path.startsWith("/mpesa/callback/") || req.path === "/notifications/stream",
      message: { error: { code: "rate_limited", message: "Too many requests. Slow down for a minute." } },
    }),
  );

  const site = env.appRole !== "admin";
  const control = env.appRole !== "public";

  // Photos are needed on both hosts.
  app.use("/api/media", mediaRouter);

  if (site) {
    const connectOpen = requireSwitch("connect_open", "Connect is closed for now");
    app.get("/api/site", async (_req, res) => res.json(await siteState()));
    app.use("/api/auth", authRouter);
    app.get("/api/users/connect", connectOpen, ...usersConnectHandler);
    app.use("/api/users", usersRouter);
    app.use("/api/listings", listingsRouter);
    app.use("/api/bookings", bookingsRouter);
    app.use("/api/mpesa", mpesaRouter);
    app.use("/api/connect", connectOpen, connectRouter);
    app.use("/api/messages", connectOpen, messagesRouter);
    app.use("/api/safety", safetyRouter);
    app.use("/api/verification", verificationRouter);
    app.use("/api/ads", adsRouter);
    app.use("/api/host", hostRouter);
    app.use("/api/notifications", notificationsRouter);
  }
  // The control centre lives on its own host; the public site doesn't answer for it.
  if (control) app.use("/api/admin", adminRouter);
  app.use("/api", notFoundHandler);

  // The built single-page app: the site, or the control centre on its own host. Hashed
  // assets cache forever; the HTML never does.
  const dist = env.webDist ?? path.resolve(process.cwd(), "../frontend/dist");
  const page = path.join(dist, env.appRole === "admin" ? "admin.html" : "index.html");
  if (fs.existsSync(page)) {
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y", index: false }));
    app.use(express.static(dist, { index: false, maxAge: "1d" }));
    const index = fs.readFileSync(page, "utf8");
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.set("Cache-Control", "no-cache").type("html").send(index);
    });
  }

  app.use(errorHandler);
  return app;
}
