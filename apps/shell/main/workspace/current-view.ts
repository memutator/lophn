// 요청 창의 현재 보기 상태를 renderer의 layout 힌트와 main의 실제 view
// registry·현재 scope 조합으로 만드는 순수 동작만 둔다(shell/workspace#R9).
// relay publish와 transport는 view-publish.ts가 한다.
// shell tsc는 packages를 보지 않으므로 값 모양은 contracts/shell/workspace.ts의
// 값과 같아야 한다(confirmation/types.ts와 같은 이유다).

import type { ViewContext, ViewRegistry, ViewScope } from "./kinds/kind.ts";
import { type HintTab, tabKindOf, type ViewTab } from "./kinds/registry.ts";

// 요약은 UTF-8 2048 bytes, 상세 탭은 한 page 20개다(shell/workspace#R10).
export const SUMMARY_MAX_BYTES = 2048;
export const TAB_PAGE_SIZE = 20;
// 화면 상태 문자열은 80자를 넘기면 원값 대신 줄인다(platform/redaction#R12).
export const VIEW_STRING_MAX_CHARS = 80;

export type ViewAvailability = "current" | "disconnected" | "unavailable";

// 허용 종류·대상 참조·선택 여부만이다. 본문·편집 초안·터미널 출력·DOM·screenshot은
// field로도 받지 않는다(shell/workspace#R10, R11). 종류별 모양은 kinds/<kind>.ts가 정한다.
export type { HintTab, ViewTab };

// 문서 선택은 판·절·줄 범위만이다. 선택 본문은 없다(shell/workspace#R9).
export type Selection = {
  document: string;
  version: string;
  section: string;
  start_line: number;
  end_line: number;
};

// 앱 상세 context는 apps/agent-context의 read command다. 여기에는 참조만 둔다.
export type AppView = {
  app: string;
  release: string;
  mode: "live" | "preview";
  surface: string;
  view_generation: number;
};

export type ViewOmission = {
  reason: string;
  truncated: boolean;
  next_page?: number;
};

export interface CurrentViewState {
  window_ref: string;
  generation: number;
  observed_at: string;
  project: string | null;
  tabs: ViewTab[];
  focused_pane: number | null;
  selection: Selection | null;
  app_view: AppView | null;
  availability: ViewAvailability;
  omissions: ViewOmission[];
}

// renderer가 보내는 layout 힌트. UI 참조만이고 무엇이 살아 있는지는 힌트가
// 정하지 않는다 — main의 registry·scope가 확정한다(architecture/shell 5.3).
export interface LayoutHint {
  window_ref: string;
  project: string | null;
  panes: readonly { tabs: readonly HintTab[]; selected: string | null }[];
  focused_pane: number | null;
  // 선택은 판·절·줄 범위 힌트다. 선택 본문은 힌트에 없다.
  selection?:
    | {
      document: string;
      version: string;
      section: string;
      start_line: number;
      end_line: number;
    }
    | null;
  // agent view를 연 app 탭의 key다. 없으면 app_view는 null이다.
  app_tab?: string | null;
}

// main의 실제 view registry. 창·앱 view는 힌트가 아니라 여기서 확정한다.
export type { ViewRegistry, ViewScope };

export interface ViewClock {
  now(): string;
}

const REF_MAX_CHARS = 80;

export type AssembleOutcome =
  | { ok: true; state: CurrentViewState }
  | { ok: false; reason: "unknown_window" };

/**
 * 등록되지 않은 창은 아무 상태도 만들지 않고, 힌트의 범위 밖 대상은 빼고
 * omission으로 표시한다(shell/workspace#R9, R10). generation은 publish가
 * 확정한다 — 자리는 0으로 둔다.
 */
export function assembleCurrentView(input: {
  hint: LayoutHint;
  registry: ViewRegistry;
  scope: ViewScope;
  observed_at: string;
}): AssembleOutcome {
  const ref = typeof input.hint?.window_ref === "string"
    ? input.hint.window_ref
    : "";
  if (ref === "" || !input.registry.isLive(ref)) {
    return { ok: false, reason: "unknown_window" };
  }
  const omissions: ViewOmission[] = [];
  const ctx: ViewContext = {
    scope: input.scope,
    registry: input.registry,
    truncate,
    refOk,
  };
  const tabs: ViewTab[] = [];
  let appView: AppView | null = null;
  for (const pane of input.hint.panes) {
    if (!pane || !Array.isArray(pane.tabs)) continue;
    for (const tab of pane.tabs) {
      if (!tab || typeof tab !== "object") continue;
      const selected = typeof pane.selected === "string" &&
        pane.selected === tab.key;
      const view = viewTabFor(tab, selected, ctx);
      if (view) tabs.push(view);
      else omissions.push({ reason: "target_out_of_scope", truncated: false });
      if (
        typeof input.hint.app_tab === "string" && input.hint.app_tab ===
          tab.key
      ) {
        appView = appViewFor(tab, input.registry, omissions);
      }
    }
  }
  let project: string | null = null;
  if (typeof input.hint.project === "string" && input.hint.project !== "") {
    if (input.scope.project(input.hint.project)) project = input.hint.project;
    else {
      omissions.push({ reason: "project_out_of_scope", truncated: false });
    }
  }
  const selection = selectionFor(input.hint, input.scope, omissions);
  const focused = typeof input.hint.focused_pane === "number" &&
      Number.isSafeInteger(input.hint.focused_pane) &&
      input.hint.focused_pane >= 0
    ? input.hint.focused_pane
    : null;
  return {
    ok: true,
    state: {
      window_ref: ref,
      generation: 0,
      observed_at: input.observed_at,
      project,
      tabs,
      focused_pane: focused,
      selection,
      app_view: appView,
      availability: "current",
      omissions,
    },
  };
}

function refOk(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= REF_MAX_CHARS;
}

/** 힌트 탭을 허용 종류와 현재 scope로 좁혀 참조만 남긴다. 판단은 kind의 선언이 한다. */
function viewTabFor(
  tab: HintTab,
  selected: boolean,
  ctx: ViewContext,
): ViewTab | null {
  const kind = tabKindOf(tab.kind);
  if (kind === undefined) return null;
  return kind.view(tab, selected, ctx) as ViewTab | null;
}

/** app_view의 release·mode·view generation은 registry의 현재 값이다. */
function appViewFor(
  tab: HintTab,
  registry: ViewRegistry,
  omissions: ViewOmission[],
): AppView | null {
  const live = tabKindOf(tab.kind)?.appView?.(tab, registry) ?? null;
  if (!live) {
    omissions.push({ reason: "app_not_live", truncated: false });
    return null;
  }
  return {
    app: live.app,
    release: live.release,
    mode: live.mode,
    surface: truncate(live.surface),
    view_generation: live.view_generation,
  };
}

function selectionFor(
  hint: LayoutHint,
  scope: ViewScope,
  omissions: ViewOmission[],
): Selection | null {
  const hinted = hint.selection;
  if (!hinted || typeof hinted !== "object") return null;
  const fields = typeof hinted.document === "string" &&
    typeof hinted.version === "string" && typeof hinted.section === "string" &&
    typeof hinted.start_line === "number" &&
    typeof hinted.end_line === "number" &&
    Number.isSafeInteger(hinted.start_line) &&
    Number.isSafeInteger(hinted.end_line) && hinted.start_line >= 1 &&
    hinted.end_line >= hinted.start_line;
  if (
    !fields || !refOk(hinted.document) || !refOk(hinted.version) ||
    hinted.section === "" || hinted.section.length > VIEW_STRING_MAX_CHARS ||
    !scope.allows("document", hinted.document)
  ) {
    omissions.push({ reason: "selection_out_of_scope", truncated: false });
    return null;
  }
  return {
    document: hinted.document,
    version: hinted.version,
    section: hinted.section,
    start_line: hinted.start_line,
    end_line: hinted.end_line,
  };
}

function truncate(value: string): string {
  return value.length <= VIEW_STRING_MAX_CHARS
    ? value
    : value.slice(0, VIEW_STRING_MAX_CHARS);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** 상세 탭은 한 page에 TAB_PAGE_SIZE개씩이다(shell/workspace#R10). */
export function pageTabs(tabs: readonly ViewTab[]): ViewTab[][] {
  const pages: ViewTab[][] = [];
  for (let start = 0; start < tabs.length; start += TAB_PAGE_SIZE) {
    pages.push(tabs.slice(start, start + TAB_PAGE_SIZE));
  }
  return pages;
}

export interface WorkspacePublishInput {
  window_ref: string;
  generation: number;
  observed_at: string;
  summary: string;
  tab_pages: ViewTab[][];
}

export type PublishBuild = {
  input: WorkspacePublishInput;
  omissions: ViewOmission[];
};

/**
 * relay publish 입력을 만든다. 요약은 UTF-8 2048 bytes 이하로 줄고 잘림·생략·
 * 관측 시각을 요약에 표시한다(shell/workspace#R10). 줄어든 대상은 omission이다.
 */
export function buildPublishInput(state: CurrentViewState): PublishBuild {
  const entries = state.tabs.map(
    (tab) => `${tab.kind}:${describeTab(tab)}`,
  );
  const capped = capSummary(entries, state);
  const omissions = [...state.omissions];
  if (capped.dropped > 0 || capped.over) {
    omissions.push({
      reason: "summary_truncated",
      truncated: true,
    });
  }
  return {
    input: {
      window_ref: state.window_ref,
      generation: state.generation,
      observed_at: state.observed_at,
      summary: capped.summary,
      tab_pages: pageTabs(state.tabs),
    },
    omissions,
  };
}

function describeTab(tab: ViewTab): string {
  return tabKindOf(tab.kind)?.describe(tab) ?? "";
}

/**
 * 요약의 고정 항목(project·focus·생략 수·관측 시각)은 항상 남기고 탭 항목을
 * 뒤에서부터 뺀다. 관측 시각(shell/workspace#R10)은 마지막까지 남는다.
 */
function capSummary(
  entries: readonly string[],
  state: CurrentViewState,
): { summary: string; dropped: number; over: boolean } {
  const fixed = [
    `project ${state.project ?? "none"}`,
  ];
  const tail = [
    `focused ${state.focused_pane === null ? "none" : state.focused_pane}`,
    `omitted ${state.omissions.length}`,
    `observed ${state.observed_at}`,
  ];
  const total = (list: readonly string[]) =>
    utf8Bytes([...fixed, ...list, ...tail].join("; "));
  let shown = entries.length;
  while (total(entries.slice(0, shown)) > SUMMARY_MAX_BYTES && shown > 0) {
    shown--;
  }
  const list = entries.slice(0, shown);
  const summary = [...fixed, ...list, ...tail].join("; ");
  return {
    summary,
    dropped: entries.length - shown,
    over: shown === 0 && total(entries) > SUMMARY_MAX_BYTES,
  };
}
