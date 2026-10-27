// secret 보호 입력 창. 일반 desktop 창이 `openSecretInput`을 부르면 그 창의 child modal로 연다.
// 창마다 메모리 partition이고 설치된 secret-input 페이지만 그 partition에서 연다.
// 같은 영역에 창 없는 사람 결정 handle IPC도 둔다: 둘 다 사람 자격이 필요한 입력을 shell main이 받는 길이다.
import { app, BrowserWindow, session, WebContentsView } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  registerDecisionHandle,
  removeDecisionHandle,
} from "../../decision-handle/ipc.ts";
import {
  registerSecretInputIpc,
  removeSecretInputIpc,
  type SecretInputIpcEvent,
} from "../../secret-input/ipc.ts";
import type {
  AppContents,
  ParentWindow,
  SecretInputBrowserWindow,
  SecretInputHost,
} from "../../secret-input/window.ts";
import { capturePaints } from "../headless.ts";
import { createShellHandler } from "../shell-protocol.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { here, headless, windows, core, ipc, windowRef } = ctx;
  let shots = 0;
  const host: SecretInputHost = {
    create(config) {
      const parent = [...windows].find(
        (window) =>
          !window.isDestroyed() && windowRef(window) === config.parent.id,
      );
      const window = new BrowserWindow({
        ...config,
        ...(parent === undefined ? {} : { parent }),
      } as unknown as ConstructorParameters<typeof BrowserWindow>[0]);
      capturePaints(window.webContents, `secret-input-${++shots}`, headless, {
        write: (path, data) => writeFileSync(path, data),
        timer: {
          set: (callback, ms) => setTimeout(callback, ms),
          clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
        },
      });
      return window as unknown as SecretInputBrowserWindow;
    },
    sessionFor(partition) {
      const ses = session.fromPartition(partition);
      const serve = createShellHandler({ distDir: ctx.rendererDist() });
      // 이 partition은 secret-input 페이지만 연다. 다른 shell 화면은 없다.
      ses.protocol.handle("lophn-shell", async (request) => {
        if (new URL(request.url).host !== "secret-input") {
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
            callback(false),
          ),
        on: (_event, listener) =>
          ses.on("will-download", (event) => listener(event)),
        webRequest: {
          onBeforeRequest: (filter, listener) =>
            ses.webRequest.onBeforeRequest(filter, (details, callback) =>
              listener(details, callback),
            ),
        },
      };
    },
    appContents(parentId) {
      const parent = [...windows].find(
        (window) => !window.isDestroyed() && windowRef(window) === parentId,
      );
      if (parent === undefined) return [];
      // shell 크롬 overlay 말고 부모 창에 붙은 앱·문서 view 전부의 입력을 막는다.
      return parent.contentView.children.flatMap((view) =>
        view instanceof WebContentsView &&
        !view.webContents.getURL().startsWith("lophn-shell:")
          ? [view.webContents as unknown as AppContents]
          : [],
      );
    },
  };

  registerSecretInputIpc(ipc, {
    host,
    // 부모는 IPC를 보낸 desktop 창 본문이다. renderer가 보낸 값은 쓰지 않는다.
    parentOf(event: SecretInputIpcEvent): ParentWindow | undefined {
      const window = [...windows].find(
        (one) => !one.isDestroyed() && one.webContents.id === event.sender.id,
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
    core: () => core.session(),
    // build가 보호 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-secret-input.cjs"),
    packaged: app.isPackaged,
    headless,
  });

  registerDecisionHandle(ipc, {
    windowOf: (sender) => {
      const window = ctx.shellWindowOf(sender);
      return window === undefined ? undefined : windowRef(window);
    },
    core: () => core.session(),
    register: (request) => core.registerConfirmation(request),
    now: () => Date.now(),
  });

  return {
    stop() {
      removeSecretInputIpc(ipc);
      removeDecisionHandle(ipc);
    },
  };
}
