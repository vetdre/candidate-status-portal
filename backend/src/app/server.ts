import express from "express";
import { env } from "../config/env.js";
import { archiveWebhookHandler } from "../ingestion/routes/archiveWebhook.js";
import { interviewsWebhookHandler } from "../ingestion/routes/interviewsWebhook.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "candidate-portal-backend",
    ff: {
      ingest: env.ffIngestEnabled,
      archiveRoute: env.ffArchiveRouteEnabled,
      interviewsRoute: env.ffInterviewsRouteEnabled,
      shadowMaterialize: env.ffShadowMaterializeEnabled,
      dryRun: env.ffDryRunMode,
    },
  });
});

app.post("/webhooks/lever/archive-state-change", async (req, res) => {
  await archiveWebhookHandler(req, res);
});

app.post("/webhooks/lever/interviews", async (req, res) => {
  await interviewsWebhookHandler(req, res);
});

app.listen(env.port, () => {
  console.log(`backend listening on port ${env.port}`);
});
