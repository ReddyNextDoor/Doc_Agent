import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function ensureRequiredEnv() {
  process.env.GITHUB_APP_ID ??= "1";
  process.env.GITHUB_PRIVATE_KEY ??= "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
  process.env.GITHUB_WEBHOOK_SECRET ??= "test-webhook-secret";
  process.env.OPENAI_API_KEY ??= "test-openai-key";
}

async function loadCreateApp() {
  ensureRequiredEnv();
  const module = await import("../src/index.js");
  return module.createApp;
}

function signBody(body, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unexpected server address type");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function waitFor(predicate, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for async webhook job");
}

async function postWebhook({ baseUrl, event, payload, secret }) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signBody(body, secret)
    },
    body
  });

  return response;
}

test("health endpoint returns ok status", async () => {
  const createApp = await loadCreateApp();
  const app = createApp({
    runtimeConfig: { webhookSecret: "secret", commitActor: "doc-agent-github-app" },
    processRepo: async () => {},
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok" });
  } finally {
    await stopServer(server);
  }
});

test("webhook rejects invalid signature", async () => {
  const createApp = await loadCreateApp();
  const calls = [];
  const app = createApp({
    runtimeConfig: { webhookSecret: "correct-secret", commitActor: "doc-agent-github-app" },
    processRepo: async (...args) => calls.push(args),
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const payload = {
      ref: "refs/heads/main",
      installation: { id: 1 },
      repository: { default_branch: "main", name: "repo", owner: { login: "owner" } }
    };

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=bad"
      },
      body: JSON.stringify(payload)
    });

    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  } finally {
    await stopServer(server);
  }
});

test("webhook triggers processRepo for default branch push", async () => {
  const createApp = await loadCreateApp();
  const calls = [];
  const app = createApp({
    runtimeConfig: { webhookSecret: "secret", commitActor: "doc-agent-github-app" },
    processRepo: async (context) => calls.push(context),
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const payload = {
      ref: "refs/heads/main",
      installation: { id: 99 },
      repository: { default_branch: "main", name: "repo", owner: { login: "owner" } },
      head_commit: { author: { name: "human" }, committer: { name: "human" } }
    };

    const response = await postWebhook({ baseUrl, event: "push", payload, secret: "secret" });

    assert.equal(response.status, 202);
    await waitFor(() => calls.length === 1);
    assert.deepEqual(calls[0], {
      installationId: 99,
      owner: "owner",
      repo: "repo",
      branch: "main"
    });
  } finally {
    await stopServer(server);
  }
});

test("webhook ignores push on non-default branch", async () => {
  const createApp = await loadCreateApp();
  const calls = [];
  const app = createApp({
    runtimeConfig: { webhookSecret: "secret", commitActor: "doc-agent-github-app" },
    processRepo: async (context) => calls.push(context),
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const payload = {
      ref: "refs/heads/feature/my-branch",
      installation: { id: 42 },
      repository: { default_branch: "main", name: "repo", owner: { login: "owner" } },
      head_commit: { author: { name: "human" }, committer: { name: "human" } }
    };

    const response = await postWebhook({ baseUrl, event: "push", payload, secret: "secret" });

    assert.equal(response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls.length, 0);
  } finally {
    await stopServer(server);
  }
});

test("webhook ignores bot-authored push commits", async () => {
  const createApp = await loadCreateApp();
  const calls = [];
  const app = createApp({
    runtimeConfig: { webhookSecret: "secret", commitActor: "doc-agent-github-app" },
    processRepo: async (context) => calls.push(context),
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const payload = {
      ref: "refs/heads/main",
      installation: { id: 11 },
      repository: { default_branch: "main", name: "repo", owner: { login: "owner" } },
      head_commit: {
        author: { name: "doc-agent-github-app" },
        committer: { name: "doc-agent-github-app" }
      }
    };

    const response = await postWebhook({ baseUrl, event: "push", payload, secret: "secret" });
    const body = await response.text();

    assert.equal(response.status, 202);
    assert.equal(body, "ignored bot commit");
    assert.equal(calls.length, 0);
  } finally {
    await stopServer(server);
  }
});

test("webhook triggers processRepo for repository_dispatch generate-documentation", async () => {
  const createApp = await loadCreateApp();
  const calls = [];
  const app = createApp({
    runtimeConfig: { webhookSecret: "secret", commitActor: "doc-agent-github-app" },
    processRepo: async (context) => calls.push(context),
    logger: { error: () => {}, warn: () => {}, log: () => {} }
  });

  const { server, baseUrl } = await startServer(app);

  try {
    const payload = {
      action: "generate-documentation",
      installation: { id: 77 },
      repository: { default_branch: "main", name: "repo", owner: { login: "owner" } },
      client_payload: { branch: "release" }
    };

    const response = await postWebhook({
      baseUrl,
      event: "repository_dispatch",
      payload,
      secret: "secret"
    });

    assert.equal(response.status, 202);
    await waitFor(() => calls.length === 1);
    assert.deepEqual(calls[0], {
      installationId: 77,
      owner: "owner",
      repo: "repo",
      branch: "release"
    });
  } finally {
    await stopServer(server);
  }
});
