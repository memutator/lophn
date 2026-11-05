import { ok } from "../../../../base/mod.ts";
import {
  type Command,
  type CommandCore,
  type CommandResult,
  commandsForWorkspace,
} from "../../../../cli/commands/mod.ts";
import { commandLine } from "../../../../cli/parser.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import type { WorkspaceKind } from "../../../../protocol/lophn-agent/workspaces.ts";
import { type CoreCall, commandOf, readOf } from "../../run-loop/core-call.ts";
import { resolveInWorkspace } from "../file/scope.ts";
import type { ToolDefinition } from "../registry.ts";
import type { SpillableResult } from "../spill.ts";

// agent credential의 `CoreCall`을 명령 code가 쓰는 core 호출로 바꾼다. 쓰기의 idempotency key는 호출한 쪽이 준다.
// route의 output schema로 이미 검사한 값이라 type만 맞춘다.
function coreOf(call: CoreCall): CommandCore {
  return {
    read: (route, input) => readOf(call, route, input) as never,
    command: (route, input, options) =>
      commandOf(
        call,
        route,
        input,
        options.compare ?? {},
        options.key,
      ) as never,
  };
}

// 전체를 돌려준다. 상한을 넘으면 runtime이 파일로 빼고 arrayKeys로 미리보기를 만든다(spill.ts).
function toolResultOf(result: CommandResult): SpillableResult {
  const summary =
    result.note === undefined
      ? result.summary
      : `${result.summary} (${result.note})`;
  const full: SpillableResult = {
    status: "success",
    summary,
    content: result.content as ToolResult["content"],
    complete: true,
    source: null,
    continuation: null,
    pending: [],
    spill: { arrayKeys: result.arrayKeys ?? [] },
  };
  return result.failed === undefined
    ? full
    : { ...full, status: "failure", summary: `${summary}: ${result.failed}` };
}

// 명령 하나를 loop가 기록·Gate·retry·실행에 쓰는 tool 정의로 만든다. model에는 보이지 않는다: model은 `lophn` tool 하나를 보고
// loop가 그 호출을 이 정의의 호출로 푼다(`dispatchTarget`). effect, operations, display는 명령에서 온다.
function commandTool(command: Command): ToolDefinition {
  return {
    name: command.name,
    description: command.summary,
    input: command.input,
    effect: command.effect,
    origin: "builtin",
    operations: command.routes.map((route) => route.name),
    display: (input) => ({
      category: "command",
      title: commandLine(command, input as Record<string, unknown>),
    }),
    handler: async (input, ctx) => {
      const cwd = ctx.scope.base ?? ctx.scope.read[0];
      const ran = await command.run(input as Record<string, unknown>, {
        core: coreOf(ctx.core),
        // 같은 tool call을 다시 보내도 같은 key라 효과가 한 번이다.
        key: ctx.tool_call,
        workspace: ctx.workspace,
        ...(cwd === undefined ? {} : { cwd }),
        resolveRead: async (path) => {
          const at = await resolveInWorkspace(ctx.scope, path, "read");
          return at.ok ? ok(at.value.path) : at;
        },
        caller: {
          session: ctx.session,
          turn: ctx.turn,
          tool_call: ctx.tool_call,
        },
        clock: ctx.clock,
        signal: ctx.signal ?? new AbortController().signal,
      });
      return ran.ok ? ok(toolResultOf(ran.value)) : ran;
    },
  };
}

// 그 workspace 종류가 부를 수 있는 명령의 정의다. loop가 session의 `listed`에 더한다. bare는 고른 이름(`only`)만 낸다.
export function commandTools(
  kind: WorkspaceKind,
  only?: ReadonlySet<string>,
): readonly ToolDefinition[] {
  return commandsForWorkspace(kind)
    .filter((command) => only === undefined || only.has(command.name))
    .map(commandTool);
}
