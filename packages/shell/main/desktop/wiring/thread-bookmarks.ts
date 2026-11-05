// thread bookmark 저장과 IPC. 저장하는 곳은 main 하나고, 바뀐 session을 열린 모든 shell 창에 알린다.
import { THREAD_BOOKMARKS_CHANGED_CHANNEL } from "../../../ipc/thread-bookmarks.ts";
import {
  createThreadBookmarkIpc,
  registerThreadBookmarkIpc,
  removeThreadBookmarkIpc,
} from "../../thread-bookmarks/ipc.ts";
import { createThreadBookmarkStore } from "../../thread-bookmarks/store.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { dataRoot, overlays, ipc, windows } = ctx;

  const store = createThreadBookmarkStore(dataRoot, {
    clock: { nowIso: () => new Date().toISOString() },
  });

  registerThreadBookmarkIpc(
    ipc,
    createThreadBookmarkIpc({
      registry: overlays.overlayRegistry(),
      store,
      notify: (session) => {
        for (const window of windows) {
          if (window.isDestroyed()) continue;
          window.webContents.send(THREAD_BOOKMARKS_CHANGED_CHANNEL, {
            session,
          });
        }
      },
    }),
  );

  return { stop: () => removeThreadBookmarkIpc(ipc) };
}
