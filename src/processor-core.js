import { buildRepositorySnapshot, generateDocumentation, hasPotentialSecret, shouldIncludePath } from "./documentation.js";

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function processRepositoryCore({ installationId, owner, repo, branch }, deps) {
  const { github, runtimeConfig, logger } = deps;
  const docs = deps.docs ?? {
    buildRepositorySnapshot,
    generateDocumentation,
    hasPotentialSecret,
    shouldIncludePath
  };

  const octokit = await github.getInstallationOctokit({
    appId: runtimeConfig.appId,
    privateKey: runtimeConfig.privateKey,
    installationId
  });

  let readme = "";
  try {
    readme = await github.getFileContent(octokit, owner, repo, "README.md", branch);
  } catch (error) {
    if (error.status !== 404) {
      logger.warn({ owner, repo, branch, error }, "Unable to read README.md; continuing with empty README");
    }
  }

  const { files: tree, truncated } = await github.listRepositoryFiles(octokit, owner, repo, branch);
  if (truncated) {
    logger.warn(
      { owner, repo, branch },
      "Repository tree response was truncated by GitHub API; documentation may be incomplete"
    );
  }

  const candidateFiles = tree.filter(
    (item) => item.path && item.path.toLowerCase() !== "readme.md" && docs.shouldIncludePath(item.path)
  );

  const loadedFiles = await mapWithConcurrency(
    candidateFiles,
    runtimeConfig.maxConcurrentFileReads,
    async (item) => {
      try {
        const content = await github.getFileContent(octokit, owner, repo, item.path, branch);
        if (docs.hasPotentialSecret(content)) {
          logger.warn({ owner, repo, branch, path: item.path }, "Skipping file due to potential secret pattern");
          return null;
        }
        return { path: item.path, content };
      } catch (error) {
        logger.warn({ owner, repo, branch, path: item.path, error }, "Skipping unreadable file");
        return null;
      }
    }
  );

  const files = loadedFiles.filter(Boolean);
  const snapshot = docs.buildRepositorySnapshot(readme, files);
  const documentation = await docs.generateDocumentation({
    apiKey: runtimeConfig.llmApiKey,
    model: runtimeConfig.llmModel,
    owner,
    repo,
    branch,
    snapshot,
    timeoutMs: runtimeConfig.openaiTimeoutMs
  });

  await github.upsertDocumentationFile(octokit, owner, repo, branch, documentation, runtimeConfig.commitActor);
}

export function isBotDocumentationCommit(payload, actor) {
  const headCommit = payload?.head_commit;
  if (!headCommit) return false;

  const authorName = headCommit.author?.name;
  const committerName = headCommit.committer?.name;
  return authorName === actor || committerName === actor;
}
