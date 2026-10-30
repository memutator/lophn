// search 탭 kind. project 키워드 검색이다. 검색어와 폴더는 사람이 채운 조건일 뿐이라 복원하면
// 검색을 다시 계산한다.
import { t } from "@lophn/i18n";

import { paletteIcons } from "../../icons/mod.ts";

import { TAB_KEY } from "../agent/tab-fields.ts";
import type { TabItem } from "../model.ts";
import { FileSearch } from "../search/file-search.tsx";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

let searchCount = 0;

const QUERY_MAX = 200;

/** 검색 탭의 검색어와 폴더(절대 경로, 없으면 빈 글). */
function keywordOf(tab: TabItem): { query: string; folder: string } {
  const { query, folder } = tab.fields ?? {};
  return {
    query: typeof query === "string" ? query : "",
    folder: typeof folder === "string" ? folder : "",
  };
}

function openKeywordSearch(host: TabHost): void {
  host.openTab({
    key: `search-${Date.now().toString(36)}-${++searchCount}`,
    kind: "search",
    title: t("file-search.label.tab"),
    fields: { query: "", folder: "" },
  });
}

/** 바로 가기 rail과 `+`가 부르는 Search 탭 열기. 열린 검색 탭이 있으면 그 탭을 고르고 없으면 새로 연다. */
export function openSearchShortcut(host: TabHost): void {
  const open = host.view.panes
    .flatMap((pane) => pane.tabs)
    .find((tab) => tab.kind === "search");
  if (open !== undefined) {
    host.openTab(open);
    return;
  }
  openKeywordSearch(host);
}

export const searchKind: TabKindDef = {
  kind: "search",
  labelKey: "file-search.label.tab",
  icon: paletteIcons.search,
  fromStored(stored, { key }) {
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
  },
  toStored(tab) {
    if (!TAB_KEY.test(tab.key)) return null;
    const { query, folder } = keywordOf(tab);
    return {
      kind: "search",
      key: tab.key,
      query: query.slice(0, QUERY_MAX),
      folder: folder === "" ? null : folder,
    };
  },
  render(tab, _active, host) {
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
        onOpen={(path, line) => openFile(host, path, { line, from: tab.key })}
        onState={(next) =>
          host.patchTab(
            tab.key,
            (current) => ({
              fields: { ...current.fields, ...next },
            }),
            { later: true },
          )
        }
      />
    );
  },
};
