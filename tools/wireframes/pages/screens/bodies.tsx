// project 화면의 Terminal 탭 본문. renderer의 TerminalTab을 PTY 없는 가짜 bridge로 그린다.
import { useMemo } from "react";

import { TerminalStore } from "../../../../packages/shell/renderer/terminal/store.ts";
import { TerminalDisplays } from "../../../../packages/shell/renderer/terminal/displays.ts";
import { TerminalTab } from "../../../../packages/shell/renderer/terminal/terminal-tab.tsx";
import { createXtermView } from "../../../../packages/shell/renderer/terminal/xterm-view.ts";
import { PROJECT_GROCERY } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { fakeTerminal } from "../../mock/fake-terminal.ts";

import "@xterm/xterm/css/xterm.css";

const KEY = "gallery-terminal";

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
