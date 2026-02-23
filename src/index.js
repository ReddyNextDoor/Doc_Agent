import express from "express";
import { config } from "./config.js";
import {
  getFileContent,
  getInstallationOctokit,
  listRepositoryFiles,
  upsertDocumentationFile,
  verifyWebhookSignature
} from "./github.js";
import { buildRepositorySnapshot, generateDocumentation } from "./documentation.js";

const app = express();
app.use(express.json({ limit: "5mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

async function processRepository({ installationId, owner, repo, branch }) {
  const octokit = await getInstallationOctokit({
    appId: config.appId,
    privateKey: config.privateKey,
    installationId
  });

  let readme = "";
  try {
    readme = await getFileContent(octokit, owner, repo, "README.md", branch);
  } catch {
    readme = "";
  }

  const tree = await listRepositoryFiles(octokit, owner, repo, branch);

  const files = [];
  for (const item of tree) {
    if (!item.path) continue;
    try {
      const content = await getFileContent(octokit, owner, repo, item.path, branch);
      files.push({ path: item.path, content });
    } catch {
      // Ignore unreadable files and continue.
    }
  }

  const snapshot = buildRepositorySnapshot(readme, files);
  const documentation = await generateDocumentation({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    owner,
    repo,
    branch,
    snapshot
  });

  await upsertDocumentationFile(octokit, owner, repo, branch, documentation, "doc-agent-github-app");
}

app.post("/webhook", async (req, res) => {
  const signature = req.get("x-hub-signature-256");
  const isValid = verifyWebhookSignature(req.rawBody, signature, config.webhookSecret);

  if (!isValid) {
    res.status(401).send("Invalid signature");
    return;
  }

  const event = req.get("x-github-event");
  const payload = req.body;

  try {
    if (event === "push") {
      const isDefaultBranchPush = payload.ref === `refs/heads/${payload.repository.default_branch}`;
      if (isDefaultBranchPush) {
        await processRepository({
          installationId: payload.installation.id,
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          branch: payload.repository.default_branch
        });
      }
    }

    if (event === "repository_dispatch" && payload.action === "generate-documentation") {
      await processRepository({
        installationId: payload.installation.id,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: payload.client_payload?.branch ?? payload.repository.default_branch
      });
    }

    res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    res.status(500).send("failed");
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.listen(config.port, () => {
  console.log(`Documentation app listening on ${config.port}`);
});
