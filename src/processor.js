import { config } from "./config.js";
import {
  getFileContent,
  getInstallationOctokit,
  listRepositoryFiles,
  upsertDocumentationFile
} from "./github.js";
import { processRepositoryCore, isBotDocumentationCommit } from "./processor-core.js";

export async function processRepository(context, deps = {}) {
  const github = deps.github ?? {
    getInstallationOctokit,
    getFileContent,
    listRepositoryFiles,
    upsertDocumentationFile
  };
  const runtimeConfig = deps.runtimeConfig ?? config;
  const logger = deps.logger ?? console;

  return processRepositoryCore(context, {
    ...deps,
    github,
    runtimeConfig,
    logger
  });
}

export { isBotDocumentationCommit };
