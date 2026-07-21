// Secret + leakage scanning for committed workflow artifacts.
//
// This runs in CI on every pull request with no network and no n8n token, so it must work purely
// from the files in automation/n8n/**. It is the last line of defence: sanitize() removes the
// fields we KNOW carry credentials, and this catches the ones a human pasted into a parameter.

/** Literal-secret shapes. Deliberately narrow — a noisy scanner gets disabled. */
const SECRET_PATTERNS = [
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, what: "a JWT (n8n/Supabase API key)" },
  { id: "supabase-key", re: /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}\b/, what: "a Supabase key" },
  { id: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/, what: "an OpenAI API key" },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, what: "a Slack token" },
  { id: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: "a Google API key" },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/, what: "an AWS access key id" },
  { id: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, what: "a private key" },
  { id: "postgres-url", re: /\bpostgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/, what: "a Postgres URL with an inline password" },
];

/**
 * A hardcoded bearer/api-key header VALUE. An n8n expression (`={{ ... }}`) that reads the secret
 * from elsewhere at runtime is fine and is the pattern the existing workflows use; a literal is not.
 */
const AUTH_HEADER_NAMES = /^(authorization|x-api-key|api-key|apikey|x-auth-token)$/i;

function isExpression(value) {
  return typeof value === "string" && value.trimStart().startsWith("=");
}

/** Walk every string in the workflow, remembering the JSON path we reached it by. */
function* walkStrings(value, path = []) {
  if (typeof value === "string") {
    yield { path, value };
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* walkStrings(item, [...path, i]);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* walkStrings(item, [...path, key]);
  }
}

/**
 * @returns {Array<{severity: 'error'|'warning', rule: string, where: string, message: string}>}
 */
export function scanWorkflow(workflow, label = "workflow.json") {
  const findings = [];
  const at = (path) => `${label}:${path.join(".")}`;

  for (const { path, value } of walkStrings(workflow)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(value)) {
        findings.push({
          severity: "error",
          rule: `secret/${pattern.id}`,
          where: at(path),
          message: `Looks like ${pattern.what}. Secrets must live in an n8n credential, never in workflow JSON.`,
        });
      }
    }
  }

  if (workflow.pinData && Object.keys(workflow.pinData).length > 0) {
    findings.push({
      severity: "error",
      rule: "pin-data",
      where: `${label}:pinData`,
      message: "Pinned data may contain production payloads and personal data. Run the export through sanitize().",
    });
  }

  for (const node of workflow.nodes ?? []) {
    if (node.credentials && Object.keys(node.credentials).length > 0) {
      findings.push({
        severity: "error",
        rule: "credential-reference",
        where: `${label}:nodes.${node.name}.credentials`,
        message: "Credential references belong in manifest.yaml (alias + type), not in the workflow graph.",
      });
    }

    // Hardcoded auth headers on HTTP nodes.
    const headers = node.parameters?.headerParameters?.parameters ?? [];
    for (const header of headers) {
      if (AUTH_HEADER_NAMES.test(header?.name ?? "") && header?.value && !isExpression(header.value)) {
        findings.push({
          severity: "error",
          rule: "hardcoded-auth-header",
          where: `${label}:nodes.${node.name}.parameters.headerParameters`,
          message: `Header "${header.name}" carries a literal value. Use a credential or an expression.`,
        });
      }
    }

    // Unauthenticated webhook: the path is then the only thing standing between the internet and
    // this workflow, which makes it a shared secret in a file we are committing.
    if (node.type === "n8n-nodes-base.webhook") {
      const auth = node.parameters?.authentication;
      if (!auth || auth === "none") {
        findings.push({
          severity: "warning",
          rule: "unauthenticated-webhook",
          where: `${label}:nodes.${node.name}`,
          message:
            "Webhook has no authentication, so its path is effectively a bearer secret. " +
            "Track it in docs/reference/n8n/security.md and prefer header auth.",
        });
      }
    }
  }

  return findings;
}
