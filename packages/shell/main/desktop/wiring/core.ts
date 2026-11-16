// core 연결과 상태 relay.

import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

import { CORE_STATE_CHANNEL } from "../../../ipc/core.ts";
import { startCoreConnection } from "../core/connection.ts";
import { nodeFetch, nodeSockets, nodeStreamFetch } from "../core/node-io.ts";
import { productVersionOf } from "../core/supervise.ts";
import { packagedInstall } from "../paths.ts";
import type { CoreRelay, Registered, ShellContext } from "./context.ts";

type ConnectInput = {
  here: string;
  dataRoot: string;
  windows: Set<BrowserWindow>;
  relay: CoreRelay;
  // context의 IPC 둘레(`ctx.ipc.handle`). 다른 기계의 창이 보낸 `shell:core-*`는 그 기계의 연결로 가고 이 core에 닿지 않는다.
  handle: (
    channel: string,
    listener: (event: never, input: never) => Promise<unknown>,
  ) => void;
};

/** core entry의 기준. packaged는 설치 묶음의 platform/(source)이고, 개발은 `here`에서 저장소 루트다. */
export function coreRoot(here: string = __dirname): string {
  return app.isPackaged
    ? packagedInstall(process.resourcesPath).platform
    : join(here, "..", "..", "..", "..");
}

// 창을 다 닫아도 core는 남는다. `Stop lophn`만 core를 멈춘다.
// Gateway 조건과 도착한 event, 호출 앞 처리는 relay에 영역이 덧붙인 것을 부른다.
export function connectCore(input: ConnectInput) {
  const { here, dataRoot, windows, relay, handle } = input;
  const repoRoot = coreRoot(here);
  return startCoreConnection({
    launch: { repoRoot, dataRoot },
    productVersion: productVersionOf(repoRoot),
    ipc: { handle },
    fetch: nodeFetch,
    stream: nodeStreamFetch,
    sockets: nodeSockets(),
    clock: { now: () => Date.now() },
    targets: () =>
      [...windows].map((window) => ({
        id: window.webContents.id,
        send: (channel, payload) => window.webContents.send(channel, payload),
        isDestroyed: () => window.isDestroyed(),
      })),
    own: {
      conditions: () => relay.conditions,
      ready: () => {
        for (const reaction of relay.ready) reaction();
      },
      event: (event) => {
        for (const reaction of relay.events) reaction(event);
      },
      frame: (frame) => {
        for (const reaction of relay.frames) reaction(frame);
      },
      called: (call, reply) => {
        for (const reaction of relay.calls) reaction(call, reply);
      },
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
  // 닫힌 창의 구독 조건과 그 창이 받은 미소비 handle은 core에서 버린다.
  ctx.windowHooks.closed.push(({ contentsId, ref }) =>
    ctx.core.forget(contentsId, ref),
  );
  // shell 자원 정리는 연결만 끊는다. core는 Quit 뒤에도 남아 idle-exit로 끝난다.
  return { stop: () => ctx.core.detach() };
}
