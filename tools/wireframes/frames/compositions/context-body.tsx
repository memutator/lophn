// Context 탭 본문(Overview·Search·Violations·Glossary·Contract 하위 탭): renderer의 `ContextTabBody`를
// fake 통로로 그린다. 예시 context는 eval이고 harness는 관계로만 나온다. 머리에는 적용된 판과 판 목록·
// 되돌리기가 있고, agent를 부르는 단추는 없다. 위반 목록만 Project Manager에게 넘긴다.
import { useState } from "react";

import { ContextTabBody } from "../../../../packages/shell/renderer/workspace/contexts/context-tab-body.tsx";
import type { SubTab } from "../../../../packages/shell/renderer/workspace/contexts/shared.ts";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
} from "../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { documentTab } from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";
import { NO_TIMER, useClicks } from "./contexts/clicks.ts";
import { declaredSearchTab } from "./contexts/declared-search.tsx";
import { DEMO_CLICKS, type GlossaryDemo } from "./contexts/glossary.tsx";
import { pmNewTab } from "./contexts/pm-session.tsx";

export type { SubTab };

export interface ContextBodyProps {
  readonly name?: string;
  readonly initial?: SubTab;
  /** 판 목록을 펼친 채 시작한다. */
  readonly versionsOpen?: boolean;
  /** 옛 판(r2)으로 되돌린 직후 상태로 시작한다. */
  readonly restoredDemo?: boolean;
  /** 용어집의 더하기·고치기·지우기 확인 중 하나를 연 채 시작한다. */
  readonly glossaryDemo?: GlossaryDemo;
  readonly open: (tab: TabSpec, other?: boolean) => void;
}

/** Context 탭 본문. 하위 탭을 누르면 머리와 본문이 바뀐다. 열 때 읽고, 열려 있는 동안 다시 읽지 않는다. */
export function ContextBody(
  {
    name = "eval",
    initial = "overview",
    versionsOpen = false,
    restoredDemo = false,
    glossaryDemo,
    open,
  }: ContextBodyProps,
) {
  const [source] = useState(() => createFakeContextsSource());
  const [sub, setSub] = useState<SubTab>(initial);
  const ref = useClicks([
    ...(versionsOpen || restoredDemo ? ["[data-versions-toggle]"] : []),
    ...(restoredDemo ? ["[data-version-row] button"] : []),
    ...(glossaryDemo === undefined ? [] : DEMO_CLICKS[glossaryDemo]),
  ]);
  return (
    <div ref={ref}>
      <ContextTabBody
        source={source}
        context={name === "harness" ? HARNESS : EVAL}
        sub={sub}
        onSub={setSub}
        onOpenDocument={(path) => open(documentTab(path))}
        onOpenSearch={(state) =>
          open(
            declaredSearchTab(
              state.search === "experiments_by_status"
                ? "experiments"
                : "findings",
            ),
          )}
        onSendViolations={() => open(pmNewTab(), true)}
        timer={NO_TIMER}
        now={new Date("2026-10-12T09:00:00.000Z")}
      />
    </div>
  );
}
