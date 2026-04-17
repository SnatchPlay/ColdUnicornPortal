import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage() {
  console.error(
    [
      "Usage:",
      "node scripts/import-copilot-chat.mjs \\",
      '  --source "<copilot transcript.jsonl>" \\',
      '  --title "<codex thread title>" \\',
      '  --cwd "<workspace path>"',
    ].join("\n"),
  );
}

function normalizeAssistantText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed === "Try Again") return null;

  const finalAnswerMatch = trimmed.match(/^<final_answer>\s*([\s\S]*?)\s*<\/final_answer>$/);
  return (finalAnswerMatch?.[1] ?? trimmed).trim() || null;
}

function extractImportedMessages(lines) {
  const imported = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === "user.message") {
      const text = typeof record.data?.content === "string" ? record.data.content.trim() : "";
      if (!text || text === "Try Again") continue;
      imported.push({
        role: "user",
        text,
        timestamp: record.timestamp,
      });
      continue;
    }

    if (record.type === "assistant.message") {
      const text = typeof record.data?.content === "string" ? normalizeAssistantText(record.data.content) : null;
      if (!text) continue;
      imported.push({
        role: "assistant",
        text,
        timestamp: record.timestamp,
      });
    }
  }

  return imported;
}

function buildSessionRecord({ id, cwd, startedAt, title, sourcePath, sourceSessionId }) {
  return {
    timestamp: startedAt,
    type: "session_meta",
    payload: {
      id,
      timestamp: startedAt,
      cwd,
      originator: "codex_vscode",
      cli_version: "imported-from-copilot",
      source: "vscode",
      model_provider: "openai",
      import_meta: {
        source: "github_copilot_chat",
        source_path: sourcePath,
        source_session_id: sourceSessionId,
        thread_name: title,
      },
    },
  };
}

function buildResponseItem(message) {
  return {
    timestamp: message.timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: message.role,
      content: [
        {
          type: message.role === "user" ? "input_text" : "output_text",
          text: message.text,
        },
      ],
      phase: "imported",
    },
  };
}

const args = parseArgs(process.argv);
const sourcePath = args.source;
const title = args.title;
const cwd = args.cwd;

if (!sourcePath || !title || !cwd) {
  usage();
  process.exit(1);
}

if (!existsSync(sourcePath)) {
  console.error(`Source transcript not found: ${sourcePath}`);
  process.exit(1);
}

const sourceLines = readFileSync(sourcePath, "utf8").split(/\r?\n/);
const sourceSessionStart = sourceLines.find((line) => line.includes('"type":"session.start"'));
let sourceSessionId = null;

if (sourceSessionStart) {
  try {
    sourceSessionId = JSON.parse(sourceSessionStart).data?.sessionId ?? null;
  } catch {
    sourceSessionId = null;
  }
}

const importedMessages = extractImportedMessages(sourceLines);

if (importedMessages.length === 0) {
  console.error("No importable user/assistant messages were found in the transcript.");
  process.exit(1);
}

const codexHome = path.join(os.homedir(), ".codex");
const now = new Date();
const yyyy = String(now.getUTCFullYear());
const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
const dd = String(now.getUTCDate()).padStart(2, "0");
const startedAt = now.toISOString();
const id = randomUUID();
const safeTimestamp = startedAt.replace(/[:.]/g, "-").replace("Z", "");
const sessionDir = path.join(codexHome, "sessions", yyyy, mm, dd);
const sessionPath = path.join(sessionDir, `rollout-${safeTimestamp}-${id}.jsonl`);
const sessionIndexPath = path.join(codexHome, "session_index.jsonl");

mkdirSync(sessionDir, { recursive: true });

const records = [
  buildSessionRecord({ id, cwd, startedAt, title, sourcePath, sourceSessionId }),
  ...importedMessages.map(buildResponseItem),
];

writeFileSync(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
appendFileSync(
  sessionIndexPath,
  `${JSON.stringify({
    id,
    thread_name: title,
    updated_at: startedAt,
  })}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      imported_messages: importedMessages.length,
      session_id: id,
      session_path: sessionPath,
      session_title: title,
      source_session_id: sourceSessionId,
    },
    null,
    2,
  ),
);
