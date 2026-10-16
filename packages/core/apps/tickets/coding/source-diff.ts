// 앱 source의 두 release 사이 차이. release bundle의 source를 읽는 port가 계약에 없어 이 폴더가 가정한
// type으로 둔다. 실제 구현은 releases 쪽이 낸다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { SourceDiffOutput } from "../../../../protocol/coding-agent/source-diff.ts";

type ReleaseSource =
  // 파일 내용. binary이거나 너무 크면 null이다.
  | { preserved: true; files: ReadonlyMap<string, string | null> }
  | { preserved: false; reason: string };

export type ReleaseSourceReader = {
  // 그 앱의 release가 아니면 not_found다.
  read(app: string, release: string): Promise<Result<ReleaseSource>>;
};

const MAX_FILES = 200;
const MAX_PATCH_BYTES = 64 * 1024;
const MAX_LCS_CELLS = 4_000_000;

// 줄 단위 patch다. 둘이 너무 크면 null이다.
function patchOf(path: string, before: string, after: string): string | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > MAX_LCS_CELLS) return null;
  const table = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push(`-${a[i++]}`);
    } else {
      lines.push(`+${b[j++]}`);
    }
  }
  while (i < a.length) lines.push(`-${a[i++]}`);
  while (j < b.length) lines.push(`+${b[j++]}`);
  const patch = lines.join("\n");
  return patch.length > MAX_PATCH_BYTES ? null : patch;
}

export async function sourceDiff(
  reader: ReleaseSourceReader,
  input: { app: string; from_release: string; to_release: string },
): Promise<Result<SourceDiffOutput>> {
  const from = await reader.read(input.app, input.from_release);
  if (!from.ok) return from;
  const to = await reader.read(input.app, input.to_release);
  if (!to.ok) return to;
  for (
    const [side, name] of [[from.value, "from"], [to.value, "to"]] as const
  ) {
    if (!side.preserved) {
      return ok({
        preserved: false,
        reason: `${name} release: ${side.reason}`,
      });
    }
  }
  if (!from.value.preserved || !to.value.preserved) {
    return err({ code: "internal", message: "release source is not readable" });
  }
  const before = from.value.files;
  const after = to.value.files;
  const files: Extract<SourceDiffOutput, { preserved: true }>["files"] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(path);
    const now = after.get(path);
    if (old !== undefined && old === now) continue;
    const status = old === undefined
      ? "added"
      : now === undefined
      ? "removed"
      : "changed";
    const patch = old === undefined || old === null || now === undefined ||
        now === null
      ? null
      : patchOf(path, old, now);
    files.push({ path, status, patch });
  }
  return ok({
    preserved: true,
    files: files.slice(0, MAX_FILES),
    truncated: files.length > MAX_FILES,
  });
}
