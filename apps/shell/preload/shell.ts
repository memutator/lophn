import { contextBridge, ipcRenderer } from "electron";

import {
  OPEN_EXTERNAL_CHANNEL,
  type OpenExternalReply,
} from "../ipc/open-external.ts";
import {
  TERM_DEFINITION_CHANNEL,
  type TermDefinitionReply,
} from "../ipc/term-definition.ts";
import {
  FOLDER_PICK_CHANNEL,
  type FolderPickerApi,
  type FolderPickReply,
} from "../ipc/folder-picker.ts";
import { createCoreApi } from "./core-api.ts";
import { createAppWindowsApi } from "./app-window-api.ts";
import { createCodingApi } from "./coding-api.ts";
import { createConfirmationOpener } from "./confirmation-open.ts";
import { createConfirmationEndedSubscriber } from "./confirmation-ended.ts";
import { createEditorApi } from "./editor-api.ts";
import { createInstructionsApi } from "./instructions-api.ts";
import { createFeedbackBegin, createOverlayFeedback } from "./feedback-api.ts";
import { createLayoutApi } from "./layout-api.ts";
import { createRestoreApi } from "./restore-api.ts";
import {
  UPDATE_APPLY_CHANNEL,
  UPDATE_NOTICE_CHANNEL,
  UPDATE_READ_CHANNEL,
  type UpdateApplyReply,
  type UpdateNoticeReply,
  type UpdateReadReply,
} from "../ipc/update.ts";
import { createShellApi } from "./shell-api.ts";
import { createIntentApi, createShortcutApi } from "./shortcut-api.ts";
import { createTerminalApi } from "./terminal-api.ts";
import { createViewsApi } from "./views-api.ts";
import { createWorkspaceHintApi } from "./workspace-api.ts";

const location =
  (globalThis as unknown as { location: { host: string } }).location;
const role = location.host === "overlay" ? "overlay" : "shell";
// 보호 창 열기, 앱 view 열기·bounds·숨김·폐기와 [Report a problem] 시작은 desktop 창 본문만
// 갖는다. overlay view에는 열지 않는다.
contextBridge.exposeInMainWorld(
  "lophnShell",
  role === "shell"
    ? Object.freeze({
      ...createShellApi(ipcRenderer, role),
      openConfirmation: createConfirmationOpener(ipcRenderer),
      // 연 확인이 확정되지 않고 끝났다는 알림. main이 연 창에만 보낸다.
      onConfirmationEnded: createConfirmationEndedSubscriber(ipcRenderer),
      // term.define 선택지는 확인 창 없이 main이 정본을 다시 읽어 접수한다.
      async confirmTermDefinition(input: {
        question: string;
        option_key: string;
      }): Promise<TermDefinitionReply> {
        try {
          return await ipcRenderer.invoke(
            TERM_DEFINITION_CHANNEL,
            input,
          ) as TermDefinitionReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
      // shell 크롬의 외부 링크는 확인 없이 OS browser로 연다. URL 검사는 main이 한다(R7).
      async openExternal(url: string): Promise<OpenExternalReply> {
        try {
          return await ipcRenderer.invoke(
            OPEN_EXTERNAL_CHANNEL,
            { url },
          ) as OpenExternalReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
      ...createViewsApi(ipcRenderer),
      ...createFeedbackBegin(ipcRenderer),
    })
    : createShellApi(ipcRenderer, role),
);
// [Report a problem] dialog의 제출·취소는 overlay view만 갖는다(shell/app-frame#R31).
if (role === "overlay") {
  contextBridge.exposeInMainWorld(
    "lophnFeedback",
    createOverlayFeedback(ipcRenderer),
  );
}
// 터미널과 창 shortcut, main이 시키는 것은 desktop renderer만 쓴다. overlay view에는 열지 않는다.
if (role === "shell") {
  contextBridge.exposeInMainWorld(
    "lophnTerminal",
    createTerminalApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld(
    "lophnShortcuts",
    createShortcutApi(ipcRenderer),
  );
  // 프로젝트 등록의 OS 폴더 선택기. 경로는 main이 연 dialog의 결과만 온다.
  contextBridge.exposeInMainWorld(
    "lophnFolders",
    Object.freeze(
      {
        async pick(): Promise<FolderPickReply> {
          try {
            return await ipcRenderer.invoke(
              FOLDER_PICK_CHANNEL,
              {},
            ) as FolderPickReply;
          } catch {
            return { ok: false, code: "unavailable" };
          }
        },
      } satisfies FolderPickerApi,
    ),
  );
  contextBridge.exposeInMainWorld("lophnIntents", createIntentApi(ipcRenderer));
  // coding agent 연결과 [Start]. 고정 intent와 사람이 고른 값만 보내고 main이 다시 검사한다.
  contextBridge.exposeInMainWorld("lophnCoding", createCodingApi(ipcRenderer));
  // 앱 공간의 [Open in new window]와 OS 앱 바로가기. 앱 ID만 보낸다.
  contextBridge.exposeInMainWorld(
    "lophnAppWindows",
    createAppWindowsApi(ipcRenderer),
  );
  // 문서 편집기의 파일 통로(shell/editor#R1). 경로·core port는 main에만 있다.
  contextBridge.exposeInMainWorld("lophnEditor", createEditorApi(ipcRenderer));
  // settings backup 복원(shell#T58). 묶음 하나만 보내고 계획·handle은 main에만 있다.
  contextBridge.exposeInMainWorld(
    "lophnRestore",
    createRestoreApi(ipcRenderer),
  );
  // settings update. 사람이 고른 로컬 파일만 적용한다. 다운로드·재시작은 없다.
  // 정상 정지를 확인하지 못하면 main이 설치 파일을 바꾸지 않는다.
  contextBridge.exposeInMainWorld(
    "lophnUpdate",
    Object.freeze({
      async readPackage(path: string): Promise<UpdateReadReply> {
        try {
          return await ipcRenderer.invoke(UPDATE_READ_CHANNEL, {
            path,
          }) as UpdateReadReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
      async notice(candidate: unknown): Promise<UpdateNoticeReply> {
        try {
          return await ipcRenderer.invoke(UPDATE_NOTICE_CHANNEL, {
            candidate,
          }) as UpdateNoticeReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
      async stop(): Promise<UpdateApplyReply> {
        try {
          return await ipcRenderer.invoke(
            UPDATE_APPLY_CHANNEL,
          ) as UpdateApplyReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
    }),
  );
  // 작업대 layout(shell/workspace#R6). 탭과 정보 패널만 보내고 main이 다시 검사한다.
  contextBridge.exposeInMainWorld(
    "lophnLayout",
    createLayoutApi(ipcRenderer),
  );
  // [Instructions]: 지침 파일을 같은 편집기로 연다(shell/editor#R17). 경로는 main에만 있다.
  contextBridge.exposeInMainWorld(
    "lophnInstructions",
    createInstructionsApi(ipcRenderer),
  );
  // 작업대 현재 보기 힌트. 창 신원은 main이 IPC sender로 정한다.
  contextBridge.exposeInMainWorld(
    "lophnWorkspace",
    createWorkspaceHintApi(ipcRenderer),
  );
}

contextBridge.exposeInMainWorld("lophnCore", createCoreApi(ipcRenderer));
