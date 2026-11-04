// tool call을 줄로 묶는다. 순수 함수이고 문구는 그리는 쪽이 정한다.
import type { ToolCallView } from "./model.ts";

/** 묶는 열쇠: 탐색(read·list·search)은 하나이고 other는 tool 이름까지 같아야 한다. */
function groupKeyOf(call: ToolCallView): string {
  switch (call.category) {
    case "read":
    case "list":
    case "search":
      return "explore";
    case "other":
      return `other:${call.tool}`;
    default:
      return call.category;
  }
}

/** 차례를 지키고 열쇠가 같은 이웃 call을 한 묶음으로 둔다. */
export function groupToolCalls(
  calls: readonly ToolCallView[],
): ToolCallView[][] {
  const groups: ToolCallView[][] = [];
  let key: string | null = null;
  for (const call of calls) {
    const next = groupKeyOf(call);
    if (next === key) groups.at(-1)!.push(call);
    else groups.push([call]);
    key = next;
  }
  return groups;
}
