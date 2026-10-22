// 자리(desk)마다 다른 layout을 가진 고정 data. 자리를 바꾸면 pane의 탭, floated 패널, 접힌 span이 통째로 바뀐다.
import type {
  FloatItem,
  TabItem,
  WorkspaceView,
} from "../../../../../packages/shell/renderer/workspace/model.ts";
import type { DeskOption } from "../../../../../packages/shell/renderer/workspace/top-path/desk-selector.tsx";

const doc = (path: string): TabItem => ({
  key: path,
  kind: "document_editor",
  title: path.split("/").pop() ?? path,
});
const terminal = (key: string, title: string): TabItem => ({
  key,
  kind: "terminal",
  title,
});

const AT = { x: 40, y: 40, width: 360, height: 240 };
const float = (
  tab: TabItem,
  rect: FloatItem["rect"] = AT,
  minimized = false,
): FloatItem => ({ tab, rect, minimized, originPane: 0 });

const view = (
  tabs: readonly TabItem[],
  floats: readonly FloatItem[] = [],
  second: readonly TabItem[] = [],
): WorkspaceView => ({
  panes: [
    { tabs, selected: tabs[0]?.key ?? null },
    ...(second.length === 0
      ? []
      : [{ tabs: second, selected: second[0]!.key }]),
  ],
  splitRatio: 0.5,
  focusedPane: 0,
  floats,
  detached: [],
});

export const DEFAULT_KEY = "_default";

export const DESK_MAIN: DeskOption = { key: DEFAULT_KEY, label: "Main" };
export const DESK_RELEASE: DeskOption = {
  key: "release-notes",
  label: "release-notes",
};
export const DESK_TRIAGE: DeskOption = { key: "triage", label: "triage" };
// 선언이 틀린 workflow. 시작은 못 해도 자리는 열 수 있다.
export const DESK_NIGHTLY: DeskOption = {
  key: "nightly-eval",
  label: "nightly-eval",
  invalid: true,
};

/** workflow가 없는 project. */
export const OPTIONS_NONE: readonly DeskOption[] = [DESK_MAIN];
export const OPTIONS_ALL: readonly DeskOption[] = [
  DESK_MAIN,
  DESK_RELEASE,
  DESK_TRIAGE,
  DESK_NIGHTLY,
];
// 목록 읽기가 실패하면 기본 자리와 이미 layout에 있는 자리만 남는다.
export const OPTIONS_FAILED: readonly DeskOption[] = [DESK_MAIN, DESK_TRIAGE];

export const LAYOUTS: Readonly<Record<string, WorkspaceView>> = {
  [DEFAULT_KEY]: view(
    [doc("docs/notes.md"), doc("LOPHN.md")],
    [float(doc("loop/findings/F-009.md"), {
      x: 120,
      y: 60,
      width: 520,
      height: 320,
    })],
  ),
  "release-notes": view(
    [
      doc("eval/experiments/exp-008-query-tools.md"),
      doc("eval/rubrics/query-hygiene.json"),
    ],
    [
      float(terminal("term_release", "release"), {
        x: 200,
        y: 90,
        width: 520,
        height: 300,
      }),
      float(doc("docs/notes.md"), AT, true),
      float(doc("LOPHN.md"), AT, true),
      float(doc("loop/findings/F-009.md"), AT, true),
    ],
    [doc("eval/scenarios/query-leave-still/r1.yaml")],
  ),
  triage: view(
    [doc("loop/findings/F-009.md")],
    [float(doc("docs/notes.md"), AT, true)],
  ),
  // 아직 아무 탭도 열지 않은 자리.
  "nightly-eval": view([]),
};
