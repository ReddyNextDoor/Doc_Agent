import crypto from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

export function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

export async function getInstallationOctokit({ appId, privateKey, installationId }) {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId
    }
  });

  return appOctokit;
}

export async function listRepositoryFiles(octokit, owner, repo, branch) {
  const branchResponse = await octokit.request("GET /repos/{owner}/{repo}/branches/{branch}", {
    owner,
    repo,
    branch
  });

  const treeSha = branchResponse.data.commit.commit.tree.sha;

  const treeResponse = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "1"
  });

  return treeResponse.data.tree.filter((item) => item.type === "blob");
}

export async function getFileContent(octokit, owner, repo, path, ref) {
  const response = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path,
    ref,
    mediaType: {
      format: "raw"
    }
  });

  return String(response.data);
}

export async function upsertDocumentationFile(
  octokit,
  owner,
  repo,
  branch,
  content,
  actor = "documentation-agent"
) {
  let existingSha;

  try {
    const existing = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path: "documentation.md",
      ref: branch
    });

    existingSha = existing.data.sha;
  } catch {
    existingSha = undefined;
  }

  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: "documentation.md",
    message: "docs: generate comprehensive repository documentation",
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    sha: existingSha,
    committer: {
      name: actor,
      email: `${actor}@users.noreply.github.com`
    },
    author: {
      name: actor,
      email: `${actor}@users.noreply.github.com`
    }
  });
}
