// The preload of a window that views another machine. It opens only what such a window may use: that machine's core
// (main sends `lophnCore` through this computer's core, `machines/call`), the machine list, overlays, window buttons, shortcuts and links
// to the OS browser. Everything that needs this computer's shell host (terminal, files, browser, app views, secrets,
// layout, …) has no bridge here, so the renderer takes its "no bridge" path; main refuses those channels too.
import { contextBridge, ipcRenderer } from "electron";

import { MACHINES_VISIBLE_CHANNEL } from "../ipc/machines.ts";
import type { LophnNoticeApi } from "../ipc/notice.ts";
import {
  OPEN_EXTERNAL_CHANNEL,
  type OpenExternalReply,
} from "../ipc/open-external.ts";
import { createCoreApi } from "./core-api.ts";
import { createMachinesApi } from "./machines-api.ts";
import { createShellApi } from "./shell-api.ts";
import { createIntentApi, createShortcutApi } from "./shortcut-api.ts";
import { createWindowControlsApi } from "./window-controls-api.ts";

const location = (globalThis as unknown as { location: { host: string } })
  .location;
const role = location.host === "overlay" ? "overlay" : "shell";

// An overlay view's webContents is not bound to the machine, so it gets nothing but the overlay channel.
if (role === "overlay") {
  contextBridge.exposeInMainWorld(
    "lophnShell",
    createShellApi(ipcRenderer, role),
  );
} else {
  contextBridge.exposeInMainWorld(
    "lophnShell",
    Object.freeze({
      ...createShellApi(ipcRenderer, role),
      async openExternal(url: string): Promise<OpenExternalReply> {
        try {
          return (await ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, {
            url,
          })) as OpenExternalReply;
        } catch {
          return { ok: false, code: "unavailable" };
        }
      },
    }),
  );
  contextBridge.exposeInMainWorld("lophnCore", createCoreApi(ipcRenderer));
  contextBridge.exposeInMainWorld(
    "lophnMachines",
    createMachinesApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld(
    "lophnShortcuts",
    createShortcutApi(ipcRenderer),
  );
  contextBridge.exposeInMainWorld("lophnIntents", createIntentApi(ipcRenderer));
  contextBridge.exposeInMainWorld(
    "lophnWindow",
    createWindowControlsApi(ipcRenderer),
  );
  // What the window shows goes to that machine's presence. This computer's toasts and reveals do not come here.
  contextBridge.exposeInMainWorld(
    "lophnNotice",
    Object.freeze({
      async visible(input) {
        if (!("session" in input)) return;
        await ipcRenderer
          .invoke(MACHINES_VISIBLE_CHANNEL, {
            session: input.session,
            visible: input.visible,
          })
          .catch(() => {});
      },
      open: async () => {},
      onToast: () => () => {},
      onReveal: () => () => {},
    } satisfies LophnNoticeApi),
  );
}
