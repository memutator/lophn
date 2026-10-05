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
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { ShortcutApi } from "../../ipc/shortcuts.ts";
import type { PaletteDeps } from "./palette/host.tsx";
import { documentSearch } from "./palette/search.ts";
import { ConversationProvider } from "../conversation/dock-slot.tsx";
import { coreConversationSource } from "../conversation/core-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "./lophn-space/things-to-confirm/context.tsx";
import { coreRequestSource } from "./lophn-space/things-to-confirm/core-source.ts";
import {
  coreLauncherSource,
  windowFolderPicker,
} from "./launcher/core-source.ts";
import { coreWorkspaceSource } from "../workspace/core-source.ts";
import { coreTrackingSource } from "../workspace/tracking/core-source.ts";
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

const seed = devSeed();
const core = windowCoreSource();
const editor = windowEditorDeps(core);
const lophn = coreLophnSource(core);
// 런처의 프로젝트 카드·등록과 작업대(추적 켜기 포함)는 제품 core 통로로 읽고 쓴다.
const projects = coreLauncherSource(core, windowFolderPicker());
const workspace = seed?.source ?? coreWorkspaceSource(core);
const tracking = seed ? undefined : coreTrackingSource(core);
// 창마다 하나인 대화 통로와 메모리. 공간을 오가도 작성 중 말이 남는다(desktop#R8).
const conversation = {
  source: coreConversationSource(core),
  drafts: new DraftStore(),
  startOpen: location.hash === "#conversation",
};
// 창마다 하나인 질문·approval 통로와 고르던 답. 도크의 칸·things-to-confirm·chip이 같이 쓴다.
const requests = {
  source: coreRequestSource(core),
  drafts: new RequestDrafts(),
};
// 개발 확인용 시작 자리. `#lophn`이면 lophn 공간(documents)부터, `#conversation`이면
// 거기에 대화 도크까지 열어 두고, `#things-to-confirm`이면 그 형제부터, `#project=<id>`면 그
// 프로젝트 작업대부터 연다. 기본은 런처다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash === "#lophn" || location.hash === "#conversation"
  ? openLophn()
  : location.hash === "#things-to-confirm"
  ? openLophn("things-to-confirm")
  : location.hash.startsWith("#project=")
  ? openProject(location.hash.slice("#project=".length))
  : undefined;
// 창마다 하나. 탭과 host runtime의 대응만 갖고 출력은 갖지 않는다.
const terminal = windowTerminalDeps(
  new TerminalStore(),
  (host) => createXtermView(host),
);

// 창 안 팔레트. overlay와 shortcut 통로는 desktop preload가 연다.
const bridges = globalThis as {
  lophnShell?: OverlayApi;
  lophnShortcuts?: ShortcutApi;
};
const palette: PaletteDeps | undefined =
  bridges.lophnShell && bridges.lophnShortcuts
    ? {
      overlay: bridges.lophnShell,
      shortcuts: bridges.lophnShortcuts,
      search: documentSearch(lophn),
    }
    : undefined;

mount(
  <div className={styles.root}>
    <ConversationProvider deps={conversation}>
      <RequestsProvider deps={requests}>
        <Desktop
          source={core}
          initial={start}
          workspace={workspace}
          editor={seed ? { ...editor, ...seed.editor } : editor}
          windowWidth={seed ? 1440 : undefined}
          terminal={terminal}
          lophn={lophn}
          palette={palette}
          projects={projects}
          tracking={tracking}
        />
      </RequestsProvider>
    </ConversationProvider>
  </div>,
);
