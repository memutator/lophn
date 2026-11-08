import { contextBridge, ipcRenderer, webUtils } from "electron";

import { DECISION_HANDLE_CHANNEL } from "../ipc/confirmation-channels.ts";
import type {
  DecisionHandleReply,
  DecisionHandleRequest,
} from "../ipc/confirmation.ts";
import {
  OPEN_EXTERNAL_CHANNEL,
  type OpenExternalReply,
} from "../ipc/open-external.ts";
import { createCoreApi } from "./core-api.ts";
import { createAppWindowsApi } from "./app-window-api.ts";
import { createCodingApi } from "./coding-api.ts";
import { createDetachedApi } from "./detached-api.ts";
import { createExtensionsApi } from "./extensions-api.ts";
import { createFilesApi } from "./files-api.ts";
import { createFolderApi } from "./folder-api.ts";
import { createHarnessGuiTabApi } from "./harness-gui-api.ts";
import { createSecretInputOpener } from "./secret-input-open.ts";
import { createAnnotateApi } from "./annotate-api.ts";
import { createInstructionsApi } from "./instructions-api.ts";
import { createGlobalFloatsApi } from "./global-floats-api.ts";
import { createLayoutApi } from "./layout-api.ts";
import { createShellApi } from "./shell-api.ts";
import { createIntentApi, createShortcutApi } from "./shortcut-api.ts";
import { createKeybindingsApi } from "./keybindings-api.ts";
import { createAppearanceApi } from "./appearance-api.ts";
import { createArtifactApi } from "./artifact-api.ts";
import { createBrowserApi } from "./browser-api.ts";
import { createNoticeApi } from "./notice-api.ts";
import { createSurfaceApi } from "./surface-api.ts";
import { createTerminalApi } from "./terminal-api.ts";
import { createThreadBookmarksApi } from "./thread-bookmarks-api.ts";
import { createViewsApi } from "./views-api.ts";
import { createWindowControlsApi } from "./window-controls-api.ts";

const location = (globalThis as unknown as { location: { host: string } })
  .location;
const role = location.host === "overlay" ? "overlay" : "shell";
// 보호 창 열기, 앱 view 열기·bounds·숨김·폐기는 desktop 창 본문만 갖는다. overlay view에는
// 열지 않는다.
contextBridge.exposeInMainWorld(
  "lophnShell",
  role === "shell"
    ? Object.freeze({
        ...createShellApi(ipcRenderer, role),
        // secret 값을 받는 보호 입력 창 열기. 값은 이 창을 지나지 않는다.
        openSecretInput: createSecretInputOpener(ipcRenderer),
        // 창 없는 사람 결정의 handle. main이 정본을 core에서 다시 읽고 handle만 돌려준다.
        async requestDecisionHandle(
          request: DecisionHandleRequest,
        ): Promise<DecisionHandleReply> {
          try {
            return (await ipcRenderer.invoke(
              DECISION_HANDLE_CHANNEL,
              request,
            )) as DecisionHandleReply;
          } catch {
            return {
              error: {
                code: "unavailable",
                message: "결정 handle을 받지 못했다",
              },
            };
          }
        },
        // shell 크롬의 외부 링크는 확인 없이 OS browser로 연다. URL 검사는 main이 한다.
        async openExternal(url: string): Promise<OpenExternalReply> {
          try {
            return (await ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, {
              url,
            })) as OpenExternalReply;
          } catch {
            return { ok: false, code: "unavailable" };
          }
        },
        ...createViewsApi(ipcRenderer),
        ...createAnnotateApi(ipcRenderer),
      })
    : createShellApi(ipcRenderer, role),
);
// 터미널과 창 shortcut, main이 시키는 것은 desktop renderer만 쓴다. overlay view에는 열지 않는다.
if (role === "shell") {
  contextBridge.exposeInMainWorld(
    "lophnTerminal",
    createTerminalApi(ipcRenderer),
  );
  // thread index의 bookmark. 읽기와 켜고 끄기만 보내고 저장은 main이 한다.
  contextBridge.exposeInMainWorld(
    "lophnThreadBookmarks",
    createThreadBookmarksApi(ipcRenderer),
  );
  // 알림 toast와 Agent 탭의 보임·못 본 상태. 어디에 알릴지는 main이 정한다.
  contextBridge.exposeInMainWorld("lophnNotice", createNoticeApi(ipcRenderer));
  // core가 시킨 탭 열기·닫기(agent가 연 탭)와 보이는 workspace, host 탭의 browser 상태. 어느 창에 보낼지는 main이 정한다.
  contextBridge.exposeInMainWorld(
    "lophnSurface",
    createSurfaceApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld(
    "lophnShortcuts",
    createShortcutApi(ipcRenderer),
  );
  // Settings › Keyboard에서 바꾼 키. main이 먼저 받는 키도 따르게 알린다.
  contextBridge.exposeInMainWorld(
    "lophnKeybindings",
    createKeybindingsApi(ipcRenderer),
  );
  // 프로젝트 등록의 OS 폴더 선택기와 끌어 놓은 파일의 경로. 경로는 main이 연 dialog나 사람이 놓은 파일의 것만 온다.
  contextBridge.exposeInMainWorld(
    "lophnFolders",
    createFolderApi(ipcRenderer, webUtils),
  );
  // 상단 바의 최소화·최대화·닫기. 동작 이름만 보내고 창은 main이 정한다.
  contextBridge.exposeInMainWorld(
    "lophnWindow",
    createWindowControlsApi(ipcRenderer),
  );
  // 고른 appearance를 main에 알려 overlay·앱 view 같은 다른 문서도 따르게 한다.
  contextBridge.exposeInMainWorld(
    "lophnAppearance",
    createAppearanceApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld("lophnIntents", createIntentApi(ipcRenderer));
  // coding agent 연결과 [Start]. 고정 intent와 사람이 고른 값만 보내고 main이 다시 검사한다.
  contextBridge.exposeInMainWorld("lophnCoding", createCodingApi(ipcRenderer));
  // Settings › Extensions의 목록·설치·지우기. 켜기·끄기는 설정 쓰기라 이 통로에 없다.
  contextBridge.exposeInMainWorld(
    "lophnExtensions",
    createExtensionsApi(ipcRenderer),
  );
  // 터미널 탭 안 GUI. 탭이 자기 handle에 붙고 toggle을 부른다.
  contextBridge.exposeInMainWorld(
    "lophnHarnessGuiTab",
    createHarnessGuiTabApi(ipcRenderer),
  );
  // 앱 공간의 [Open in new window]와 OS 앱 바로가기. 앱 ID만 보낸다.
  contextBridge.exposeInMainWorld(
    "lophnAppWindows",
    createAppWindowsApi(ipcRenderer),
  );
  // detached 창으로 탭 옮기기. project 창과 detached 창이 같이 쓰고, 보낸 창의 역할은 main이 가린다.
  contextBridge.exposeInMainWorld(
    "lophnDetached",
    createDetachedApi(ipcRenderer),
  );
  // 파일 읽고 쓰기·watch. 경로는 renderer가 보내고 디스크는 main이 만진다.
  contextBridge.exposeInMainWorld("lophnFiles", createFilesApi(ipcRenderer));
  // 작업대 layout. 탭과 정보 패널만 보내고 main이 다시 검사한다.
  contextBridge.exposeInMainWorld("lophnLayout", createLayoutApi(ipcRenderer));
  // 전역 float(workspace를 넘는 앱 panel 화면). 목록만 보내고 main이 다시 검사한다.
  contextBridge.exposeInMainWorld(
    "lophnGlobalFloats",
    createGlobalFloatsApi(ipcRenderer),
  );
  // browser 탭. 주소·명령·bookmark 요청만 보내고 view와 저장은 main이 한다.
  contextBridge.exposeInMainWorld(
    "lophnBrowser",
    createBrowserApi(ipcRenderer),
  );
  // artifact 탭. 열기·reload·목록 요청만 보내고 view는 main이 만든다.
  contextBridge.exposeInMainWorld(
    "lophnArtifact",
    createArtifactApi(ipcRenderer),
  );
  // [Instructions]: 지침 파일을 같은 편집기로 연다. 경로는 main에만 있다.
  contextBridge.exposeInMainWorld(
    "lophnInstructions",
    createInstructionsApi(ipcRenderer),
  );
}

contextBridge.exposeInMainWorld("lophnCore", createCoreApi(ipcRenderer));
