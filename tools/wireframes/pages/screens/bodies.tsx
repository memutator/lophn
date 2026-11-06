// project 화면의 Terminal 탭 본문. renderer의 TerminalTab을 PTY 없는 가짜 bridge로 그린다.
import { useMemo } from "react";

import type { HarnessGuiTabApi } from "../../../../packages/shell/ipc/harness-gui.ts";
import type { TerminalAgent } from "../../../../packages/shell/ipc/terminal.ts";
import { TerminalStore } from "../../../../packages/shell/renderer/terminal/store.ts";
import { TerminalDisplays } from "../../../../packages/shell/renderer/terminal/displays.ts";
import { TerminalTab } from "../../../../packages/shell/renderer/terminal/terminal-tab.tsx";
import { createXtermView } from "../../../../packages/shell/renderer/terminal/xterm-view.ts";
import { PROJECT_GROCERY } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { useDrive, runSteps, type Step } from "../../mock/drive.ts";
import { fakeTerminal } from "../../mock/fake-terminal.ts";
import { HeadCard } from "./agent-tab/head-card.tsx";

import "@xterm/xterm/css/xterm.css";

const KEY = "gallery-terminal";

// 터미널 탭의 "Open as chat"이 부르는 main 통로. gallery에서는 누르면 modal만 보이면 되고 바꾸지는 않는다.
const GUI_API = {
  running: async () => ({ turn: false, tasks: 0 }),
  toggle: async () => ({ ok: true }),
} as unknown as HarnessGuiTabApi;

/** 새 터미널 탭. PTY 없이 고정된 출력만 보인다. */
export function TerminalBody() {
  const deps = useMemo(() => {
    const store = new TerminalStore(null, null);
    const bridge = fakeTerminal(PROJECT_GROCERY);
    store.request(KEY);
    return {
      bridge,
      store,
      displays: new TerminalDisplays(store, bridge),
      createView: createXtermView,
      confirmClose: () => Promise.resolve(false),
    };
  }, []);
  return (
    <TerminalTab
      tabKey={KEY}
      project={PROJECT_GROCERY}
      folderRef={null}
      active
      deps={deps}
    />
  );
}

/**
 * coding agent가 도는 터미널 탭. 실제 앱에서는 card 머리가 단추와 ⋯ 메뉴를 그리므로 머리 한 줄도 흉내 낸다.
 * `agent`는 main이 runtime으로 알리는 값이다(foreground·session의 있고 없음이 단추와 메뉴 항목의 disabled를 정한다).
 */
export function TerminalAgentBody({
  agent,
  steps = [],
}: {
  agent: TerminalAgent;
  steps?: readonly Step[];
}) {
  (globalThis as { lophnHarnessGuiTab?: HarnessGuiTabApi }).lophnHarnessGuiTab =
    GUI_API;
  useDrive(() => runSteps(steps));
  const deps = useMemo(() => {
    const store = new TerminalStore(null, null);
    const bridge = fakeTerminal(PROJECT_GROCERY, agent);
    store.request(KEY);
    return {
      bridge,
      store,
      displays: new TerminalDisplays(store, bridge),
      createView: createXtermView,
      confirmClose: () => Promise.resolve(false),
    };
  }, [agent]);
  return (
    <HeadCard>
      <TerminalTab
        tabKey={KEY}
        project={PROJECT_GROCERY}
        folderRef={null}
        active
        deps={deps}
      />
    </HeadCard>
  );
}
