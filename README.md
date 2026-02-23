# Doc Agent GitHub App

A GitHub App that automatically generates a `documentation.md` file for repositories where it is installed.

## What it does

- Triggers on pushes to the default branch.
- It can also be triggered manually via `repository_dispatch` with action `generate-documentation`.
- Reads existing `README.md` content (even if sparse or empty).
- Reads repository source files.
- Uses an LLM to produce comprehensive documentation with Mermaid diagrams.
- Commits/updates `documentation.md` in the same branch.
- Avoids committing loops by ignoring pushes created by the app actor itself.

## Why this matches your request

This app's sole purpose is documentation generation: it combines the existing README and codebase context to create a complete `documentation.md`, including diagrams.

## Setup

1. Create a GitHub App and grant permissions:
   - Repository permissions:
     - **Contents: Read & write**
     - **Metadata: Read-only**
   - Subscribe to events:
     - **Push**
     - **Repository dispatch**

2. Configure environment variables:

```bash
export GITHUB_APP_ID="<app-id>"
export GITHUB_PRIVATE_KEY="<pem-with-escaped-newlines>"
export GITHUB_WEBHOOK_SECRET="<webhook-secret>"
export OPENAI_API_KEY="<openai-key>"
export OPENAI_MODEL="gpt-4.1-mini" # optional
export DOC_AGENT_COMMIT_ACTOR="doc-agent-github-app" # optional
export MAX_CONCURRENT_FILE_READS="8" # optional
export OPENAI_TIMEOUT_MS="30000" # optional
export PORT="3000" # optional
```

3. Install dependencies and run:

```bash
npm install
npm start
```

4. Expose your `/webhook` endpoint to GitHub (for example with a reverse proxy or tunnel) and configure the webhook URL in your GitHub App settings.

## Manual trigger example

To trigger generation outside a push event, call GitHub's repository dispatch API:

```json
{
  "event_type": "generate-documentation",
  "client_payload": {
    "branch": "main"
  }
}
```

## Notes

- Secret-like files and potential secret content are excluded from prompt construction.
- Very large/binary files are filtered out before prompt construction.
- The app truncates very long files to keep token usage bounded.
- `documentation.md` is regenerated each run.
- The webhook returns `202 Accepted` quickly and performs generation in a background job.
