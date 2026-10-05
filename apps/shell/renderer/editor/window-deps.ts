// 창 하나의 문서 탭 통로를 preload bridge로 만든다. bridge가 없으면 메뉴는 열지 못한다고
// 답하고 core 읽기는 connection의 unavailable을 그대로 보인다.
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreEditorSource } from "./core-source.ts";
import { type MenuOpener, overlayMenuOpener } from "./document-menu.ts";
import type { EditorDeps } from "./document-view.tsx";
import { coreSettingsPort, readingWidthStore } from "./reading-width.ts";

const NO_MENU: MenuOpener = {
  open: () => Promise.resolve("unavailable"),
};

function readOverlay(): OverlayApi | undefined {
  const bridge = (globalThis as { lophnShell?: OverlayApi }).lophnShell;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

export function windowEditorDeps(core: CoreSource): EditorDeps {
  const overlay = readOverlay();
  return {
    source: coreEditorSource(core),
    readingWidth: readingWidthStore(
      coreSettingsPort(core, () => `reading-width-${crypto.randomUUID()}`),
    ),
    menu: overlay ? overlayMenuOpener(overlay) : NO_MENU,
  };
}
