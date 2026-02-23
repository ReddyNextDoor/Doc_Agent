import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n"),
  webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  llmApiKey: required("OPENAI_API_KEY"),
  llmModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  port: Number(process.env.PORT ?? 3000)
};
