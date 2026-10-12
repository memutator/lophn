// search 탭 kind. context 하나의 선언된 검색을 채운 입력으로 연다. 입력은
// 사람이 채운 조건일 뿐이라 현재 보기에는 선언된 검색의 key만 보내고 복원하면 검색을 다시 계산한다.
import { paletteIcons } from "../../icons/mod.ts";

import { SearchTab } from "../contexts/search-tab.tsx";
import { searchTabTitle } from "../contexts/settle-tabs.ts";
import type { SearchTabState } from "../contexts/search-tab.tsx";
import {
  CONTEXT_ID,
  inputsFit,
  SAVED_VIEW_ID,
  searchFields,
  searchStateOf,
  TAB_KEY,
} from "../contexts/tab-fields.ts";
import type { SearchInputValues } from "../contexts/source.ts";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openContext } from "./context.tsx";
import { openContexts } from "./contexts.tsx";

let searchCount = 0;

function searchTitle(host: TabHost, context: string): string {
  return searchTabTitle(host.contexts?.titleOf(context));
}

/** 새 Search 탭을 연다. 채운 입력과 저장한 보기는 state에 담아 넘긴다. */
export function openSearch(host: TabHost, state: SearchTabState): void {
  const key = `search-${Date.now().toString(36)}-${++searchCount}`;
  host.openTab({
    key,
    kind: "search",
    title: searchTitle(host, state.context),
    fields: searchFields(state),
  });
}

/**
 * 고른 검색이나 저장한 보기를 그 context의 Search 탭에서 연다. 그 context의 Search 탭이 열려 있으면 새 탭
 * 대신 그 탭을 골라 검색을 바꾸고, 없으면 새로 연다.
 */
export function openSearchFor(host: TabHost, state: SearchTabState): void {
  const open = host.view.panes.flatMap((pane) => pane.tabs).find((tab) =>
    tab.kind === "search" && searchStateOf(tab)?.context === state.context
  );
  if (open === undefined) {
    openSearch(host, state);
    return;
  }
  host.openTab(open);
  host.patchTab(open.key, (tab) => ({
    title: searchTitle(host, state.context),
    // nonce가 바뀌면 탭 본문이 새 입력으로 처음부터 시작한다.
    fields: {
      ...searchFields(state),
      nonce: (typeof tab.fields?.nonce === "number" ? tab.fields.nonce : 0) + 1,
    },
  }));
}

/**
 * 바로 가기 rail과 `+`가 부르는 Search 탭 열기. 열려 있는 Search 탭이 있으면 그 탭을 고르고,
 * 없으면 지금 보는 Context 탭의 context로(없으면 목록의 첫 context로) 연다. context가 하나도
 * 없으면 Search 탭이 보일 대상이 없어 Contexts 탭이 대신 열린다.
 */
export function openSearchShortcut(host: TabHost): void {
  const open = host.view.panes.flatMap((pane) => pane.tabs).find((tab) =>
    tab.kind === "search"
  );
  if (open !== undefined) {
    host.openTab(open);
    return;
  }
  const focused = host.view.panes[host.view.focusedPane];
  const selected = focused?.tabs.find((tab) => tab.key === focused.selected);
  const viewed = selected?.kind === "context"
    ? (selected.fields?.context as string | undefined)
    : undefined;
  const context = viewed ?? host.contexts?.list[0]?.id;
  if (context === undefined) {
    openContexts(host);
    return;
  }
  openSearch(host, {
    context,
    search: null,
    inputs: {},
    page: 0,
    savedView: null,
  });
}

function titleOf(tab: TabItem, host: TabHost): string {
  const state = searchStateOf(tab);
  return state === null ? tab.title : searchTitle(host, state.context);
}

export const searchKind: TabKindDef = {
  kind: "search",
  labelKey: "contexts.label.rail-search",
  icon: paletteIcons.search,
  fromStored(stored, { key }) {
    const { context, declared_search, inputs, page, saved_view } = stored;
    if (typeof context !== "string" || !CONTEXT_ID.test(context)) return null;
    return {
      key,
      kind: "search",
      title: "",
      fields: {
        context,
        declared_search: typeof declared_search === "string"
          ? declared_search
          : null,
        inputs: typeof inputs === "object" && inputs !== null ? inputs : {},
        page: typeof page === "number" ? page : 0,
        saved_view: typeof saved_view === "string" ? saved_view : null,
      },
    };
  },
  toStored(tab) {
    const state = searchStateOf(tab);
    if (state === null || !TAB_KEY.test(tab.key)) return null;
    if (state.search !== null && state.search.length > 128) return null;
    const inputs: SearchInputValues = inputsFit(state.inputs)
      ? state.inputs
      : {};
    return {
      kind: "search",
      key: tab.key,
      context: state.context,
      declared_search: state.search,
      inputs,
      page: state.page,
      saved_view: state.savedView !== null &&
          SAVED_VIEW_ID.test(state.savedView)
        ? state.savedView
        : null,
    };
  },
  // 채운 입력과 결과는 힌트에 넣지 않는다. context와 선언된 검색의 key만이다.
  hint(tab) {
    const state = searchStateOf(tab);
    if (state === null) return null;
    return {
      kind: "search",
      key: tab.key,
      context: state.context,
      ...(state.search === null ? {} : { declared_search: state.search }),
    };
  },
  render(tab, _active, host) {
    const contexts = host.contexts;
    const state = searchStateOf(tab);
    if (contexts === null || state === null) return null;
    return (
      <SearchTab
        key={`${tab.key}:${tab.fields?.nonce ?? 0}`}
        project={host.projectId}
        source={contexts.source}
        state={state}
        // 입력은 타이핑마다 바뀌니 저장을 잠깐 모은다.
        onState={(next) =>
          host.patchTab(tab.key, (current) => ({
            title: titleOf({ ...current, fields: searchFields(next) }, host),
            // nonce는 그대로 둬 입력을 바꿀 때마다 본문이 다시 서지 않게 한다.
            fields: { ...current.fields, ...searchFields(next) },
          }), { later: true })}
        onOpenContext={(context) => openContext(host, context)}
        onOpenDocument={contexts.openPath}
        onAsk={contexts.askContextEngineer}
      />
    );
  },
  launcher: {
    labelKey: "contexts.label.rail-search",
    available: (host) => host.contexts !== null,
    open: openSearchShortcut,
  },
};
