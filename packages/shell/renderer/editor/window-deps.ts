// 창 하나의 문서 탭 통로를 preload bridge로 만든다. bridge가 없으면 메뉴는 열지 못한다고
// 답하고 core 읽기는 connection의 unavailable을 그대로 보인다. 편집 파일 통로(lophnEditor)가
// 있으면 창의 편집 session 묶음을 만들고 main의 창 닫기 질문을 듣는다.
import type { EditorFilesApi } from "../../ipc/editor.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { coreEditorSource } from "./core-source.ts";
import { type MenuOpener, overlayMenuOpener } from "./document-menu.ts";
import type { EditorDeps } from "./document-view.tsx";
import { overlayLeaveAsker } from "./leave-dialog.ts";
import { coreSettingsPort, readingWidthStore } from "./reading-width.ts";
import { EditorSessions, type LeaveAsker } from "./sessions.ts";
import { coreVersionSource } from "./versions/core-source.ts";

const NO_MENU: MenuOpener = {
  open: () => Promise.resolve("unavailable"),
};

// overlay를 열지 못하면 묻지 못한다. 결정 없이 초안을 버리지 않고 계속 편집으로 둔다.
const KEEP_EDITING: LeaveAsker = { ask: () => Promise.resolve("keep") };

function readOverlay(): OverlayApi | undefined {
  const bridge = (globalThis as { lophnShell?: OverlayApi }).lophnShell;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

function readEditorFiles(): EditorFilesApi | undefined {
  const bridge = (globalThis as { lophnEditor?: EditorFilesApi }).lophnEditor;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

export function windowEditorDeps(core: CoreSource): EditorDeps {
  const overlay = readOverlay();
  const api = readEditorFiles();
  let files: EditorSessions | undefined;
  if (api) {
    files = new EditorSessions(
      api,
      overlay ? overlayLeaveAsker(overlay) : KEEP_EDITING,
    );
    files.listen();
  }
  const source = coreEditorSource(core);
  return {
    source,
    // 이력·비교는 core 읽기, 복원은 main의 편집 통로(준비·파일 쓰기)다.
    versions: coreVersionSource(core, source, api),
    // core 끊김에서 저장 gate와 확인 시각을 화면이 알게 같은 통로를 남긴다.
    core,
    readingWidth: readingWidthStore(
      coreSettingsPort(core, () => `reading-width-${crypto.randomUUID()}`),
    ),
    menu: overlay ? overlayMenuOpener(overlay) : NO_MENU,
    ...(files ? { files } : {}),
  };
}
