import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";

// `tool.call`의 wire 이름이다. 정의를 tools[]에 싣지 않은 tool을 일반 tool calling으로 부르는 진입점이다.
export const TOOL_CALL_WIRE = "tool_call";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// `tool_call {name, input}`을 대상 tool의 호출로 바꾼다. loop가 기록·Gate·retry·effect 판단 전에 불러 대상 tool의
// 정의와 실행 경로가 그대로 쓰인다(wrapper는 read라서 그대로 두면 쓰기가 병렬·retry로 다시 돈다). 한 겹만 풀고,
// 모양이 `tool.call` 입력과 다르면 그대로 둔다: 실행기가 `tool.call` schema로 거절한다.
export function dispatchTarget(
  name: string,
  input: unknown,
): { name: string; input: unknown } {
  if (name !== TOOL_CALL_WIRE || !isPlainObject(input)) return { name, input };
  if (Object.keys(input).some((key) => key !== "name" && key !== "input")) {
    return { name, input };
  }
  const target = input.name;
  const inner = input.input;
  if (typeof target !== "string" || target === "") return { name, input };
  if (inner !== undefined && !isPlainObject(inner)) return { name, input };
  return { name: toWireToolName(target), input: inner ?? {} };
}
