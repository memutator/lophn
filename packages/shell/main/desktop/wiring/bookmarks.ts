// bookmark 저장과 IPC. 저장하는 곳은 main 하나고, 바뀌면 열린 모든 shell 창에 알린다.
import { randomUUID } from "node:crypto";

import { BOOKMARKS_CHANGED_CHANNEL } from "../../../ipc/browser.ts";
import {
  createBookmarkIpc,
  registerBookmarkIpc,
  removeBookmarkIpc,
} from "../../browser/bookmark-ipc.ts";
import { createBookmarkStore } from "../../browser/bookmarks.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { dataRoot, overlays, ipc, windows } = ctx;

  const store = createBookmarkStore(dataRoot, {
    ids: { bookmark: () => `bkm-${randomUUID()}` },
    clock: { nowIso: () => new Date().toISOString() },
  });

  registerBookmarkIpc(
    ipc,
    createBookmarkIpc({
      registry: overlays.overlayRegistry(),
      store,
      notify: () => {
        for (const window of windows) {
          if (window.isDestroyed()) continue;
          window.webContents.send(BOOKMARKS_CHANGED_CHANNEL);
        }
      },
    }),
  );

  return { stop: () => removeBookmarkIpc(ipc) };
}
