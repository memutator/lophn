import { mount } from "../entry.tsx";
import { Desktop } from "./main.tsx";
import { windowCoreSource } from "./connection/connection.ts";
import { devSeed } from "./dev-seed.ts";
import { windowEditorDeps } from "../editor/window-deps.ts";
import { openLophn, openProject, type Route } from "./router.ts";
import { coreLophnSource } from "./lophn-space/core-source.ts";
import { windowTerminalDeps } from "../terminal/deps.ts";
import { TerminalStore } from "../terminal/store.ts";
import { createXtermView } from "../terminal/xterm-view.ts";
import { ConversationProvider } from "../conversation/dock-slot.tsx";
import { coreConversationSource } from "../conversation/core-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

const seed = devSeed();
const core = windowCoreSource();
const editor = windowEditorDeps(core);
const lophn = coreLophnSource(core);
// 창마다 하나인 대화 통로와 메모리. 공간을 오가도 작성 중 말이 남는다(desktop#R8).
const conversation = {
  source: coreConversationSource(core),
  drafts: new DraftStore(),
  startOpen: location.hash === "#conversation",
};
// 개발 확인용 시작 자리. `#lophn`이면 lophn 공간(documents)부터, `#conversation`이면
// 거기에 대화 도크까지 열어 둔다. 기본은 런처다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash === "#lophn" || location.hash === "#conversation"
  ? openLophn()
  : undefined;
// 창마다 하나. 탭과 host runtime의 대응만 갖고 출력은 갖지 않는다.
const terminal = windowTerminalDeps(
  new TerminalStore(),
  (host) => createXtermView(host),
);

mount(
  <div className={styles.root}>
    <ConversationProvider deps={conversation}>
      <Desktop
        source={core}
        initial={start}
        workspace={seed?.source}
        editor={seed ? { ...editor, ...seed.editor } : editor}
        windowWidth={seed ? 1440 : undefined}
        terminal={terminal}
        lophn={lophn}
      />
    </ConversationProvider>
  </div>,
);
