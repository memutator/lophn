// 탭을 다른 workspace로 옮긴다(탭 자리만). 탭 줄의 탭을 sidebar의 workspace 줄에 놓거나, sidebar의 줄을 화면이나 다른 workspace
// 줄에 놓으면 쓴다. kind를 가리지 않는다: 탭은 자기가 보는 것(파일 경로, 터미널 참조, session, URL)을 들고 있어 어느 workspace의
// layout에 있어도 같은 것을 본다. 옮기는 것은 탭이 놓이는 자리뿐이고 터미널의 cwd나 session의 workspace는 그대로다.
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

/** 탭이 보는 기계. 이 컴퓨터는 null이다. 다른 기계의 workspace에 둔 이 컴퓨터의 탭은 `machine`에 이 컴퓨터의 id를 든다. */
export function tabMachineOf(
  tab: TabItem,
  workspaceMachine: string | null,
  thisComputer: string | null,
): string | null {
  const machine = tab.machine ?? workspaceMachine;
  return machine === thisComputer ? null : machine;
}

/**
 * `from`의 탭을 `to`에 둘 모양. 같은 workspace면 null이다. 탭의 `machine`은 그 workspace의 기계와 다를 때만 적는다: 비면 그
 * workspace의 기계라서, 이 컴퓨터의 탭을 다른 기계의 workspace에 두면 이 컴퓨터의 id를 적는다(그 id를 모르면 옮기지 않는다).
 */
export function movedTab(
  tab: TabItem,
  from: WorkspaceRef,
  to: WorkspaceRef,
  thisComputer: string | null,
): TabItem | null {
  if (workspaceKey(from) === workspaceKey(to)) return null;
  const on = tabMachineOf(tab, from.machine ?? null, thisComputer);
  const target = to.machine ?? null;
  const { machine: _drop, ...rest } = tab;
  if (on === target) return rest;
  const stamp = on ?? thisComputer;
  return stamp === null ? null : { ...rest, machine: stamp };
}

/**
 * 같은 key의 탭이 그 layout에 이미 있을 때: 같은 것을 보는 탭(같은 kind이고 Agent 탭이면 같은 session)이면 그 탭을 고르고,
 * 다른 것이면 key를 새로 짓는다. 고정 key 탭(project settings 같은)은 같은 kind라 늘 있는 탭을 고른다.
 */
export function placedIn(base: readonly TabItem[], tab: TabItem): TabItem {
  const same = base.find((one) => one.key === tab.key);
  if (
    same === undefined ||
    (same.kind === tab.kind && sessionOf(same) === sessionOf(tab))
  ) {
    return tab;
  }
  const used = new Set(base.map((one) => one.key));
  let key = tab.key;
  for (let n = 2; used.has(key); n += 1) key = `${tab.key}-${n}`;
  return { ...tab, key };
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
  const next = openTabInLayout(base, placedIn(allTabs(base), tab));
  return (await layout.saveWorkspaceLayout(to, next)).ok;
}

/**
 * 탭 없이 도는 session(sidebar의 current 줄)을 옮기거나 화면에 놓을 때 새로 짓는 Agent 탭. `machine`은 session의 기계(이 컴퓨터는
 * null)이고 다른 기계면 탭에 적는다. 옮길 자리의 기계와 맞추는 것은 `movedTab`이 한다.
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
