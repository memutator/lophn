// 다른 컴퓨터 앱 할당 화면의 순수한 계산. entries(계약의 AssignmentEntry 배열)에서 앱 줄의 상태를 읽고, 줄을 바꾼 새 entries를 만든다.
// 줄은 (컴퓨터, 앱)이고 뺀 tool만 removed_tools에 든다.
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { GrantApp } from "../source.ts";

/**
 * 다른 컴퓨터의 앱 가운데 붙일 수 있는 것. public tool만 남기고, 남은 tool이 없는 앱은 뺀다(받는 컴퓨터가 비공개 command를 거절한다).
 * 이미 붙은 entry는 건드리지 않는다: 실행 때 목록에서 빠질 뿐이다.
 */
export function appsFor(apps: readonly GrantApp[]): GrantApp[] {
  return apps.flatMap((app) => {
    const tools = app.tools.filter((tool) => tool.public);
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

/** 이 컴퓨터의 앱 줄이다. 다른 컴퓨터의 앱 줄은 machine을 준다. */
export const appEntryOf = (
  entries: readonly AssignmentEntry[],
  app: string,
  machine?: string,
): AssignmentEntry | undefined =>
  entries.find((one) => one.app === app && one.machine === machine);

export const isRemoved = (entry: AssignmentEntry, tool: string): boolean =>
  entry.removed_tools.includes(tool);

export const isAsk = (entry: AssignmentEntry, tool: string): boolean =>
  entry.ask_tools?.includes(tool) === true;

/** tool 하나를 뺐거나 다시 넣은 앱 entry. removed_tools와 ask_tools는 겹치지 않는다. */
export function withToolRemoved(
  entry: AssignmentEntry,
  tool: string,
  removed: boolean,
): AssignmentEntry {
  const rest = entry.removed_tools.filter((one) => one !== tool);
  const nextRemoved = removed ? [...rest, tool] : rest;
  if (!removed || entry.ask_tools === undefined) {
    return { ...entry, removed_tools: nextRemoved };
  }
  const nextAsk = entry.ask_tools.filter((one) => one !== tool);
  const { ask_tools: _old, ...base } = entry;
  return {
    ...base,
    removed_tools: nextRemoved,
    ...(nextAsk.length > 0 ? { ask_tools: nextAsk } : {}),
  };
}

/** tool 하나의 실행 전 묻기(ask)를 켜거나 끈 앱 entry. ask를 켜면 removed_tools에서 뺀다. */
export function withToolAsk(
  entry: AssignmentEntry,
  tool: string,
  ask: boolean,
): AssignmentEntry {
  const restAsk = (entry.ask_tools ?? []).filter((one) => one !== tool);
  const nextAsk = ask ? [...restAsk, tool] : restAsk;
  const nextRemoved = ask
    ? entry.removed_tools.filter((one) => one !== tool)
    : entry.removed_tools;
  const { ask_tools: _old, ...base } = entry;
  return {
    ...base,
    removed_tools: nextRemoved,
    ...(nextAsk.length > 0 ? { ask_tools: nextAsk } : {}),
  };
}
