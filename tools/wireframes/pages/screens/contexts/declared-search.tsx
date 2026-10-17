// 선언된 검색: renderer의 `SearchTab`을 fake 통로로 그린다. context 계약에 선언한 검색의 입력 form과
// 결과(table·board)이고, 결과의 객체는 링크라서 누르면 그 문서 탭이 열린다.
// project 키워드 검색은 이 탭이 아니다.
import { useEffect, useRef, useState } from "react";

import {
  SearchTab,
  type SearchTabState,
} from "../../../../../packages/shell/renderer/workspace/contexts/search-tab.tsx";
import {
  createFakeContextsSource,
  EVAL,
  PROJECT,
} from "../../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { contextTab, documentTab } from "../../../mock/phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { useOpenTab } from "../../../mock/contexts/open-tab.ts";

type Searching = "findings" | "experiments";

const SEARCH_NAMES: Readonly<Record<Searching, string>> = {
  findings: "findings_about_change",
  experiments: "experiments_by_status",
};

/** 쓰는 중인 상태로 시작한다: 고르는 입력에 글을 쳐서 후보를 펼친다. */
function useTyped(typed: boolean, text: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!typed) return;
    let live = true;
    void (async () => {
      for (let tries = 0; tries < 50 && live; tries += 1) {
        const field = ref.current?.querySelector<HTMLInputElement>(
          "input[role=combobox]",
        );
        if (field) {
          field.focus();
          const set = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!;
          set.call(field, text);
          field.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return ref;
}

export function DeclaredSearch(
  { initial = "findings", typed = false }: {
    initial?: Searching;
    typed?: boolean;
  },
) {
  const open = useOpenTab();
  const [source] = useState(() => createFakeContextsSource());
  const [state, setState] = useState<SearchTabState>({
    context: EVAL,
    search: SEARCH_NAMES[initial],
    inputs: {},
    page: 0,
    savedView: null,
  });
  const ref = useTyped(typed, "C-04");
  return (
    <div ref={ref}>
      <SearchTab
        project={PROJECT}
        source={source}
        state={state}
        onState={setState}
        onOpenContext={(context) =>
          open(contextTab(context === EVAL ? "eval" : "harness"))}
        onOpenDocument={(path) => open(documentTab(path))}
      />
    </div>
  );
}

/** 선언된 검색의 탭. 본문을 직접 준다(종류별 본문 대신). */
export const declaredSearchTab = (
  initial: Searching = "findings",
  typed = false,
): TabSpec => ({
  key: "search:declared",
  kind: "search",
  title: "eval",
  body: <DeclaredSearch initial={initial} typed={typed} />,
});
