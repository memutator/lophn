import { err, ok, type Result } from "../../../../base/mod.ts";
import { COMMANDS } from "../../../../cli/commands/mod.ts";
import { parseCommandLine, splitOn, wordsOf } from "../../../../cli/parser.ts";
import {
  toWireToolName,
  WIRE_TOOL_NAME_PATTERN,
} from "../../../../protocol/lophn-agent/tool-catalog.ts";
import {
  type MachineCandidate,
  resolveMachine,
} from "../../../../protocol/machine/requester.ts";
import { type AppCommandEntry, appToolWireName } from "../app-tool/command.ts";

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

// `--on <기계>`를 떼고 그 기계를 명단에서 고른다. `--on`이 없으면 이 기계(machine null)다. 이 컴퓨터를 고르거나 빈 글이거나 명단에 없으면 오류다.
export function appScopeOf(
  args: readonly string[],
  machines: readonly MachineCandidate[],
): Result<{ machine: string | null; argv: string[] }> {
  const split = splitOn(args);
  if (!split.ok) return split;
  const { on, argv } = split.value;
  if (on === null) return ok({ machine: null, argv });
  if (on === "") {
    return err({
      code: "invalid_input",
      message: "--on needs a computer name",
    });
  }
  const found = resolveMachine(on, machines);
  if (!found.ok) return found;
  if (found.value.self) {
    return err({
      code: "invalid_input",
      message: "that is this computer; leave out --on to use its apps",
    });
  }
  return ok({ machine: found.value.machine, argv });
}

// 이 호출이 앱 command일 수 있는가. 내장 명령의 첫 낱말이면 앱 목록(다른 컴퓨터를 읽을 수 있다)을 읽을 까닭이 없다.
export function mayBeAppCall(input: unknown): boolean {
  const args = argsOf(input);
  if (args === undefined) return false;
  const split = splitOn(args);
  if (!split.ok) return false;
  const [first] = split.value.argv;
  return first !== undefined && !isBuiltinWord(first);
}

// 앱 command의 호출로 푼다. 지금 부를 수 있는 command(`entries`) 중 하나로 읽히면 그 command와 입력이고, 아니면
// (도움말, 틀린 명령줄, 할당 밖·뺀·비공개 command, 고르지 못한 기계) undefined라 호출은 `lophn` tool에 남아 그 handler가 답한다.
// `--on <기계>`가 있으면 그 기계의 앱 command만 보고, 없으면 이 기계의 것만 본다.
// wire 이름이 형식에 맞지 않는 이름은 tool 표 전체를 깨므로 풀지 않는다.
export function resolveAppCall(
  input: unknown,
  entries: readonly AppCommandEntry[],
  machines: readonly MachineCandidate[] = [],
):
  | { entry: AppCommandEntry; name: string; input: Record<string, unknown> }
  | undefined {
  const args = argsOf(input);
  if (args === undefined) return undefined;
  const scope = appScopeOf(args, machines);
  if (!scope.ok || scope.value.argv.length === 0) return undefined;
  const { machine, argv } = scope.value;
  if (isBuiltinWord(argv[0])) return undefined;
  const visible = entries.filter((entry) => entry.machine === machine);
  const parsed = parseCommandLine(
    argv,
    visible.map((entry) => entry.doc),
  );
  if (!parsed.ok || parsed.value.kind !== "run") return undefined;
  const { command } = parsed.value;
  const entry = visible.find((one) => one.doc === command);
  if (
    entry === undefined ||
    !WIRE_TOOL_NAME_PATTERN.test(appToolWireName(entry))
  ) {
    return undefined;
  }
  // 실행기는 wire 이름으로 목록에서 찾는다. 정본 이름(`calls.add_item`)을 주면 목록 밖으로 거절된다.
  return {
    entry,
    name: appToolWireName(entry),
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
