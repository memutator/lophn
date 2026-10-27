import { dirname } from "node:path";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { FileHooks } from "../ports.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

// 쓰기는 hook이 감싼다(role 층이 쓰기 기록을 남긴다).
async function writeText(
  ctx: ToolContext,
  hooks: FileHooks,
  inputPath: string,
  content: string,
  edit: { old_string: string; new_string: string; all: boolean } | null,
): Promise<Result<ToolResult>> {
  const at = await resolveInPlace(ctx.scope, inputPath, "write");
  if (!at.ok) return at;
  const target = at.value;
  let before: string | null = null;
  try {
    before = await Deno.readTextFile(target.path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) return fsFail(error);
  }

  let next = content;
  let replaced = 0;
  if (edit !== null) {
    if (before === null) return fail("not_found", "file not found");
    if (edit.old_string === "" || edit.old_string === edit.new_string) {
      return fail(
        "invalid_input",
        "old_string is empty or the same as new_string",
      );
    }
    const parts = before.split(edit.old_string);
    replaced = parts.length - 1;
    if (replaced === 0) return fail("invalid_input", "old_string not found");
    if (replaced > 1 && !edit.all) {
      return fail(
        "invalid_input",
        `old_string appears ${replaced} times; add context or use replace_all`,
      );
    }
    next = edit.all
      ? parts.join(edit.new_string)
      : parts[0] + edit.new_string + parts.slice(1).join(edit.old_string);
    if (!edit.all) replaced = 1;
  }

  const written = await hooks.aroundWrite(ctx, target, async () => {
    try {
      const parent = dirname(target.path);
      if (!(await Deno.stat(parent).then(() => true, () => false))) {
        await Deno.mkdir(parent, { recursive: true });
      }
      await Deno.writeTextFile(target.path, next);
      return ok(undefined);
    } catch {
      return fail("invalid_input", "cannot write this path");
    }
  });
  if (!written.ok) return written;
  return ok({
    status: "success",
    summary: edit === null
      ? `${before === null ? "created" : "wrote"} ${inputPath}`
      : `edited ${inputPath} (${replaced} replaced)`,
    content: {
      path: inputPath,
      created: before === null,
      bytes: new TextEncoder().encode(next).length,
    },
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  });
}

export function writeFile(
  input: { path: string; content: string },
  ctx: ToolContext,
  hooks: FileHooks,
): Promise<Result<ToolResult>> {
  return writeText(ctx, hooks, input.path, input.content, null);
}

export function editFile(
  input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
  ctx: ToolContext,
  hooks: FileHooks,
): Promise<Result<ToolResult>> {
  return writeText(ctx, hooks, input.path, "", {
    old_string: input.old_string,
    new_string: input.new_string,
    all: input.replace_all === true,
  });
}
