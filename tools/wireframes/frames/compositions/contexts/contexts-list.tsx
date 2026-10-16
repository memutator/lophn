// Contexts 탭과 Context 탭 머리: renderer의 `ContextsTab`·`ContextTabBody`를 fake 통로로 그린다.
// context는 Project Manager가 대화에서 만들어서 만드는 단추가 없다. 보관은 사람이 여기서 한다.
import { useEffect, useRef, useState } from "react";

import {
  ContextsTab,
} from "../../../../../packages/shell/renderer/workspace/contexts/contexts-tab.tsx";
import { ContextTabBody } from "../../../../../packages/shell/renderer/workspace/contexts/context-tab-body.tsx";
import type { SubTab } from "../../../../../packages/shell/renderer/workspace/contexts/shared.ts";
import {
  createFakeContextsSource,
  EVAL,
  EVAL_ITEM,
  HARNESS_ITEM,
  PROJECT,
} from "../../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { contextTab, documentTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { declaredSearchTab } from "./declared-search.tsx";
import { useOpenTab } from "./open-tab.ts";
import styles from "./contexts.module.css";

const TITLES = new Map(
  [EVAL_ITEM, HARNESS_ITEM].map((item) => [item.id, item.title]),
);

// 시간이 가지 않는 timer를 주어 toast가 화면에 남은 채로 보인다.
const NO_TIMER = { set: () => 0, clear: () => {}, now: () => 0 };

/** 화면이 그려진 뒤 사람이 누르는 단추를 차례로 누른다. 한 번만 돈다. */
function useClicks(selectors: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const selector of selectors) {
        let hit: HTMLElement | null = null;
        for (let tries = 0; tries < 50 && live && hit === null; tries += 1) {
          hit = ref.current?.querySelector<HTMLElement>(selector) ?? null;
          if (hit === null) await new Promise((r) => setTimeout(r, 50));
        }
        if (!live || hit === null) return;
        hit.click();
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return ref;
}

export function ContextsList(
  { archivedOpen = false }: { archivedOpen?: boolean },
) {
  const open = useOpenTab();
  const [source] = useState(() => createFakeContextsSource());
  const ref = useClicks(
    archivedOpen ? ["[data-archived] button[aria-expanded]"] : [],
  );
  return (
    <div ref={ref} className={styles.list}>
      <ContextsTab
        projectTitle="phroner"
        project={PROJECT}
        source={source}
        onOpenContext={(context) =>
          open(contextTab(TITLES.get(context) ?? context))}
      />
    </div>
  );
}

/** eval context의 탭 본문. 판 목록을 펼치거나 옛 판으로 되돌린 상태에서 시작할 수 있다. */
export function ContextHead(
  { initial = "overview", versions = false, restore = false }: {
    initial?: SubTab;
    versions?: boolean;
    restore?: boolean;
  },
) {
  const open = useOpenTab();
  const [source] = useState(() => createFakeContextsSource());
  const [sub, setSub] = useState<SubTab>(initial);
  const ref = useClicks([
    ...(versions || restore ? ["[data-versions-toggle]"] : []),
    ...(restore ? ["[data-version-row] button"] : []),
  ]);
  return (
    <div ref={ref}>
      <ContextTabBody
        source={source}
        context={EVAL}
        sub={sub}
        onSub={setSub}
        onOpenDocument={(path) => open(documentTab(path))}
        onOpenSearch={() => open(declaredSearchTab("findings"))}
        timer={NO_TIMER}
        now={new Date("2026-10-12T09:00:00.000Z")}
      />
    </div>
  );
}

/** Contexts 탭. 본문을 직접 준다(종류별 본문 대신). */
export const contextsTab = (archivedOpen = false): TabSpec => ({
  key: "contexts",
  kind: "contexts",
  title: "phroner",
  body: <ContextsList archivedOpen={archivedOpen} />,
});
