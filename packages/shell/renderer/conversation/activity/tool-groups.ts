// tool call을 줄로 묶는다. 도는 중(agent-tab-data.ts)과 snapshot(agent-tab-core-source-thread.ts)이 같은 함수를
// 써서 turn이 끝날 때 화면이 뛰지 않는다. 순수 함수이고 문구는 그리는 쪽이 정한다.
import type { ThreadEntry } from "../agent-tab-source.ts";
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

/** 묶음마다 `tools` 줄 하나. `at`은 첫 call의 시각이고 모르면 인자다. */
export function toolEntriesOf(
  calls: readonly ToolCallView[],
  at: string,
): ThreadEntry[] {
  return groupToolCalls(calls).map((group) => ({
    kind: "tools",
    id: group[0]!.id,
    at: group[0]!.startedAt ?? at,
    calls: group,
  }));
}
