import type { ToolDefinition } from "./registry.ts";
import { inputJsonSchema } from "./wire.ts";

// tool이 많으면 정의 전체는 prompt에 두지 않고 이름만 둔다. 이름으로 tool.search를 불러 정의를 얻는다.
// 문턱은 session을 시작할 때 router의 run-loop가 고정해 인자로 준다.

export const TOOL_SEARCH = "tool.search";

// 입력 schema JSON 길이를 4로 센다.
export function definitionTokens(definition: ToolDefinition): number {
  return Math.ceil(JSON.stringify(inputJsonSchema(definition)).length / 4);
}

// 목록 순서대로 token을 더하다가 문턱을 넘는 첫 정의부터 뒤는 전부 이름만 둔다. 같은 목록이면 같은 나눔이다.
// tool.search는 정의가 있어야 deferred를 불러올 수 있으므로 항상 정의 전체를 둔다.
export function splitDeferred(
  definitions: readonly ToolDefinition[],
  thresholdTokens: number,
): { full: readonly ToolDefinition[]; deferred: readonly ToolDefinition[] } {
  const full: ToolDefinition[] = [];
  const deferred: ToolDefinition[] = [];
  let used = 0;
  let over = false;
  for (const definition of definitions) {
    const tokens = definitionTokens(definition);
    if (definition.name === TOOL_SEARCH) {
      full.push(definition);
      used += tokens;
      continue;
    }
    if (over || used + tokens > thresholdTokens) {
      over = true;
      deferred.push(definition);
      continue;
    }
    full.push(definition);
    used += tokens;
  }
  return { full, deferred };
}
