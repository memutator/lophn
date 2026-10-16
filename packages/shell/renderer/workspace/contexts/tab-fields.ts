// Context·Search 탭이 TabItem.fields에 두는 layout 값의 읽기와 쓰기. 탭 줄·layout map은 이 값을 모르고 kind 선언만 안다.
import type { TabItem } from "../model.ts";
import { SUB_TABS, type SubTab } from "./shared.ts";
import type { SearchTabState } from "./search-tab.tsx";
import type { SearchInputValues } from "./source.ts";

export const CONTEXT_ID = /^ctx_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const SAVED_VIEW_ID = /^viw_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

/** 입력은 16개 이하, 합쳐 4KiB 이하다. 넘으면 저장하지 않는다. */
const INPUTS_MAX = 16;
const INPUTS_MAX_BYTES = 4096;

export function isSubTab(value: unknown): value is SubTab {
  return typeof value === "string" &&
    (SUB_TABS as readonly string[]).includes(value);
}

export function contextOf(tab: TabItem): string | null {
  const context = tab.fields?.context;
  return typeof context === "string" && CONTEXT_ID.test(context)
    ? context
    : null;
}

export function subTabOf(tab: TabItem): SubTab {
  const sub = tab.fields?.sub_tab;
  return isSubTab(sub) ? sub : "overview";
}

export function inputsFit(inputs: SearchInputValues): boolean {
  return Object.keys(inputs).length <= INPUTS_MAX &&
    new TextEncoder().encode(JSON.stringify(inputs)).length <=
      INPUTS_MAX_BYTES;
}

/** 탭이 가진 Search 탭 값. context가 없으면 null. */
export function searchStateOf(tab: TabItem): SearchTabState | null {
  const context = contextOf(tab);
  if (context === null) return null;
  const search = tab.fields?.declared_search;
  const inputs = tab.fields?.inputs;
  const page = tab.fields?.page;
  const view = tab.fields?.saved_view;
  return {
    context,
    search: typeof search === "string" && search.length > 0 ? search : null,
    inputs: typeof inputs === "object" && inputs !== null &&
        !Array.isArray(inputs)
      ? inputs as SearchInputValues
      : {},
    page: typeof page === "number" && Number.isInteger(page) && page >= 0
      ? page
      : 0,
    savedView: typeof view === "string" && SAVED_VIEW_ID.test(view)
      ? view
      : null,
  };
}

export function searchFields(
  state: SearchTabState,
): Readonly<Record<string, unknown>> {
  return {
    context: state.context,
    declared_search: state.search,
    inputs: state.inputs,
    page: state.page,
    saved_view: state.savedView,
  };
}
