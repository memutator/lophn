// core 연결과 상태 relay.
import { app, type BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { CORE_STATE_CHANNEL } from "../../../ipc/core.ts";
import { startCoreConnection } from "../core/connection.ts";
import { resolveDenoBinary } from "../core/deno-binary.ts";
import { nodeFetch, nodeSockets, nodeStreamFetch } from "../core/node-io.ts";
import { packagedInstall } from "../paths.ts";
import type { CoreRelay, Registered, ShellContext } from "./context.ts";

type ConnectInput = {
  here: string;
  dataRoot: string;
  windows: Set<BrowserWindow>;
  log: (message: string) => void;
  relay: CoreRelay;
};

// 창을 다 닫아도 core는 남긴다. 명시 종료(tray·OS 종료)만 core를 멈춘다.
// Gateway 조건과 도착한 event, 호출 앞 처리는 relay에 영역이 덧붙인 것을 부른다.
export function connectCore(input: ConnectInput) {
  const { here, dataRoot, windows, log, relay } = input;
  return startCoreConnection({
    launch: {
      // packaged는 설치 묶음의 platform/(source·lock·vendor)이고, 개발은 저장소 루트다.
      repoRoot: app.isPackaged
        ? packagedInstall(process.resourcesPath).platform
        : join(here, "..", "..", "..", ".."),
      dataRoot,
      denoBinary: resolveDenoBinary(
        { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
        log,
      ),
      packaged: app.isPackaged,
    },
    ipc: { handle: (channel, listener) => ipcMain.handle(channel, listener) },
    fetch: nodeFetch,
    stream: nodeStreamFetch,
    sockets: nodeSockets(),
    clock: { now: () => Date.now() },
    targets: () =>
      [...windows].map((window) => ({
        send: (channel, payload) => window.webContents.send(channel, payload),
        isDestroyed: () => window.isDestroyed(),
      })),
    own: {
      conditions: () => relay.conditions,
      event: (event) => {
        for (const reaction of relay.events) reaction(event);
      },
      frame: (frame) => {
        for (const reaction of relay.frames) reaction(frame);
      },
    },
    beforeCall: async (event, call) => {
      for (const reaction of relay.beforeCall) await reaction(event, call);
    },
  });
}

export function register(ctx: ShellContext): Registered {
  // 연결 전에 뜬 창은 지금 상태를 바로 받는다. 이후 변화는 targets가 민다.
  ctx.windowHooks.created.push((window) => {
    window.webContents.on("did-finish-load", () => {
      if (!window.isDestroyed()) {
        window.webContents.send(CORE_STATE_CHANNEL, { ...ctx.core.state });
      }
    });
  });
  // 닫힌 창의 구독 조건은 더 걸지 않는다.
  ctx.windowHooks.closed.push(({ contentsId }) => ctx.core.forget(contentsId));
  return { stop: () => ctx.core.shutdown() };
}
