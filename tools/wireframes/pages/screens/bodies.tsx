// project 화면의 Terminal 탭 본문. renderer의 TerminalTab을 PTY 없는 가짜 core로 그린다.
import { useMemo } from "react";

import type { TerminalAgent } from "../../../../packages/protocol/coding-agent/terminals.ts";
import { TerminalTab } from "../../../../packages/shell/renderer/terminal/terminal-tab.tsx";
import { PROJECT_GROCERY } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { useDrive, runSteps, type Step } from "../../mock/drive.ts";
import { fakeTerminalDeps } from "../../mock/fake-terminal.ts";
import { HeadCard } from "./agent-tab/head-card.tsx";

import "@xterm/xterm/css/xterm.css";

const KEY = "gallery-terminal";

/** 새 터미널 탭. PTY 없이 고정된 출력만 보인다. */
export function TerminalBody() {
  const deps = useMemo(() => {
    const made = fakeTerminalDeps();
    made.store.request(KEY);
    return made;
  }, []);
  return (
    <TerminalTab
      tabKey={KEY}
      project={PROJECT_GROCERY}
      folderRef={null}
      attach={null}
      active
      deps={deps}
    />
  );
}

/**
 * coding agent가 도는 터미널 탭. 실제 앱에서는 card 머리가 단추와 ⋯ 메뉴를 그리므로 머리 한 줄도 흉내 낸다.
 * `agent`는 core가 runtime으로 알리는 값이다(foreground·session의 있고 없음이 단추와 메뉴 항목의 disabled를 정한다).
 * "Open as chat"을 누르면 modal만 보이고 바꾸지는 않는다.
 */
export function TerminalAgentBody({
  agent,
  steps = [],
}: {
  agent: TerminalAgent;
  steps?: readonly Step[];
}) {
  useDrive(() => runSteps(steps));
  const deps = useMemo(() => {
    const made = fakeTerminalDeps({ agent });
    made.store.request(KEY);
    return made;
  }, [agent]);
  return (
    <HeadCard>
      <TerminalTab
        tabKey={KEY}
        project={PROJECT_GROCERY}
        folderRef={null}
        attach={null}
        active
        deps={deps}
      />
    </HeadCard>
  );
}
