import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

export async function getInstallationOctokit({ appId, privateKey, installationId }) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId
    }
  });
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

  return {
    files: treeResponse.data.tree.filter((item) => item.type === "blob"),
    truncated: Boolean(treeResponse.data.truncated)
  };
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

export async function upsertDocumentationFile(octokit, owner, repo, branch, content, actor) {
  let existingSha;

  try {
    const existing = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path: "documentation.md",
      ref: branch
    });

    existingSha = existing.data.sha;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
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
