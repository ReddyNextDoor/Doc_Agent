const MAX_FILES = 80;
const MAX_FILE_CHARS = 9000;

const EXCLUDED_PATH_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^coverage\//,
  /^vendor\//,
  /^\.next\//,
  /^documentation\.md$/i,
  /^\.env(\..*)?$/i,
  /\/\.env(\..*)?$/i,
  /^config\/secrets\.ya?ml$/i,
  /\/secrets\.ya?ml$/i,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|gz|tar)$/i,
  /id_rsa$/i,
  /\.pem$/i,
  /\.key$/i
];

const SECRET_CONTENT_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}["']?/i,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/
];

export function shouldIncludePath(path) {
  return !EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function hasPotentialSecret(content) {
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

export function buildRepositorySnapshot(readme, files) {
  const selected = files.filter((file) => shouldIncludePath(file.path)).slice(0, MAX_FILES);

  const sections = selected.map((file) => {
    const truncated = file.content.length > MAX_FILE_CHARS;
    const content = truncated ? `${file.content.slice(0, MAX_FILE_CHARS)}\n...<truncated>` : file.content;

    return `### File: ${file.path}\n\n\
\`\`\`\n${content}\n\`\`\`\n`;
  });

  return [
    "## Existing README",
    readme?.trim() ? readme : "(README missing or empty)",
    "",
    "## Repository Source Snapshot",
    ...sections
  ].join("\n");
}

export async function generateDocumentation({ apiKey, model, owner, repo, branch, snapshot }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a principal technical writer and software architect. Produce exhaustive, accurate, implementation-grounded repository documentation in Markdown. Always include at least two Mermaid diagrams: one architecture/component diagram and one workflow/sequence diagram."
        },
        {
          role: "user",
          content: `Generate a complete documentation.md for ${owner}/${repo} on branch ${branch}.\n\nRules:\n1) Merge and preserve useful README content.\n2) Cover setup, architecture, modules, API/CLI interfaces, configuration, workflows, extension points, and troubleshooting.\n3) Add a table of contents and section anchors.\n4) Include explicit assumptions and unknowns if any code is ambiguous.\n5) Output only Markdown content suitable for documentation.md.\n\nRepository material:\n\n${snapshot}`
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("OpenAI API returned an empty response.");
  }

  return text;
}
