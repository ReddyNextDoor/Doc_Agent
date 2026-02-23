import express from "express";
import { config } from "./config.js";
import { processRepository, isBotDocumentationCommit } from "./processor.js";
import { verifyWebhookSignature } from "./security.js";

export function createApp(deps = {}) {
  const app = express();
  const runtimeConfig = deps.runtimeConfig ?? config;
  const logger = deps.logger ?? console;
  const processRepo = deps.processRepo ?? processRepository;

  app.use(express.json({ limit: "5mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

  app.post("/webhook", async (req, res) => {
    const signature = req.get("x-hub-signature-256");
    const isValid = verifyWebhookSignature(req.rawBody, signature, runtimeConfig.webhookSecret);

    if (!isValid) {
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.get("x-github-event");
    const payload = req.body;

    if (
      event === "push" &&
      payload.ref === `refs/heads/${payload.repository.default_branch}` &&
      isBotDocumentationCommit(payload, runtimeConfig.commitActor)
    ) {
      res.status(202).send("ignored bot commit");
      return;
    }

    const job = async () => {
      try {
        if (event === "push") {
          const isDefaultBranchPush = payload.ref === `refs/heads/${payload.repository.default_branch}`;
          if (isDefaultBranchPush) {
            await processRepo({
              installationId: payload.installation.id,
              owner: payload.repository.owner.login,
              repo: payload.repository.name,
              branch: payload.repository.default_branch
            });
          }
        }

        if (event === "repository_dispatch" && payload.action === "generate-documentation") {
          await processRepo({
            installationId: payload.installation.id,
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            branch: payload.client_payload?.branch ?? payload.repository.default_branch
          });
        }
      } catch (error) {
        logger.error(
          {
            error,
            event,
            installationId: payload?.installation?.id,
            owner: payload?.repository?.owner?.login,
            repo: payload?.repository?.name,
            branch: payload?.client_payload?.branch ?? payload?.repository?.default_branch
          },
          "Webhook background job failed"
        );
      }
    };

    res.status(202).send("accepted");
    setImmediate(job);
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Documentation app listening on ${config.port}`);
  });
}
