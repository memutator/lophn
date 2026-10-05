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
// xterm 기본 배치. CSP 때문에 xterm이 넣는 <style>은 xterm-view가 옮긴다.
import "@xterm/xterm/css/xterm.css";
import styles from "./entry.module.css";

const seed = devSeed();
const core = windowCoreSource();
const editor = windowEditorDeps(core);
const lophn = coreLophnSource(core);
// 개발 확인용 시작 자리. `#lophn`이면 lophn 공간(documents)부터 연다. 기본은 런처다.
const start: Route | undefined = seed
  ? openProject(seed.project)
  : location.hash === "#lophn"
  ? openLophn()
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
    <Desktop
      source={core}
      initial={start}
      workspace={seed?.source}
      editor={seed ? { ...editor, ...seed.editor } : editor}
      windowWidth={seed ? 1440 : undefined}
      terminal={terminal}
      lophn={lophn}
      palette={palette}
    />
  </div>,
);
