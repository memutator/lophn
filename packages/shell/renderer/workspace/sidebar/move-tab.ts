// session 탭을 다른 workspace로 옮긴다(탭 자리만). 탭 줄이나 sidebar의 session 줄을 다른 workspace 줄에 놓으면 쓴다.
// Agent 탭은 agent, session, 연 자리(`fields.workspace`)를 들고 있어 어느 workspace의 layout에 있어도 같은 session을 본다.
// 옮기는 것은 session이 아니라 탭이다: session은 그 workspace에 남고 sidebar 줄이 탭이 있는 workspace 아래로 간다.
import type { LayoutSource } from "../../shell/layout-source.ts";
import {
  allTabs,
  defaultWorkspaceLayout,
  openTabInLayout,
  workspaceKey,
  type WorkspaceRef,
} from "../../shell/desk-model.ts";
import { sessionOf } from "../agent/tab-fields.ts";
import type { TabItem } from "../model.ts";

/**
 * `from`의 탭을 `to`에 둘 모양. 옮길 수 없으면 null이다: session이 있는 Agent 탭만 옮기고, 같은 workspace는 뜻이 없고, 이 컴퓨터의
 * 탭은 다른 기계의 workspace에 둘 수 없다(탭의 `machine`은 다른 기계만 적고 이 컴퓨터를 적는 값이 없다).
 */
export function movedTab(
  tab: TabItem,
  from: WorkspaceRef,
  to: WorkspaceRef,
): TabItem | null {
  if (tab.kind !== "agent" || sessionOf(tab) === null) return null;
  if (workspaceKey(from) === workspaceKey(to)) return null;
  const on = tab.machine ?? from.machine ?? null;
  const target = to.machine ?? null;
  if (on === null && target !== null) return null;
  const { machine: _drop, ...rest } = tab;
  return on === target ? rest : { ...rest, machine: on! };
}

/** `to`의 layout에 탭을 열어 둔다(그 layout의 보이는 desk, 고른 탭). 아직 layout이 없는 workspace는 기본 layout에서 시작한다. */
export async function putTab(
  layout: LayoutSource,
  to: WorkspaceRef,
  tab: TabItem,
): Promise<boolean> {
  const read = await layout.readWorkspaceLayout(to);
  if (!read.ok) return false;
  const base = read.layout ?? defaultWorkspaceLayout();
  // 탭 key는 workspace 안에서 유일하다. 같은 key가 다른 session의 탭이면 그 탭을 고르게 되므로 key를 새로 짓는다.
  const used = new Set(
    allTabs(base)
      .filter((one) => sessionOf(one) !== sessionOf(tab))
      .map((one) => one.key),
  );
  let key = tab.key;
  for (let n = 2; used.has(key); n += 1) key = `${tab.key}-${n}`;
  const next = openTabInLayout(base, { ...tab, key });
  return (await layout.saveWorkspaceLayout(to, next)).ok;
}

/**
 * 탭 없이 도는 session(sidebar의 current 줄)을 옮길 때 새로 짓는 Agent 탭. `machine`은 session의 기계(이 컴퓨터는 null)이고
 * 다른 기계면 탭에 적는다. 옮길 자리의 기계와 맞추는 것은 `movedTab`이 한다.
 */
export function sessionTab(input: {
  readonly session: string;
  readonly agent: string;
  readonly workspace: string;
  readonly machine: string | null;
  readonly title: string;
}): TabItem {
  return {
    key: `agent:${input.agent}:${input.session.slice(-8)}`,
    kind: "agent",
    title: input.title,
    ...(input.machine === null ? {} : { machine: input.machine }),
    fields: {
      agent: input.agent,
      workspace: input.workspace,
      session: input.session,
    },
  };
}
