// 편집기 파일 adapter와 창 닫기 guard. renderer는 문서 id와 session handle만 보내고
// 실제 FileTarget·경로·core port는 여기서 정한다. 창마다 guard가 저장 중 수를 기억한다.
import { app } from "electron";

import { EDITOR_CLOSE_REQUEST_CHANNEL } from "../../../ipc/editor.ts";
import { CloseGuard, guardWindowClose } from "../../editor/close-guard.ts";
import { coreFilesPort, coreInstructionsPort } from "../../editor/core-port.ts";
import { createFileAdapter } from "../../editor/file-adapter.ts";
import { createInstructions } from "../../editor/instructions.ts";
import { registerEditorIpc, removeEditorIpc } from "../../editor/ipc.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { dataRoot, overlays, core, ipc, log, closeGuards } = ctx;
  const fileAdapter = createFileAdapter({
    port: () => {
      const session = core.session();
      return session ? coreFilesPort(session) : null;
    },
    log,
  });
  // [Instructions]. exact 지침 파일만 main이 resolve하고, 파일이 없으면 첫 저장이 만든다.
  const instructions = createInstructions({
    port: () => {
      const session = core.session();
      return session ? coreInstructionsPort(session) : null;
    },
    dataRoot,
  });
  registerEditorIpc(ipc, {
    registry: overlays.overlayRegistry(),
    adapter: fileAdapter,
    instructions,
    guardOf: (id) => closeGuards.get(id),
  });

  // 창 닫기는 편집기의 마지막 고침과 편집 종료를 먼저 본다.
  ctx.windowHooks.created.push((window) => {
    const contentsId = window.webContents.id;
    const guard = new CloseGuard({
      send: (request) => {
        if (!window.isDestroyed()) {
          window.webContents.send(EDITOR_CLOSE_REQUEST_CHANNEL, request);
        }
      },
      log,
    });
    closeGuards.add(contentsId, guard);
    guardWindowClose(
      {
        onClose: (listener) => window.on("close", listener),
        close: () => window.close(),
        isDestroyed: () => window.isDestroyed(),
      },
      guard,
      {
        quitting: () => ctx.quit.active(),
        quitRequested: () => ctx.quit.requested,
        resumeQuit: () => app.quit(),
        quitCancelled: () => {
          ctx.quit.requested = false;
        },
      },
    );
  });
  ctx.windowHooks.closed.push(({ contentsId }) => {
    closeGuards.remove(contentsId);
    fileAdapter.dropOwner(contentsId);
  });

  return { stop: () => removeEditorIpc(ipc) };
}
