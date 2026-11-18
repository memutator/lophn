// 할당 화면의 순수한 계산. entries(계약의 AssignmentEntry 배열)에서 앱 줄의 상태를 읽고, 줄을 바꾼 새 entries를 만든다.
// 줄은 앱뿐이고 뺀 tool만 removed_tools에 든다.
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { GrantApp } from "../source.ts";

/**
 * 붙일 수 있는 앱 목록. agent가 일하는 자리가 그 앱이면 tool은 모두, 다른 앱은 public만 남기고, 남은 tool이
 * 없는 앱은 뺀다. 이미 붙은 entry는 건드리지 않는다: 실행 때 목록에서 빠질 뿐이다.
 */
export function appsFor(
  apps: readonly GrantApp[],
  workspace: string | null,
): GrantApp[] {
  return apps.flatMap((app) => {
    const tools = app.tools.filter(
      (tool) => tool.public || app.app === workspace,
    );
    return tools.length === 0 ? [] : [{ ...app, tools }];
  });
}

/** 줄은 (기계, 앱)이다. 다른 기계의 같은 앱 id의 줄은 이 기계의 줄이 아니다. */
const sameLine = (a: AssignmentEntry, b: AssignmentEntry): boolean =>
  a.app === b.app && a.machine === b.machine;

/** 같은 줄(기계와 앱)의 entry를 새 것으로 바꾸고, 없으면 끝에 더한다. */
export function setEntry(
  entries: readonly AssignmentEntry[],
  entry: AssignmentEntry,
): AssignmentEntry[] {
  const found = entries.some((one) => sameLine(one, entry));
  return found
    ? entries.map((one) => (sameLine(one, entry) ? entry : one))
    : [...entries, entry];
}

export function dropEntries(
  entries: readonly AssignmentEntry[],
  keep: (entry: AssignmentEntry) => boolean,
): AssignmentEntry[] {
  return entries.filter(keep);
}

export const appEntryOf = (
  entries: readonly AssignmentEntry[],
  app: string,
): AssignmentEntry | undefined =>
  entries.find((one) => one.app === app && one.machine === undefined);

export const isRemoved = (entry: AssignmentEntry, tool: string): boolean =>
  entry.removed_tools.includes(tool);

/** tool 하나를 뺐거나 다시 넣은 앱 entry. removed_tools에 겹쳐 들지 않는다. */
export function withToolRemoved(
  entry: AssignmentEntry,
  tool: string,
  removed: boolean,
): AssignmentEntry {
  const rest = entry.removed_tools.filter((one) => one !== tool);
  return { ...entry, removed_tools: removed ? [...rest, tool] : rest };
}
