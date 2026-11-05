import { COMMANDS } from "../../../../cli/commands/mod.ts";
import { parseCommandLine, wordsOf } from "../../../../cli/parser.ts";
import {
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../../../protocol/lophn-agent/tool-catalog.ts";
import type { AppCommandEntry } from "../app-tool/command.ts";

// `lophn {args}`의 args다. 모양이 다르면 undefined다.
export function argsOf(input: unknown): string[] | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const keys = Object.keys(input);
  const args = (input as { args?: unknown }).args;
  if (
    keys.length !== 1 ||
    !Array.isArray(args) ||
    args.length === 0 ||
    !args.every((arg) => typeof arg === "string")
  ) {
    return undefined;
  }
  return args as string[];
}

// 내장 명령 묶음의 첫 낱말이다(`RESERVED_APP_SLUGS`가 앱 slug와 겹치지 않게 한다). 앱 slug는 이 밖이다.
export function isBuiltinWord(word: string): boolean {
  return word === "help" || COMMANDS.some((c) => wordsOf(c.name)[0] === word);
}

// 앱 command의 호출로 푼다. 지금 부를 수 있는 command(`entries`) 중 하나로 읽히면 그 command와 입력이고, 아니면
// (도움말, 틀린 명령줄, 할당 밖·뺀·비공개 command) undefined라 호출은 `lophn` tool에 남아 그 handler가 답한다.
// wire 이름이 형식에 맞지 않는 이름은 tool 표 전체를 깨므로 풀지 않는다.
export function resolveAppCall(
  input: unknown,
  entries: readonly AppCommandEntry[],
):
  | { entry: AppCommandEntry; name: string; input: Record<string, unknown> }
  | undefined {
  const args = argsOf(input);
  if (args === undefined || isBuiltinWord(args[0])) return undefined;
  const parsed = parseCommandLine(
    args,
    entries.map((entry) => entry.doc),
  );
  if (!parsed.ok || parsed.value.kind !== "run") return undefined;
  const { command } = parsed.value;
  const entry = entries.find((one) => one.doc === command);
  if (
    entry === undefined ||
    !WIRE_TOOL_NAME_PATTERN.test(toWireToolName(entry.doc.name))
  ) {
    return undefined;
  }
  // 실행기는 wire 이름으로 목록에서 찾는다. 정본 이름(`calls.add_item`)을 주면 목록 밖으로 거절된다.
  return {
    entry,
    name: toWireToolName(entry.doc.name),
    input: parsed.value.input,
  };
}

// `lophn {args}` 호출을 그 명령의 호출로 푼다. 명령줄이 모든 명령 중 하나로 읽히면 명령의 wire 이름과 입력이고,
// 아니면(도움말, 틀린 명령줄, 모양이 다른 입력) undefined라 호출은 `lophn` tool에 남아 그 handler가 답한다.
// 그 workspace 종류가 부를 수 없는 명령도 여기서는 풀린다. 목록 밖 이름이라 실행기가 "tool is not available"로 거절한다.
export function resolveLophnCall(
  input: unknown,
): { name: string; input: unknown } | undefined {
  const args = argsOf(input);
  if (args === undefined) return undefined;
  const parsed = parseCommandLine(args, COMMANDS);
  if (!parsed.ok || parsed.value.kind !== "run") return undefined;
  return {
    name: toWireToolName(parsed.value.command.name),
    input: parsed.value.input,
  };
}
