// 사람이 browser 탭을 이 기계의 열린 session에 넘기고 되찾는다. 넘겨도 탭의 자리·key·page·browser profile은 그대로이고 주인만
// 바뀐다: core 표에 오르고(`tabs/hand`) 탭 값에 `owner`·`handedTab`을 적는다. 되찾기는 그 둘을 지우고 그 core 탭 id를 `closed`로
// 알린다(main이 bind와 take control을 잊고 driver가 debugger를 떼며 core가 표에서 뺀다). 창의 탭에서 id가 사라지면 같은 알림이 한
// 번 더 가지만 해가 없다. core 표는 메모리라 창이 core에 다시 붙으면 넘긴 탭을 다시 알린다. core는 다시 알린 id를 그대로 믿으므로
// `handedTab`과 `owner`가 둘 다 있는 탭만 알린다.
// 경합으로 core 표에 page 없는 항목이 잠깐 남을 수 있다(되찾음과 같은 때 온 호출 등). 그 항목에 온 agent 호출은 main이 page를 찾지
// 못해 "page is gone"으로 끝나고 agent는 그 탭을 다루지도 닫지도 못한다. 그래서 따로 막지 않는다.
import { createContext } from "react";

import type { LophnSurfaceApi } from "../../ipc/surface.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { mapLayoutTabs, type WorkspaceRef } from "../shell/desk-model.ts";
import type { LayoutSource } from "../shell/layout-source.ts";
import { hostTabOf, type TabItem } from "./model.ts";

/** 탭 값 고치기(layout의 `patchTab`, 전역 float의 `patch`). */
type Patch = (key: string, patch: Partial<TabItem>) => void;
/** core 탭 id가 닫혔다고(core 표에서 빼라고) 알린다. */
type Report = (tab: string) => void;

/** 창의 surface 통로로 `closed`를 알린다. 통로가 없으면(gallery, 테스트) 아무것도 하지 않는다. */
export function reportClosed(tab: string): void {
  const surface = (globalThis as { lophnSurface?: LophnSurfaceApi })
    .lophnSurface;
  void surface?.report({ tab, state: "closed" });
}

/**
 * 넘길 수 있는 탭: browser 탭이고 잠깐 뜬 탭(transient)·크기 준 popup(native view)이 아니며, 사람이 연 탭이다(이미 넘긴 탭은 다른
 * session에 다시 넘긴다). `tab open`으로 연 탭(key `host:`)은 이미 core 표의 탭이라 넘기지 않는다: agent가 연 탭은 그 session의
 * 것이고, 사람 token이 연 탭은 되찾을 때 core 표에서 뺄 길(key에서 id가 사라짐)이 없다.
 */
export function canHand(tab: TabItem): boolean {
  return (
    tab.kind === "browser" &&
    tab.transient !== true &&
    tab.fields?.native !== true &&
    hostTabOf({ key: tab.key }) === null
  );
}

/** Hand to 하위 menu의 줄 하나. 얼굴은 그 session의 주인 avatar다. */
export interface HandTarget {
  readonly session: string;
  readonly name: string;
}

/**
 * "Hand to"의 상대: 이 컴퓨터의 열린 lophn session이다(끝났거나 보관했거나 agent가 없는 것, 지금 주인은 뺀다). `workspace`의 것이
 * 먼저다. 끌어 놓는 자리(session 줄, 주인 chip)도 이 목록의 session만 받는다.
 */
export function handTargets(
  entries: readonly SessionEntry[],
  workspace: WorkspaceRef,
  owner: string | undefined,
  nameOf: (session: string) => string,
): HandTarget[] {
  const open = entries.filter(
    (entry) =>
      entry.ended === null &&
      !entry.archived &&
      entry.agent !== null &&
      entry.session !== owner,
  );
  const here = (entry: SessionEntry) =>
    workspace.kind === "home"
      ? entry.workspace === null
      : entry.workspace?.kind === workspace.kind &&
        entry.workspace.id === workspace.id;
  return [...open.filter(here), ...open.filter((entry) => !here(entry))].map(
    (entry) => ({ session: entry.session, name: nameOf(entry.session) }),
  );
}

/** 끌어 온 탭을 그 session에 놓을 수 있는가: 넘길 수 있는 탭이고 그 session이 "Hand to"의 상대 가운데 있다. */
export function canDropOn(
  tab: TabItem,
  session: string,
  targets: readonly HandTarget[],
): boolean {
  return canHand(tab) && targets.some((target) => target.session === session);
}

/**
 * 창이 끌기 자리로 표시할 session(이 컴퓨터의 열린 lophn session). 창(workspace 창)이 주고 sidebar의 session 줄과 주인 chip이 읽는다.
 * 없으면(다른 기계의 workspace, gallery) 아무 줄도 표시하지 않는다.
 */
export const HandSessionsContext = createContext<ReadonlySet<string> | null>(
  null,
);

function handInput(
  tab: TabItem,
  session: string,
  workspace: WorkspaceRef,
  id: string | null,
): Record<string, unknown> {
  const profile = tab.fields?.profile;
  const url = tab.fields?.url;
  return {
    ...(id === null ? {} : { tab: id }),
    session,
    workspace:
      workspace.kind === "home"
        ? { kind: "home" }
        : { kind: workspace.kind, id: workspace.id },
    ...(typeof profile === "string" ? { profile } : {}),
    url: typeof url === "string" ? url : "",
  };
}

/**
 * 탭을 session에 넘긴다. 늘 새 core 탭 id로 넘긴다: 다른 session에 다시 넘길 때 앞 session의 손(take control 상태, 돌고 있던 호출)이
 * 새 주인에게 이어지지 않게 core가 받은 뒤 옛 id를 `closed`로 알리고 탭에 새 주인과 id를 적는다. 거절이나 실패는 탭과 앞 주인의 손을
 * 그대로 두고 false다.
 */
export async function handTab(
  core: Pick<CoreSource, "call">,
  tab: TabItem,
  session: string,
  workspace: WorkspaceRef,
  patch: Patch,
  report: Report = reportClosed,
): Promise<boolean> {
  if (!canHand(tab)) return false;
  const reply = await core
    .call({
      kind: "memory",
      resource: "tabs",
      method: "hand",
      body: handInput(tab, session, workspace, null),
    })
    .catch(() => null);
  const handed = (reply?.value as { tab?: unknown } | undefined)?.tab;
  if (reply?.ok !== true || typeof handed !== "string") return false;
  if (tab.handedTab !== undefined) report(tab.handedTab);
  patch(tab.key, { owner: session, handedTab: handed });
  return true;
}

/** 넘긴 탭을 사람에게 되돌린다. 탭의 주인과 core 탭 id를 지우고 그 id를 바로 `closed`로 알린다(agent가 곧바로 손을 뗀다). */
export function takeBack(
  tab: TabItem,
  patch: Patch,
  report: Report = reportClosed,
): void {
  patch(tab.key, { owner: undefined, handedTab: undefined });
  if (tab.handedTab !== undefined) report(tab.handedTab);
}

/**
 * 창이 layout을 다 읽었거나 core에 다시 붙었을 때 넘긴 탭을 core 표에 다시 올린다. 주인 session이 끝났거나(`not_found`) core가 그
 * id를 넘긴 탭으로 받지 않으면(`conflict`) 그 탭을 사람에게 되돌린다. 그 밖의 실패(core가 아직 없음)는 다음 ready에 다시 한다.
 */
export async function announceHanded(
  core: Pick<CoreSource, "call">,
  tabs: readonly {
    readonly tab: TabItem;
    readonly workspace: WorkspaceRef;
    readonly patch: Patch;
  }[],
  report: Report = reportClosed,
): Promise<void> {
  await Promise.all(
    tabs.map(async ({ tab, workspace, patch }) => {
      if (
        tab.kind !== "browser" ||
        tab.handedTab === undefined ||
        tab.owner === undefined
      ) {
        return;
      }
      const reply = await core
        .call({
          kind: "memory",
          resource: "tabs",
          method: "hand",
          body: handInput(tab, tab.owner, workspace, tab.handedTab),
        })
        .catch(() => null);
      const code = reply?.error?.code;
      if (
        reply?.ok === false &&
        (code === "not_found" || code === "conflict")
      ) {
        takeBack(tab, patch, report);
      }
    }),
  );
}

/**
 * 상한으로 page를 놓은 넘긴 탭을 저장된 layout에서도 사람의 탭으로 돌린다(그 workspace가 mount되기 전에 창이 닫혀도 다음 시작이 다시
 * 알리지 않게). 읽기·쓰기가 실패하면 그대로 둔다: 다음 mount가 메모리의 목록으로 지우고, 그 전에 다시 알리면 core가 page 없는 탭을 든다.
 */
export async function releaseStored(
  layout: LayoutSource,
  workspace: WorkspaceRef,
  key: string,
): Promise<void> {
  const read = await layout.readWorkspaceLayout(workspace).catch(() => null);
  if (read?.ok !== true || read.layout === null) return;
  const next = mapLayoutTabs(read.layout, (tab) =>
    tab.key === key && tab.handedTab !== undefined
      ? { ...tab, owner: undefined, handedTab: undefined }
      : tab,
  );
  if (next !== read.layout) {
    await layout.saveWorkspaceLayout(workspace, next).catch(() => null);
  }
}
