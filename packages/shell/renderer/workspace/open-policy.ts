// 탭 안에서 연 것(터미널·coding agent의 문서 경로와 URL, lophn agent의 파일 link와 실행 단추)이 열릴 자리.
// 여는 쪽은 자리를 스스로 정하지 않고 여기 묻는다. 이미 열린 탭을 보이는 일(다른 desk, floated, detached)은
// `openTab`이 한다. 여기는 새 탭의 자리만 정한다.
import { findTab, type WorkspaceView } from "./model.ts";

/** show: 문서·browser 탭처럼 보는 것. run: 실행을 지켜보는 터미널(코드 블록의 실행 단추). */
export type OpenIntent = "show" | "run";

/** pane: `after`가 있으면 그 탭이 있는 pane의 그 탭 바로 뒤, 없으면 focus pane 끝. */
export type OpenAt =
  | { readonly kind: "float" }
  | { readonly kind: "pane"; readonly after?: string };

/**
 * 연 탭(source)이 있는 자리로 새 탭의 자리를 정한다.
 * - run은 floated다. 실행을 보고 닫는 잠깐의 터미널이라 pane 배치를 바꾸지 않는다.
 * - source가 보이는 desk에 없으면 source 바로 뒤다. `openTab`이 그 desk로 건너간다.
 * - source가 pane에 있고 pane이 둘이면 반대쪽 pane 끝이다. source(agent, 터미널)를 가리지 않는다.
 * - pane이 하나면 source 바로 뒤다. 자동으로 나누면 layout이 바뀐다.
 * - source가 floated·minimized·detached이거나 없으면 focus pane 끝이다. 패널과 창은 그대로 둔다.
 */
export function openAt(
  view: WorkspaceView,
  source: string | undefined,
  intent: OpenIntent,
): OpenAt {
  if (intent === "run") return { kind: "float" };
  if (source === undefined) return { kind: "pane" };
  if (findTab(view, source) === undefined)
    return { kind: "pane", after: source };
  const at = view.panes.findIndex((pane) =>
    pane.tabs.some((tab) => tab.key === source),
  );
  if (at < 0) return { kind: "pane" };
  if (view.panes.length !== 2) return { kind: "pane", after: source };
  return {
    kind: "pane",
    after: view.panes[1 - at]!.tabs.at(-1)?.key ?? source,
  };
}

/** show 자리의 `openTab` option. */
export function showAfter(
  view: WorkspaceView,
  source: string | undefined,
): { readonly after?: string } {
  const at = openAt(view, source, "show");
  return at.kind === "pane" && at.after !== undefined
    ? { after: at.after }
    : {};
}
