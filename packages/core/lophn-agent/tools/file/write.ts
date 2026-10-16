import { dirname } from "node:path";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { recordBeforeWrite } from "../../session/rewind/record.ts";
import {
  isInstructionFile,
  settingsEditIntent,
} from "../../tool-judgment/intents.ts";
import type { GateRequest } from "../registry.ts";
import type { ToolContext } from "../tool-context.ts";
import { fail, fsFail, resolveInPlace } from "./scope.ts";

// `LOPHN.md` 쓰기는 설정 고치기라 Gate에 먼저 묻는다.
export function instructionGate(
  input: unknown,
  ctx: ToolContext,
): GateRequest | null {
  const { path } = input as { path: string };
  if (!isInstructionFile(path)) return null;
  const intent = settingsEditIntent({
    what: "instructions",
    id: null,
    session: ctx.session,
    turn: ctx.turn,
    toolCall: ctx.tool_call,
    agent: ctx.agent,
  });
  return {
    kind: intent.kind,
    target: intent.target,
    effect: intent.effect,
    input: intent.input,
  };
}

// pre-image를 남기고 쓴다. 기록이 실패해도 쓰기는 막지 않는다.
async function writeText(
  ctx: ToolContext,
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

  const written = await recordBeforeWrite(ctx.rewind, {
    session: ctx.session,
    tool_call: ctx.tool_call,
    path: target.relative,
    moved_from: null,
    run: async () => {
      try {
        await Deno.mkdir(dirname(target.path), { recursive: true });
        await Deno.writeTextFile(target.path, next);
        return ok(undefined);
      } catch {
        return fail("invalid_input", "cannot write this path");
      }
    },
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
): Promise<Result<ToolResult>> {
  return writeText(ctx, input.path, input.content, null);
}

export function editFile(
  input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  },
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  return writeText(ctx, input.path, "", {
    old_string: input.old_string,
    new_string: input.new_string,
    all: input.replace_all === true,
  });
}
