// 사람이 browser 탭을 이 기계의 열린 session에 넘기고 되찾는다. 넘겨도 탭의 자리·key·page·browser profile은 그대로이고 주인만
// 바뀐다: core 표에 오르고(`tabs/hand`) 탭 값에 `owner`·`handedTab`을 적는다. 되찾기는 그 둘을 지우는 것뿐이고, 창의 탭에서 core
// 탭 id가 사라지면 닫기와 같은 길로 core 표에서 빠진다(use-surface-requests.ts). core 표는 메모리라 창이 core에 다시 붙으면 넘긴
// 탭을 다시 알린다. core는 다시 알린 id를 그대로 믿으므로 `handedTab`이 있는 탭만 알린다.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { WorkspaceRef } from "../shell/desk-model.ts";
import { hostTabOf, type TabItem } from "./model.ts";

/** 탭 값 고치기(layout의 `patchTab`, 전역 float의 `patch`). */
type Patch = (key: string, patch: Partial<TabItem>) => void;

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

function handInput(
  tab: TabItem,
  session: string,
  workspace: WorkspaceRef,
): Record<string, unknown> {
  const id = hostTabOf(tab);
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

/** 탭을 session에 넘긴다. core가 받으면 탭에 주인과 core 탭 id를 적고 true다. 거절이나 실패는 탭을 그대로 두고 false다. */
export async function handTab(
  core: Pick<CoreSource, "call">,
  tab: TabItem,
  session: string,
  workspace: WorkspaceRef,
  patch: Patch,
): Promise<boolean> {
  if (!canHand(tab)) return false;
  const reply = await core
    .call({
      kind: "memory",
      resource: "tabs",
      method: "hand",
      body: handInput(tab, session, workspace),
    })
    .catch(() => null);
  const handed = (reply?.value as { tab?: unknown } | undefined)?.tab;
  if (reply?.ok !== true || typeof handed !== "string") return false;
  patch(tab.key, { owner: session, handedTab: handed });
  return true;
}

/** 넘긴 탭을 사람에게 되돌린다. core에는 창의 탭에서 id가 사라진 것으로 알려진다. */
export function takeBack(patch: Patch, key: string): void {
  patch(key, { owner: undefined, handedTab: undefined });
}

/**
 * 창이 layout을 다 읽었거나 core에 다시 붙었을 때 넘긴 탭을 core 표에 다시 올린다. 주인 session이 끝났거나(`not_found`) core가 그
 * id를 넘긴 탭으로 받지 않으면(`conflict`) 그 탭을 사람에게 되돌린다. 그 밖의 실패(core가 아직 없음)는 다음 ready에 다시 한다.
 */
export function announceHanded(
  core: Pick<CoreSource, "call">,
  tabs: readonly {
    readonly tab: TabItem;
    readonly workspace: WorkspaceRef;
    readonly patch: Patch;
  }[],
): void {
  for (const { tab, workspace, patch } of tabs) {
    if (
      tab.kind !== "browser" ||
      tab.handedTab === undefined ||
      tab.owner === undefined
    ) {
      continue;
    }
    void core
      .call({
        kind: "memory",
        resource: "tabs",
        method: "hand",
        body: handInput(tab, tab.owner, workspace),
      })
      .then(
        (reply) => {
          const code = reply.error?.code;
          if (!reply.ok && (code === "not_found" || code === "conflict")) {
            takeBack(patch, tab.key);
          }
        },
        () => {},
      );
  }
}
