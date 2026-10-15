// 창 하나의 파일 탭 통로. preload의 파일 통로(lophnFiles)로 창의 편집 session 묶음을 만들고
// main의 창 닫기 질문을 듣는다. 묶음을 못 여는 창(overlay가 없음)은 결정 없이 초안을 버리지 않고
// 계속 편집으로 둔다.
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { EditorDeps } from "./document-view.tsx";
import { overlayLeaveAsker } from "./leave-dialog.ts";
import { coreSettingsPort, readingWidthStore } from "./reading-width.ts";
import { EditorSessions, type LeaveAsker } from "./sessions.ts";
import { windowEditorFiles } from "./source.ts";

const KEEP_EDITING: LeaveAsker = { ask: () => Promise.resolve("keep") };

function readOverlay(): OverlayApi | undefined {
  const bridge = (globalThis as { lophnShell?: OverlayApi }).lophnShell;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

export function windowEditorDeps(core: CoreSource): EditorDeps {
  const overlay = readOverlay();
  const sessions = new EditorSessions(
    windowEditorFiles(),
    overlay ? overlayLeaveAsker(overlay) : KEEP_EDITING,
  );
  sessions.listen();
  return {
    sessions,
    readingWidth: readingWidthStore(coreSettingsPort(core)),
  };
}
