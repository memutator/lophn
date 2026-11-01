import { LOPHN_TOOL_NAME } from "./lophn/tool.ts";
import { resolveLophnCall } from "./lophn/resolve.ts";

// `lophn {args}`를 명령의 호출로 바꾼다. loop가 기록·Gate·retry·effect 판단 전에 불러 명령의 정의와 실행 경로가
// 그대로 쓰인다(`lophn`은 read라서 그대로 두면 쓰기가 병렬·retry로 다시 돈다). 풀지 못하면 그대로 둔다:
// 실행기가 `lophn`의 schema로 거절한다.
export function dispatchTarget(
  name: string,
  input: unknown,
): { name: string; input: unknown } {
  if (name !== LOPHN_TOOL_NAME) return { name, input };
  return resolveLophnCall(input) ?? { name, input };
}
