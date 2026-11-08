import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { MEMORY_MAX_BYTES } from "../../../../protocol/lophn-agent/tool-lists.ts";
import { fail, fsFail } from "../file/scope.ts";
import type { FileHooks } from "../ports.ts";
import type { ToolContext } from "../tool-context.ts";

const size = (text: string) => new TextEncoder().encode(text).length;

// memory 파일 하나를 덧붙이거나 바꾼다. 어느 파일인지는 부른 session의 agent만이 정한다(hooks.memoryFile).
// 입력에는 자리가 없다. 쓰기는 file tool과 같은 aroundWrite라 rewind가 되돌린다.
export async function editMemory(
  input: { old_string?: string; new_string: string },
  ctx: ToolContext,
  hooks: FileHooks,
): Promise<Result<ToolResult>> {
  const file = hooks.memoryFile?.(ctx.agent) ?? null;
  if (file === null) return fail("unavailable", "memory is not available");

  let before = "";
  try {
    before = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return fsFail(error);
  }

  let next: string;
  if (input.old_string === undefined) {
    const gap = before === "" || before.endsWith("\n") ? "" : "\n";
    next = `${before}${gap}${input.new_string}`;
  } else {
    if (input.old_string === "" || input.old_string === input.new_string) {
      return fail(
        "invalid_input",
        "old_string is empty or the same as new_string",
      );
    }
    const parts = before.split(input.old_string);
    if (parts.length === 1) {
      return fail("invalid_input", "old_string not found in the memory");
    }
    if (parts.length > 2) {
      return fail(
        "invalid_input",
        `old_string appears ${parts.length - 1} times; add context`,
      );
    }
    next = parts[0] + input.new_string + parts[1];
  }

  const bytes = size(next);
  if (bytes > MEMORY_MAX_BYTES) {
    return fail(
      "invalid_input",
      `memory would be ${bytes} bytes, over the ${MEMORY_MAX_BYTES} byte limit; it is ${size(before)} bytes now. Shorten or drop old notes first`,
    );
  }

  // rewind의 쓰기 폴더는 실제로 있는 폴더라야 한다.
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const written = await hooks.aroundWrite(
    ctx,
    { root: await realpath(dir), relative: basename(file) },
    async () => {
      try {
        await writeFile(file, next);
        return ok(undefined);
      } catch {
        return fail("invalid_input", "cannot write the memory");
      }
    },
  );
  if (!written.ok) return written;
  return ok({
    status: "success",
    summary: `memory edited (${bytes} bytes)`,
    content: {
      bytes,
      limit: MEMORY_MAX_BYTES,
      note: "The change shows in the system prompt from the next session.",
    },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  });
}
