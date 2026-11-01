import { ok } from "../../../../base/mod.ts";
import { commandLine } from "../../../../cli/parser.ts";
import {
  type Command,
  type CommandCore,
  type CommandResult,
  commandsForPlace,
} from "../../../../cli/commands/mod.ts";
import type { PlaceKind } from "../../../../protocol/lophn-agent/places.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { commandOf, type CoreCall, readOf } from "../../run-loop/core-call.ts";
import { fitted } from "../fit-result.ts";
import type { ToolDefinition } from "../registry.ts";

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

// 24 KiB에 맞추는 일은 여기서 한다. binary는 전부 찍는다.
function toolResultOf(result: CommandResult): ToolResult {
  const summary =
    result.note === undefined
      ? result.summary
      : `${result.summary} (${result.note})`;
  const fit = fitted(summary, result.content, result.arrayKeys);
  return result.failed === undefined
    ? fit
    : { ...fit, status: "failure", summary: `${summary}: ${result.failed}` };
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
        place: ctx.place,
        ...(cwd === undefined ? {} : { cwd }),
        clock: ctx.clock,
        signal: ctx.signal ?? new AbortController().signal,
      });
      return ran.ok ? ok(toolResultOf(ran.value)) : ran;
    },
  };
}

// 그 place 종류가 부를 수 있는 명령의 정의다. loop가 session의 `listed`에 더한다.
export function commandTools(kind: PlaceKind): readonly ToolDefinition[] {
  return commandsForPlace(kind).map(commandTool);
}
