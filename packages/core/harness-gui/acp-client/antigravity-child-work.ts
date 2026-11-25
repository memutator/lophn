// Read-only Child Inspector for Antigravity (`agy`) local brain files.
// Reads:
//   - `<home>/.gemini/antigravity-cli/brain/<parentId>/.system_generated/subagents/*.json`
//   - `<home>/.gemini/antigravity-cli/brain/<childId>/.system_generated/logs/transcript.jsonl`
//
// Security & resilience guarantees:
//   - NEVER follows symlinks (`lstat` check on every directory & file segment).
//   - Rejects path-traversal IDs.
//   - Enforces strict byte caps (64 KiB per metadata file, 2 MiB per transcript).
//   - Fail-closed: missing, unreadable, malformed, or schema-drifted files return
//     null / are silently skipped without disrupting parent dock cards.

import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ChildTranscriptStep,
  ChildTranscriptToolCall,
  ChildWorkEntry,
  ChildWorkState,
} from "./dialect.ts";
import type { Json } from "./transport.ts";

export const MAX_SUBAGENT_META_BYTES = 64 * 1024;
export const MAX_CHILD_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Maps Antigravity `SUBAGENT_STATE_*` enum strings to canonical child states.
 * Unknown or missing states ALWAYS map to `"ok"` (ended), NEVER `"running"`,
 * so an agy schema change cannot leave zombie running cards in the dock.
 */
export function mapAntigravitySubagentState(raw: string): ChildWorkState {
  const upper = raw.trim().toUpperCase();
  if (
    upper === "SUBAGENT_STATE_ALIVE" ||
    upper === "SUBAGENT_STATE_RUNNING" ||
    upper === "SUBAGENT_STATE_STARTING" ||
    upper === "SUBAGENT_STATE_PENDING"
  ) {
    return "running";
  }
  if (upper === "SUBAGENT_STATE_FAILED" || upper === "SUBAGENT_STATE_ERROR") {
    return "error";
  }
  if (
    upper === "SUBAGENT_STATE_KILLED" ||
    upper === "SUBAGENT_STATE_CANCELLED" ||
    upper === "SUBAGENT_STATE_CANCELED"
  ) {
    return "cancelled";
  }
  return "ok";
}

function isSafeId(id: string): boolean {
  return id !== "" && id !== "." && id !== ".." && SAFE_ID.test(id);
}

/** Verify every directory segment from `base` down through `segments` is a real directory (not a symlink). */
async function resolveNoSymlinkDir(
  base: string,
  segments: readonly string[],
): Promise<string | null> {
  let current = base;
  try {
    const baseStat = await lstat(current);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return null;
  } catch {
    return null;
  }
  for (const segment of segments) {
    if (!isSafeId(segment)) return null;
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    } catch {
      return null;
    }
  }
  return current;
}

/** Read a regular non-symlink file with a hard byte cap. Returns null on symlink, oversize, or I/O error. */
async function readFileNoSymlink(
  filePath: string,
  maxBytes: number,
  options: { truncateTail?: boolean } = {},
): Promise<string | null> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    if (!options.truncateTail && stat.size > maxBytes) return null;

    const fh = await open(filePath, "r");
    try {
      const toRead = Math.min(stat.size, maxBytes);
      if (toRead <= 0) return "";
      const offset =
        options.truncateTail && stat.size > maxBytes ? stat.size - maxBytes : 0;
      const buf = Buffer.allocUnsafe(toRead);
      let filled = 0;
      while (filled < toRead) {
        const { bytesRead } = await fh.read(
          buf,
          filled,
          toRead - filled,
          offset + filled,
        );
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return buf.subarray(0, filled).toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

function brainRootOf(home: string): string {
  return join(home, ".gemini", "antigravity-cli", "brain");
}

function parseSubagentMeta(raw: string): ChildWorkEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRec(parsed)) return null;
  const conversationId = str(parsed.conversationId).trim();
  if (!isSafeId(conversationId)) return null;
  const descriptor = rec(parsed.subagentDescriptor);
  const typeName = str(descriptor.typeName).trim();
  const role = str(descriptor.role).trim();
  const stateRaw = str(parsed.state);
  const spawnStepIndex =
    typeof parsed.spawnStepIndex === "number" &&
    Number.isFinite(parsed.spawnStepIndex)
      ? parsed.spawnStepIndex
      : null;
  const workspaceUris = arr(parsed.workspaceUris).filter(
    (item): item is string => typeof item === "string",
  );
  return {
    conversationId,
    typeName,
    role,
    state: mapAntigravitySubagentState(stateRaw),
    spawnStepIndex,
    workspaceUris,
  };
}

function parseTranscriptLine(line: string): ChildTranscriptStep | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRec(parsed)) return null;
  if (typeof parsed.step_index !== "number") return null;
  const toolCalls: ChildTranscriptToolCall[] = arr(parsed.tool_calls).flatMap(
    (entry) => {
      const obj = rec(entry);
      const name = str(obj.name).trim();
      if (name === "") return [];
      return [{ name, args: rec(obj.args) }];
    },
  );
  return {
    stepIndex: parsed.step_index,
    source: str(parsed.source),
    type: str(parsed.type),
    status: str(parsed.status),
    createdAt: str(parsed.created_at),
    content: typeof parsed.content === "string" ? parsed.content : null,
    thinking: typeof parsed.thinking === "string" ? parsed.thinking : null,
    error: typeof parsed.error === "string" ? parsed.error : null,
    toolCalls,
  };
}

/**
 * Reads all subagent metadata records for `parentSessionId`.
 * Returns `null` if the directory does not exist or cannot be read safely.
 */
export async function readAntigravityChildWork(
  home: string,
  parentSessionId: string,
): Promise<ChildWorkEntry[] | null> {
  if (!isSafeId(parentSessionId)) return null;
  const dir = await resolveNoSymlinkDir(brainRootOf(home), [
    parentSessionId,
    ".system_generated",
    "subagents",
  ]);
  if (dir === null) return null;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }

  const entries: ChildWorkEntry[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || !isSafeId(name)) continue;
    const raw = await readFileNoSymlink(
      join(dir, name),
      MAX_SUBAGENT_META_BYTES,
    );
    if (raw === null) continue;
    const entry = parseSubagentMeta(raw);
    if (entry !== null) entries.push(entry);
  }
  entries.sort((a, b) => {
    const sa = a.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    const sb = b.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.conversationId.localeCompare(b.conversationId);
  });
  return entries;
}

/**
 * Reads the child conversation transcript JSONL for `childConversationId`.
 * Enforces no-symlink checks and a 2 MiB byte cap; returns `null` if unavailable.
 */
export async function readAntigravityChildTranscript(
  home: string,
  childConversationId: string,
): Promise<ChildTranscriptStep[] | null> {
  if (!isSafeId(childConversationId)) return null;
  const dir = await resolveNoSymlinkDir(brainRootOf(home), [
    childConversationId,
    ".system_generated",
    "logs",
  ]);
  if (dir === null) return null;

  const raw = await readFileNoSymlink(
    join(dir, "transcript.jsonl"),
    MAX_CHILD_TRANSCRIPT_BYTES,
    { truncateTail: true },
  );
  if (raw === null) return null;

  const steps: ChildTranscriptStep[] = [];
  for (const line of raw.split("\n")) {
    const step = parseTranscriptLine(line);
    if (step !== null) steps.push(step);
  }
  steps.sort((a, b) => a.stepIndex - b.stepIndex);
  return steps;
}
