// 편집 tool의 입력·출력에서 바뀐 줄을 만든다. DOM이 없어 폰의 diff 화면도 import한다.
import { compareLines } from "../../line-diff.ts";

export type EditDiffLine = ReturnType<typeof compareLines>[number];

type BodyReadResult =
  | { readonly ok: true; readonly value: { readonly value: unknown } }
  | { readonly ok: false };

export type ReadToolBody = (
  toolCall: string,
  part: "input" | "output",
) => Promise<BodyReadResult>;

// 각 harness의 편집 tool이 쓰는 앞뒤 글 key 쌍.
const REPLACE_PAIRS: readonly (readonly [before: string, after: string])[] = [
  ["old_string", "new_string"], // lophn file.edit, Claude Edit/MultiEdit
  ["oldString", "newString"], // OpenCode edit
  ["old_text", "new_text"], // OMP edit
  ["oldText", "newText"], // ACP diff / OMP
  ["Target", "Replacement"], // Antigravity edit_file
  ["TargetContent", "ReplacementContent"], // Antigravity replace_file_content
  ["target_content", "replacement_content"], // Antigravity snake_case alias
];

// 파일 전체를 쓰는 tool의 본문 key.
const WHOLE_KEYS = [
  "content", // lophn file.write, Claude Write, OpenCode write, OMP write
  "Content", // Antigravity write_file
  "CodeContent", // Antigravity write_to_file
  "new_source", // Claude NotebookEdit
] as const;

// 여러 바꿈을 한 배열에 싣는 tool의 key.
const CHUNK_LIST_KEYS = [
  "edits", // Claude MultiEdit, OMP
  "ReplacementChunks", // Antigravity multi_replace_file_content
  "replacement_chunks", // Antigravity snake_case alias
] as const;

// unified diff / apply_patch 본문을 싣는 key.
const PATCH_KEYS = ["patchText", "diff", "patch"] as const;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function diffPair(input: Record<string, unknown>): EditDiffLine[] | null {
  for (const [beforeKey, afterKey] of REPLACE_PAIRS) {
    const hasAfter = typeof input[afterKey] === "string";
    const hasBefore = typeof input[beforeKey] === "string";
    if (hasAfter || hasBefore) {
      const before = hasBefore ? (input[beforeKey] as string) : "";
      const after = hasAfter ? (input[afterKey] as string) : "";
      return compareLines(before, after);
    }
  }
  return null;
}

function isPatchHeaderLine(line: string): boolean {
  return (
    line.startsWith("@@ ") ||
    line === "@@" ||
    line.startsWith("diff --git ") ||
    line.startsWith("*** Begin Patch") ||
    line.startsWith("*** Update File:") ||
    line.startsWith("*** Add File:") ||
    line.startsWith("*** Delete File:")
  );
}

function isPatchMetaLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("*** Begin Patch") ||
    line.startsWith("*** End Patch") ||
    line.startsWith("*** Update File:") ||
    line.startsWith("*** Add File:") ||
    line.startsWith("*** Delete File:") ||
    line.startsWith("*** Move to:") ||
    line.startsWith("*** End of File") ||
    line.startsWith("\\ No newline at end of file")
  );
}

/** unified diff / apply_patch 글에서 바뀐 줄을 꺼낸다. diff 헤더가 없는 일반 글은 null이다. */
export function parsePatchDiff(text: string): EditDiffLine[] | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let hasHeader = false;
  let hasChange = false;
  let oldNo = 1;
  let newNo = 1;
  const out: EditDiffLine[] = [];

  for (const line of lines) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      hasHeader = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      continue;
    }
    if (isPatchHeaderLine(line)) {
      hasHeader = true;
      continue;
    }
    if (isPatchMetaLine(line)) {
      continue;
    }
    if (!hasHeader) continue;
    if (line.startsWith("+")) {
      hasChange = true;
      out.push({ kind: "add", newNumber: newNo, text: line.slice(1) });
      newNo += 1;
    } else if (line.startsWith("-")) {
      hasChange = true;
      out.push({ kind: "delete", oldNumber: oldNo, text: line.slice(1) });
      oldNo += 1;
    } else if (line.startsWith(" ")) {
      out.push({
        kind: "same",
        oldNumber: oldNo,
        newNumber: newNo,
        text: line.slice(1),
      });
      oldNo += 1;
      newNo += 1;
    }
  }

  return hasHeader && hasChange ? out : null;
}

/**
 * tool 입력·출력에서 비교할 앞뒤 줄을 꺼낸다. lophn과 각 coding harness(Claude, Antigravity, Codex, OpenCode,
 * OMP)의 편집 입력 JSON이나 unified diff 글을 모두 받는다. 읽을 수 없으면 null이다.
 */
export function editDiffOf(raw: unknown): EditDiffLine[] | null {
  if (typeof raw === "string") {
    const parsed = parseJson(raw);
    const record = asRecord(parsed);
    if (record !== null) return editDiffOf(record);
    return parsePatchDiff(raw);
  }
  const input = asRecord(raw);
  if (input === null) return null;

  const pair = diffPair(input);
  if (pair !== null) return pair;

  for (const listKey of CHUNK_LIST_KEYS) {
    const list = input[listKey];
    if (!Array.isArray(list) || list.length === 0) continue;
    const combined: EditDiffLine[] = [];
    for (const item of list) {
      const record = asRecord(item);
      if (record === null) continue;
      const chunk = diffPair(record);
      if (chunk !== null) combined.push(...chunk);
    }
    if (combined.length > 0) return combined;
  }

  for (const wholeKey of WHOLE_KEYS) {
    if (typeof input[wholeKey] === "string") {
      return compareLines("", input[wholeKey] as string);
    }
  }

  for (const patchKey of PATCH_KEYS) {
    if (typeof input[patchKey] === "string") {
      const patch = parsePatchDiff(input[patchKey] as string);
      if (patch !== null) return patch;
    }
  }

  return null;
}

/**
 * 편집 카드의 diff를 읽는다. 기본은 tool 입력에서 만들고, 입력이 없거나 경로만 실렸거나 잘려 JSON이 깨진 경우
 * (Codex apply_patch, 큰 파일의 Antigravity 편집 등)에는 출력의 unified diff에서 읽는다.
 */
export async function loadEditDiff(
  readBody: ReadToolBody,
  call: string,
): Promise<EditDiffLine[] | null> {
  const input = await readBody(call, "input");
  const fromInput = input.ok ? editDiffOf(input.value.value) : null;
  if (fromInput !== null) return fromInput;
  const output = await readBody(call, "output");
  return output.ok ? editDiffOf(output.value.value) : null;
}
