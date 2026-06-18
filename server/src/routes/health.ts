import { Router } from "express";

export const healthRouter = Router();

/**
 * Liveness probe.
 *
 * Deployment platforms repeatedly hit a health URL to decide whether an
 * instance is alive and should receive traffic. It must be cheap and make no
 * external calls, so it can never fail for reasons unrelated to "is the
 * process actually up?".
 */
healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "jarvis-server",
    uptimeSeconds: Math.round(process.uptime()),
  });
});
