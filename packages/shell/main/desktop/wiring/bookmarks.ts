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

export type BookmarksWiring = Registered & {
  /** page에서 받은 favicon으로 비어 있거나 바뀐 bookmark를 자동 갱신한다. */
  syncFavicon(pageUrl: string, favicon: string): void;
  /** 저장된 bookmark favicon으로 browser의 origin cache를 채운다. */
  seedFavicons(seed: (url: string, favicon: string) => void): void;
};

export function register(ctx: ShellContext): BookmarksWiring {
  const { dataRoot, overlays, ipc, windows } = ctx;

  const store = createBookmarkStore(dataRoot, {
    ids: { bookmark: () => `bkm-${randomUUID()}` },
    clock: { nowIso: () => new Date().toISOString() },
  });

  const notify = () => {
    for (const window of windows) {
      if (window.isDestroyed()) continue;
      window.webContents.send(BOOKMARKS_CHANGED_CHANNEL);
    }
  };

  registerBookmarkIpc(
    ipc,
    createBookmarkIpc({
      registry: overlays.overlayRegistry(),
      store,
      notify,
    }),
  );

  return {
    syncFavicon(pageUrl, favicon) {
      void store.syncFavicon(pageUrl, favicon).then((result) => {
        if (result.ok && result.value) notify();
      });
    },
    seedFavicons(seed) {
      void store.list().then((result) => {
        if (!result.ok || result.value.state !== "ok") return;
        for (const item of result.value.bookmarks) {
          if (item.favicon !== undefined) seed(item.url, item.favicon);
        }
      });
    },
    stop: () => removeBookmarkIpc(ipc),
  };
}
