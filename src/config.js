import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

export const config = {
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n"),
  webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  llmApiKey: required("OPENAI_API_KEY"),
  llmModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  port: parsePort(process.env.PORT ?? "3000", 3000),
  commitActor: process.env.DOC_AGENT_COMMIT_ACTOR ?? "doc-agent-github-app",
  maxConcurrentFileReads: parsePort(process.env.MAX_CONCURRENT_FILE_READS ?? "8", 8)
};
