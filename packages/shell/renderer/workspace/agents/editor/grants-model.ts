// 할당 화면의 순수한 계산. entries(계약의 AssignmentEntry 배열)에서 앱 줄의 상태를 읽고, 줄을 바꾼 새 entries를 만든다.
// 줄은 앱뿐이고 뺀 tool만 removed_tools에 든다.
import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { DomainView } from "../../source.ts";
import type { GrantApp } from "../source.ts";

/**
 * agent가 일할 domain의 이름. 고른 domain(id)이 없으면 그릇의 모든 domain이고, 그릇에 없는 id는 센 것에서 뺀다.
 * tool의 domain은 이름이라 이름으로 돌려준다.
 */
export function domainNamesOf(
  chosen: readonly string[],
  container: readonly DomainView[],
): string[] {
  return container
    .filter((one) => chosen.length === 0 || chosen.includes(one.id))
    .map((one) => one.name);
}

/**
 * 붙일 수 있는 앱 목록. agent가 일할 domain(이름)의 tool은 모두, 다른 domain의 tool은 public만 남기고, 남은 tool이
 * 없는 앱은 뺀다(domain 이름은 전체에서 하나라 다른 앱이나 그릇의 domain과 겹치지 않는다). 이미 붙은 entry는 건드리지 않는다:
 * 실행 때 목록에서 빠질 뿐이다.
 */
export function appsFor(
  apps: readonly GrantApp[],
  agentDomains: readonly string[],
): GrantApp[] {
  return apps.flatMap((app) => {
    const tools = app.tools.filter(
      (tool) => tool.public || agentDomains.includes(tool.domain),
    );
    return tools.length === 0 ? [] : [{ ...app, tools }];
  });
}

/** 같은 앱의 entry를 새 것으로 바꾸고, 없으면 끝에 더한다. */
export function setEntry(
  entries: readonly AssignmentEntry[],
  entry: AssignmentEntry,
): AssignmentEntry[] {
  const found = entries.some((one) => one.app === entry.app);
  return found
    ? entries.map((one) => (one.app === entry.app ? entry : one))
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
): AssignmentEntry | undefined => entries.find((one) => one.app === app);

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
