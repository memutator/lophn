// 보호 창. 사람이 desktop 창에서 [Review]를 누를 때만 그 창의 child modal로
// 연다. 종류별 정본 read·제출은 main 안 통로로 core를 부르고, handle은 비공개 pipe로 등록한다.
// 창마다 메모리 partition이고 설치된 confirmation 페이지만 그 partition에서 연다.
import { app, BrowserWindow, session, WebContentsView } from "electron";
import { randomFillSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { WINDOWLESS_CONFIRMATION_CHANNEL } from "../../../ipc/windowless-confirmation.ts";
import { createCoordinator } from "../../confirmation/coordinator.ts";
import {
  type ConfirmationIpcEvent,
  registerConfirmationIpc,
  removeConfirmationIpc,
} from "../../confirmation/ipc.ts";
import { createKinds, REFUSALS } from "../../confirmation/kinds/mod.ts";
import { confirmWithoutWindow } from "../../confirmation/windowless-confirmation.ts";
import type {
  AppContents,
  ConfirmationBrowserWindow,
  ConfirmationHost,
  ParentWindow,
} from "../../confirmation/window.ts";
import { capturePaints } from "../headless.ts";
import { createShellHandler } from "../shell-protocol.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { here, headless, windows, core, ipc, windowRef } = ctx;
  let confirmationShots = 0;
  const confirmationHost: ConfirmationHost = {
    create(config) {
      const parent = [...windows].find((window) =>
        !window.isDestroyed() && windowRef(window) === config.parent.id
      );
      const window = new BrowserWindow(
        {
          ...config,
          ...(parent === undefined ? {} : { parent }),
        } as unknown as ConstructorParameters<typeof BrowserWindow>[0],
      );
      capturePaints(
        window.webContents,
        `confirmation-${++confirmationShots}`,
        headless,
        {
          write: (path, data) => writeFileSync(path, data),
          timer: {
            set: (callback, ms) => setTimeout(callback, ms),
            clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
          },
        },
      );
      return window as unknown as ConfirmationBrowserWindow;
    },
    sessionFor(partition) {
      const ses = session.fromPartition(partition);
      const serve = createShellHandler({ distDir: ctx.rendererDist() });
      // 이 partition은 confirmation 페이지만 연다. 다른 shell 화면은 없다.
      ses.protocol.handle("lophn-shell", async (request) => {
        if (new URL(request.url).host !== "confirmation") {
          return new Response(null, { status: 404 });
        }
        const res = await serve(request);
        return new Response(res.body ? Buffer.from(res.body) : null, {
          status: res.status,
          headers: res.headers,
        });
      });
      return {
        partition,
        // 권한 요청은 모두 거절한다.
        setPermissionRequestHandler: () =>
          ses.setPermissionRequestHandler((_contents, _permission, callback) =>
            callback(false)
          ),
        on: (_event, listener) =>
          ses.on("will-download", (event) => listener(event)),
        webRequest: {
          onBeforeRequest: (filter, listener) =>
            ses.webRequest.onBeforeRequest(
              filter,
              (details, callback) => listener(details, callback),
            ),
        },
      };
    },
    appContents(parentId) {
      const parent = [...windows].find((window) =>
        !window.isDestroyed() && windowRef(window) === parentId
      );
      if (parent === undefined) return [];
      // shell 크롬 overlay 말고 부모 창에 붙은 앱·문서 view 전부의 입력을 막는다.
      return parent.contentView.children.flatMap((view) =>
        view instanceof WebContentsView &&
          !view.webContents.getURL().startsWith("lophn-shell:")
          ? [view.webContents as unknown as AppContents]
          : []
      );
    },
  };
  const confirmationKinds = createKinds({
    core: () => core.session(),
    clock: { now: () => Date.now() },
    random: (bytes) => randomFillSync(bytes),
  });
  const confirmations = createCoordinator({
    host: confirmationHost,
    canon: confirmationKinds.canon,
    handles: {
      register: (request) => core.registerConfirmation(request),
      // core pipe에는 창 하나의 handle만 버리는 메시지가 없다. 120초 기한과 일회 소비가 막는다.
      closeWindow: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    submit: confirmationKinds.submit,
    deferred: confirmationKinds.deferred,
    forget: (windowId) => confirmationKinds.closed(windowId),
    refusals: REFUSALS,
    clock: { now: () => Date.now() },
    // build가 보호 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-confirmation.cjs"),
    packaged: app.isPackaged,
    headless,
    epoch: () => core.session()?.coreEpoch ?? "",
    connected: () => core.state.state === "ready",
  });
  registerConfirmationIpc(ipc, {
    coordinator: confirmations,
    // 부모는 IPC를 보낸 desktop 창 본문이다. renderer가 보낸 parentWindow 값은 쓰지 않는다.
    parentOf(event: ConfirmationIpcEvent): ParentWindow | undefined {
      const window = [...windows].find((one) =>
        !one.isDestroyed() && one.webContents.id === event.sender.id
      );
      if (window === undefined) return undefined;
      return {
        id: windowRef(window),
        focus: () => window.focus(),
        getContentSize: () => {
          const [width = 0, height = 0] = window.getContentSize();
          return { width, height };
        },
      };
    },
  });

  // app.create·apply_settings 선택지의 확정. 확인 창을 열지 않고 정본의 그 command만 접수한다.
  ipc.handle(
    WINDOWLESS_CONFIRMATION_CHANNEL,
    async (event: { sender: { id: number } }, input: unknown) => {
      const body = input as { group?: unknown; option_key?: unknown };
      if (
        typeof body?.group !== "string" || typeof body.option_key !== "string"
      ) {
        return { ok: false, code: "invalid_input" };
      }
      const window = [...windows].find((one) =>
        !one.isDestroyed() && one.webContents.id === event.sender.id
      );
      const session = core.session();
      if (window === undefined || session === null) {
        return { ok: false, code: "unavailable" };
      }
      return await confirmWithoutWindow({
        core: session,
        register: (request) => core.registerConfirmation(request),
        windowId: windowRef(window),
        group: body.group,
        optionKey: body.option_key,
        nowMs: Date.now(),
      });
    },
  );

  return {
    stop() {
      ipc.removeHandler(WINDOWLESS_CONFIRMATION_CHANNEL);
      removeConfirmationIpc(ipc);
    },
  };
}
