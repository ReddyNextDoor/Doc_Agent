import test from "node:test";
import assert from "node:assert/strict";
import { buildRepositorySnapshot, hasPotentialSecret, shouldIncludePath } from "../src/documentation.js";
import { verifyWebhookSignature } from "../src/security.js";
import { processRepositoryCore } from "../src/processor-core.js";

test("shouldIncludePath excludes lockfiles, documentation.md, and env files", () => {
  assert.equal(shouldIncludePath("package-lock.json"), false);
  assert.equal(shouldIncludePath("documentation.md"), false);
  assert.equal(shouldIncludePath(".env.local"), false);
  assert.equal(shouldIncludePath("src/index.js"), true);
});

test("hasPotentialSecret detects common secret patterns", () => {
  assert.equal(hasPotentialSecret("const token = 'ghp_123456789012345678901234567890123456';"), true);
  assert.equal(hasPotentialSecret("hello world"), false);
});

test("buildRepositorySnapshot includes README fallback", () => {
  const snapshot = buildRepositorySnapshot("", [{ path: "src/main.js", content: "console.log('x')" }]);

  assert.match(snapshot, /README missing or empty/);
  assert.match(snapshot, /File: src\/main.js/);
});

test("verifyWebhookSignature returns false on mismatched lengths without throwing", () => {
  const valid = verifyWebhookSignature(Buffer.from("{}"), "sha256=abc", "secret");
  assert.equal(valid, false);
});

test("processRepositoryCore filters paths before reading and skips suspected secrets", async () => {
  const readPaths = [];
  let upsertArgs;

  const deps = {
    runtimeConfig: {
      appId: "1",
      privateKey: "key",
      webhookSecret: "secret",
      llmApiKey: "openai",
      llmModel: "gpt-4.1-mini",
      port: 3000,
      commitActor: "doc-agent-github-app",
      maxConcurrentFileReads: 3
    },
    github: {
      getInstallationOctokit: async () => ({ mocked: true }),
      listRepositoryFiles: async () => ({
        files: [{ path: "README.md" }, { path: ".env" }, { path: "src/a.js" }, { path: "documentation.md" }],
        truncated: false
      }),
      getFileContent: async (_octokit, _owner, _repo, path) => {
        readPaths.push(path);
        if (path === "README.md") return "# title";
        if (path === "src/a.js") return "const password='supersecret123';";
        return "ignored";
      },
      upsertDocumentationFile: async (...args) => {
        upsertArgs = args;
      }
    },
    docs: {
      shouldIncludePath,
      hasPotentialSecret,
      buildRepositorySnapshot: (_readme, files) => JSON.stringify(files.map((f) => f.path)),
      generateDocumentation: async () => "# generated"
    },
    logger: {
      warn: () => {},
      error: () => {}
    }
  };

  await processRepositoryCore({ installationId: 1, owner: "o", repo: "r", branch: "main" }, deps);

  assert.equal(readPaths.includes("src/a.js"), true);
  assert.equal(readPaths.includes(".env"), false);
  assert.equal(readPaths.includes("documentation.md"), false);
  assert.equal(upsertArgs[5], "doc-agent-github-app");
});

test("processRepositoryCore warns when tree is truncated", async () => {
  const warnings = [];

  const deps = {
    runtimeConfig: {
      appId: "1",
      privateKey: "key",
      webhookSecret: "secret",
      llmApiKey: "openai",
      llmModel: "gpt-4.1-mini",
      port: 3000,
      commitActor: "doc-agent-github-app",
      maxConcurrentFileReads: 2
    },
    github: {
      getInstallationOctokit: async () => ({}),
      listRepositoryFiles: async () => ({ files: [], truncated: true }),
      getFileContent: async () => "",
      upsertDocumentationFile: async () => {}
    },
    docs: {
      shouldIncludePath,
      hasPotentialSecret,
      buildRepositorySnapshot: () => "snapshot",
      generateDocumentation: async () => "# generated"
    },
    logger: {
      warn: (...args) => warnings.push(args),
      error: () => {}
    }
  };

  await processRepositoryCore({ installationId: 1, owner: "o", repo: "r", branch: "main" }, deps);
  assert.equal(warnings.length > 0, true);
});
