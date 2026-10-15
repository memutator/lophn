// search 탭 kind. 두 갈래를 그린다. `context`가 있으면 그 context의 선언된 검색을 채운 입력으로
// 열고, 없으면 project 키워드 검색이다. 입력은 사람이 채운 조건일 뿐이라 현재 보기에는 선언된
// 검색의 key만 보내고 복원하면 검색을 다시 계산한다.
import { t } from "@lophn/wording";

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
import { FileSearch } from "../search/file-search.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openContext } from "./context.tsx";

let searchCount = 0;

const QUERY_MAX = 200;

/** context 없이 열린 키워드 검색 탭의 검색어와 폴더(절대 경로, 없으면 빈 글). */
function keywordOf(tab: TabItem): { query: string; folder: string } {
  const { query, folder } = tab.fields ?? {};
  return {
    query: typeof query === "string" ? query : "",
    folder: typeof folder === "string" ? folder : "",
  };
}

const isKeyword = (tab: TabItem) =>
  tab.kind === "search" && searchStateOf(tab) === null;

function openKeywordSearch(host: TabHost): void {
  host.openTab({
    key: `search-${Date.now().toString(36)}-${++searchCount}`,
    kind: "search",
    title: t("file-search.label.tab"),
    fields: { query: "", folder: "" },
  });
}

/**
 * 검색 결과의 줄에서 파일을 연다. 탭 key는 파일 경로다. 이미 열려 있으면 그 탭을 고르고 줄만 바꾼다.
 * 열린 탭이 그 줄로 scroll하는 것은 파일 탭이 한다.
 */
function openFileAt(host: TabHost, path: string, line: number): void {
  const open = host.view.panes.flatMap((pane) => pane.tabs).find((tab) =>
    tab.kind === "document_editor" && tab.key === path
  );
  if (open === undefined) {
    host.openTab({
      key: path,
      kind: "document_editor",
      title: path.split("/").at(-1) ?? path,
      fields: { line },
    });
    return;
  }
  host.openTab(open);
  host.patchTab(path, (tab) => ({ fields: { ...tab.fields, line } }));
}

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
 * 바로 가기 rail과 `+`가 부르는 Search 탭 열기. 키워드 검색 탭이 열려 있으면 그 탭을 고르고
 * 없으면 새로 연다. context가 필요 없다.
 */
export function openSearchShortcut(host: TabHost): void {
  const open = host.view.panes.flatMap((pane) => pane.tabs).find(isKeyword);
  if (open !== undefined) {
    host.openTab(open);
    return;
  }
  openKeywordSearch(host);
}

function titleOf(tab: TabItem, host: TabHost): string {
  const state = searchStateOf(tab);
  return state === null ? tab.title : searchTitle(host, state.context);
}

export const searchKind: TabKindDef = {
  kind: "search",
  labelKey: "file-search.label.tab",
  icon: paletteIcons.search,
  fromStored(stored, { key }) {
    const { context, declared_search, inputs, page, saved_view } = stored;
    if (context === undefined) {
      const { query, folder } = stored;
      return {
        key,
        kind: "search",
        title: t("file-search.label.tab"),
        fields: {
          query: typeof query === "string" ? query.slice(0, QUERY_MAX) : "",
          folder: typeof folder === "string" ? folder : "",
        },
      };
    }
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
    if (!TAB_KEY.test(tab.key)) return null;
    const state = searchStateOf(tab);
    if (state === null) {
      const { query, folder } = keywordOf(tab);
      return {
        kind: "search",
        key: tab.key,
        query: query.slice(0, QUERY_MAX),
        folder: folder === "" ? null : folder,
      };
    }
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
  // 채운 입력과 결과는 힌트에 넣지 않는다. context와 선언된 검색의 key만이고, 키워드 검색은 탭 key만이다.
  hint(tab) {
    const state = searchStateOf(tab);
    if (state === null) return { kind: "search", key: tab.key };
    return {
      kind: "search",
      key: tab.key,
      context: state.context,
      ...(state.search === null ? {} : { declared_search: state.search }),
    };
  },
  render(tab, _active, host) {
    const state = searchStateOf(tab);
    if (state === null) {
      const search = host.props.source.searchSource;
      if (search === undefined) return null;
      const { query, folder } = keywordOf(tab);
      return (
        <FileSearch
          key={tab.key}
          project={host.projectId}
          workspace={host.props.source}
          search={search}
          initialQuery={query}
          initialFolder={folder}
          onOpen={(path, line) => openFileAt(host, path, line)}
          onState={(next) =>
            host.patchTab(tab.key, (current) => ({
              fields: { ...current.fields, ...next },
            }), { later: true })}
        />
      );
    }
    const contexts = host.contexts;
    if (contexts === null) return null;
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
      />
    );
  },
};
