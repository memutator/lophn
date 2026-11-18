// secret 보호 입력 창. 일반 desktop 창이나 다른 기계의 창이 `openSecretInput`을 부르면 그 창의 child modal로 연다.
// 창마다 메모리 partition이고 설치된 secret-input 페이지만 그 partition에서 연다. 다른 기계를 골라 연 것(열기 요청의 `machine`,
// 없으면 다른 기계의 창)은 값이 그 기계의 core로만 간다: 읽기와 값 모두 이 컴퓨터 core의 `machines/call`로 그 기계에 가고(값은
// upload `{input, base64}`), 이 컴퓨터의 secret 저장소에 닿지 않는다.
// 같은 영역에 창 없는 사람 결정 handle IPC도 둔다: 둘 다 사람 자격이 필요한 입력을 shell main이 받는 길이다.
import {
  app,
  BrowserWindow,
  session,
  webContents as allContents,
  WebContentsView,
} from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  registerDecisionHandle,
  removeDecisionHandle,
} from "../../decision-handle/ipc.ts";
import type { OnceTyper } from "../../secret-input/request.ts";
import {
  registerSecretInputIpc,
  removeSecretInputIpc,
  type SecretInputCore,
  type SecretInputIpcEvent,
} from "../../secret-input/ipc.ts";
import type {
  AppContents,
  ParentWindow,
  SecretInputBrowserWindow,
  SecretInputHost,
} from "../../secret-input/window.ts";
import { capturePaints } from "../headless.ts";
import { word } from "../i18n.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { createShellHandler } from "../shell-protocol.ts";
import type { MachineLink } from "../viewer/machine-route.ts";
import type { Registered, ShellContext } from "./context.ts";

// 다른 기계의 core를 보호 창이 쓰는 모양으로. 오류는 code만 넘긴다(submit이 code만 본다).
function machineCore(link: MachineLink): SecretInputCore {
  const reply = async (sent: ReturnType<MachineLink["call"]>) => {
    const got = await sent;
    return got.ok
      ? { ok: true as const, value: got.value }
      : {
          ok: false as const,
          error: { code: got.error?.code ?? "unavailable" },
        };
  };
  return {
    internal: (_kind, resource, method, body) =>
      reply(link.call({ resource, method, body })),
    upload: (resource, method, input, bytes) =>
      reply(
        link.call({
          resource,
          method,
          body: { input, base64: Buffer.from(bytes).toString("base64") },
        }),
      ),
  };
}

export function register(ctx: ShellContext, typeOnce: OnceTyper): Registered {
  const { here, headless, windows, core, ipc, windowRef } = ctx;
  // 보호 창을 여는 창: 이 컴퓨터의 창과 다른 기계의 창(`topWindows`에만 있다).
  const parents = () => [...windows, ...ctx.topWindows];
  let shots = 0;
  const host: SecretInputHost = {
    create(config) {
      const parent = parents().find(
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
      // shell 크롬 overlay 말고 부모 창에 붙은 앱·문서 view 전부의 입력을 막는다. 앱·artifact·browser
      // 화면은 renderer의 <webview> guest라 창의 child view가 아니므로 host로 찾는다.
      const native = parent.contentView.children.flatMap((view) =>
        view instanceof WebContentsView &&
        !view.webContents.getURL().startsWith("lophn-shell:")
          ? [view.webContents as unknown as AppContents]
          : [],
      );
      const guests = allContents
        .getAllWebContents()
        .filter(
          (contents) =>
            !contents.isDestroyed() &&
            contents.getType() === "webview" &&
            contents.hostWebContents === parent.webContents,
        )
        .map((contents) => contents as unknown as AppContents);
      return [...native, ...guests];
    },
  };

  registerSecretInputIpc(ipc, {
    host,
    // 부모는 IPC를 보낸 desktop 창 본문이다. renderer가 보낸 값은 쓰지 않는다.
    parentOf(event: SecretInputIpcEvent): ParentWindow | undefined {
      const window = parents().find(
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
        onFocus: (listener) => {
          window.on("focus", listener);
          return () => {
            if (!window.isDestroyed()) window.off("focus", listener);
          };
        },
      };
    },
    // 고른 기계(없으면 다른 기계의 창이 묶인 기계)의 link가 값이 갈 곳이다. 묶인 창은 자기 기계만 고른다(core 호출과 같다).
    // 이름은 창에 한 줄로 보인다.
    coreOf(event, named) {
      const bound = ctx.machineOf(event.sender);
      if (bound !== null && named !== undefined && named !== bound) return null;
      const list = ctx.machines.list();
      const machine = (named ?? bound) as Id<"mch"> | null;
      if (machine === null || machine === list.this?.id) {
        return { core: () => core.session() };
      }
      const remote = machineCore(ctx.machines.link(machine));
      return {
        core: () => remote,
        machine:
          list.machines.find((row) => row.id === machine)?.name ??
          word("machines.label.unknown-name"),
      };
    },
    typeOnce,
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
