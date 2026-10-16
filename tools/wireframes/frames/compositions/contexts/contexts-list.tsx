// Contexts 탭: renderer의 `ContextsTab`을 fake 통로로 그린다.
// context는 Project Manager가 대화에서 만들어서 만드는 단추가 없다. 보관은 사람이 여기서 한다.
import { useState } from "react";

import {
  ContextsTab,
} from "../../../../../packages/shell/renderer/workspace/contexts/contexts-tab.tsx";
import {
  createFakeContextsSource,
  EVAL_ITEM,
  HARNESS_ITEM,
  PROJECT,
} from "../../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { contextTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { useClicks } from "./clicks.ts";
import { useOpenTab } from "./open-tab.ts";
import styles from "./contexts.module.css";

const TITLES = new Map(
  [EVAL_ITEM, HARNESS_ITEM].map((item) => [item.id, item.title]),
);

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

/** Contexts 탭. 본문을 직접 준다(종류별 본문 대신). */
export const contextsTab = (archivedOpen = false): TabSpec => ({
  key: "contexts",
  kind: "contexts",
  title: "phroner",
  body: <ContextsList archivedOpen={archivedOpen} />,
});
