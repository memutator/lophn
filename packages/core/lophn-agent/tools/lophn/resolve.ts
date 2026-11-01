import { COMMANDS } from "../../../../cli/commands/mod.ts";
import { parseCommandLine } from "../../../../cli/parser.ts";
import { toWireToolName } from "../../../../protocol/lophn-agent/tool-catalog.ts";

// `lophn {args}` 호출을 그 명령의 호출로 푼다. 명령줄이 모든 명령 중 하나로 읽히면 명령의 wire 이름과 입력이고,
// 아니면(도움말, 틀린 명령줄, 모양이 다른 입력) undefined라 호출은 `lophn` tool에 남아 그 handler가 답한다.
// 그 place 종류가 부를 수 없는 명령도 여기서는 풀린다. 목록 밖 이름이라 실행기가 "tool is not available"로 거절한다.
export function resolveLophnCall(
  input: unknown,
): { name: string; input: unknown } | undefined {
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
  const parsed = parseCommandLine(args as string[], COMMANDS);
  if (!parsed.ok || parsed.value.kind !== "run") return undefined;
  return {
    name: toWireToolName(parsed.value.command.name),
    input: parsed.value.input,
  };
}
