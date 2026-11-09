// core의 host queue를 가져와 그 workspace를 보이는 창에 push한다(agent가 연 탭). core가 시킬 일을 담는 queue는
// 메모리에 있고(`protocol/lophn-agent/host-queue.ts`), 여기가 `host/take`를 쉬지 않고 이어 불러(long-poll) 가져간다. 창을 앞으로 가져오거나
// focus하지 않는다(알림의 `reveal()`과 다르다): agent가 연 탭은 사람이 하던 일을 끊지 않는다.
// `browser_call`은 browser·preview·artifact 탭의 page에 CDP로 돌린다(browser/agent/). 창이 탭의 view session을 bind로 알리고,
// agent가 다루는 탭의 take control 상태(사람이 가져왔는가)를 이 메모리가 든다. core는 모른다.
// preview 탭이 기기를 고르면 창이 emulate로 알리고, 같은 debugger를 driver와 나눠 그 view에 건다(browser/agent/emulation.ts).
// extension `harness`의 tick과 한 loop로 합치지 못한다. 그 tick은 extension 안에서 설정 `extensions.harness.enabled`가 꺼지면
// 돌지 않고, extension은 shell main 내부를 import하지 못한다(check-deps rule `extension`).
import {
  SURFACE_ACK_CHANNEL,
  SURFACE_CONTROL_CHANNEL,
  SURFACE_EMULATE_CHANNEL,
  SURFACE_REPORT_CHANNEL,
  SURFACE_REQUEST_CHANNEL,
  SURFACE_TAKE_CHANNEL,
  SURFACE_WORKSPACE_CHANNEL,
  surfaceAckSchema,
  surfaceEmulateSchema,
  type SurfaceEmulateResult,
  surfaceReportSchema,
  surfaceTakeSchema,
  surfaceWorkspaceSchema,
  type SurfaceWorkspace,
} from "../../../ipc/surface.ts";
import {
  type ControlState,
  createTabControl,
} from "../../browser/agent/control.ts";
import {
  type BrowserDriver,
  createBrowserDriver,
} from "../../browser/agent/driver.ts";
import { createEmulation } from "../../browser/agent/emulation.ts";
import { electronLookup } from "../../browser/agent/electron-page.ts";
import type { AppFrameService } from "../../app-frame/registry.ts";
import type { ArtifactViews } from "../../artifact/registry.ts";
import type { HarnessTui } from "../../terminal/harness-tui.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import type { Registered, ShellContext } from "./context.ts";
import type { ExtensionTools } from "./extensions.ts";

// take가 실패하거나 창이 탭 요청을 받지 못했을 때 다시 가져가기 전에 쉬는 시간이다.
const RETRY_MS = 1000;
// 창이 탭을 열고 ack하는 기한이다. 넘으면 retry로 되돌려 RETRY_MS 뒤 다시 보낸다.
const ACK_TIMEOUT_MS = 1500;

type Workspace = NonNullable<SurfaceWorkspace["workspace"]>;
// tab 요청은 workspace가 있고, extension tool 호출(`tool_call`)과 browser 호출(`browser_call`)은 workspace를 가리지 않아 payload만 있다.
type Request =
  | { id: string; kind: "tab_open" | "tab_close"; workspace: Workspace }
  | {
      id: string;
      kind: "tool_call";
      payload: Parameters<ExtensionTools["run"]>[0];
    }
  | {
      id: string;
      kind: "browser_call";
      payload: Parameters<BrowserDriver["run"]>[0];
    };

const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

export function register(
  ctx: ShellContext,
  tui: HarnessTui,
  tools: ExtensionTools,
  appFrame: Pick<AppFrameService, "senderView">,
  artifacts: Pick<ArtifactViews, "guestId">,
): Registered {
  const registry = ctx.overlays.overlayRegistry();
  // 창(webContents id)이 보이는 workspace.
  const shown = new Map<number, Workspace>();
  const pending = new Map<string, (opened: boolean) => void>();
  // browser·preview·artifact host 탭이 어느 창(webContents id)의 어느 view인지. 창이 bind로 알린다.
  const bound = new Map<string, { window: number; view_session: string }>();

  // 그 탭을 가진 창의 renderer에 take control 상태를 민다.
  const pushControl = (tab: string, state: ControlState) => {
    const at = bound.get(tab);
    for (const window of ctx.windows) {
      if (window.isDestroyed() || window.webContents.id !== at?.window)
        continue;
      window.webContents.send(SURFACE_CONTROL_CHANNEL, { tab, ...state });
    }
  };
  const control = createTabControl(pushControl);
  const lookup = electronLookup(appFrame, artifacts);
  const emulation = createEmulation(lookup);
  const driver = createBrowserDriver({
    viewSession: (tab) => bound.get(tab)?.view_session,
    lookup,
    control,
    nowMs: () => Date.now(),
  });

  ctx.windowHooks.closed.push(({ contentsId }) => {
    shown.delete(contentsId);
    tui.closeWindow(contentsId);
    for (const [tab, at] of bound) {
      if (at.window !== contentsId) continue;
      bound.delete(tab);
      control.forget(tab);
    }
  });

  ctx.ipc.handle(
    SURFACE_WORKSPACE_CHANNEL,
    (event: IpcEvent, input: unknown) => {
      if (!checkCaller(registry, event).ok) return;
      const parsed = checkInput(surfaceWorkspaceSchema, input);
      if (!parsed.ok) return;
      if (parsed.value.workspace === null) shown.delete(event.sender.id);
      else shown.set(event.sender.id, parsed.value.workspace);
    },
  );
  ctx.ipc.handle(SURFACE_ACK_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(surfaceAckSchema, input);
    if (parsed.ok) pending.get(parsed.value.request)?.(parsed.value.opened);
  });
  ctx.ipc.handle(
    SURFACE_REPORT_CHANNEL,
    async (event: IpcEvent, input: unknown) => {
      if (!checkCaller(registry, event).ok) return;
      const parsed = checkInput(surfaceReportSchema, input);
      if (!parsed.ok) return;
      if ("bind" in parsed.value) {
        const { tab, view_session } = parsed.value.bind;
        bound.set(tab, { window: event.sender.id, view_session });
        // 창이 다시 mount했거나 다른 창으로 옮겨 왔으면 지금 상태를 다시 준다.
        const now = control.current(tab);
        if (now !== undefined) pushControl(tab, now);
        return;
      }
      if ("tui" in parsed.value) {
        const { tab, session, terminal_ref } = parsed.value.tui;
        if (terminal_ref === undefined) tui.open(tab, session, event.sender.id);
        else tui.bind(tab, terminal_ref);
        return;
      }
      if (parsed.value.state === "closed") {
        tui.release(parsed.value.tab);
        bound.delete(parsed.value.tab);
        control.forget(parsed.value.tab);
      }
      await ctx.coreInternal("memory", "host", "report", parsed.value);
    },
  );

  ctx.ipc.handle(SURFACE_TAKE_CHANNEL, (event: IpcEvent, input: unknown) => {
    if (!checkCaller(registry, event).ok) return;
    const parsed = checkInput(surfaceTakeSchema, input);
    if (!parsed.ok) return;
    const { tab, held } = parsed.value;
    // 그 탭을 가진 창만 가져오거나 돌려줄 수 있다.
    if (bound.get(tab)?.window !== event.sender.id) return;
    if (held) control.take(tab);
    else control.release(tab);
  });

  ctx.ipc.handle(
    SURFACE_EMULATE_CHANNEL,
    async (event: IpcEvent, input: unknown): Promise<SurfaceEmulateResult> => {
      const unavailable = { ok: false, reason: "unavailable" } as const;
      if (!checkCaller(registry, event).ok) return unavailable;
      const parsed = checkInput(surfaceEmulateSchema, input);
      if (!parsed.ok) return unavailable;
      return emulation
        .apply(parsed.value.view_session, parsed.value.device)
        .catch(() => unavailable);
    },
  );

  // 그 workspace를 보이는 창 중 가장 최근에 focus를 받은 하나(`windows`의 끝)다. 둘이 같은 탭을 열지 않게 하나에만 보낸다.
  function windowOf(workspace: Workspace) {
    return [...ctx.windows]
      .filter((window) => {
        const at = shown.get(window.webContents.id);
        return (
          !window.isDestroyed() &&
          !ctx.detached.has(window) &&
          at !== undefined &&
          sameWorkspace(at, workspace)
        );
      })
      .at(-1);
  }

  // 지금 어느 창이든 보이는 workspace들. 같은 workspace는 한 번만 담는다.
  function visibleWorkspaces(): Workspace[] {
    const found: Workspace[] = [];
    for (const window of ctx.windows) {
      const at = shown.get(window.webContents.id);
      if (
        !window.isDestroyed() &&
        !ctx.detached.has(window) &&
        at !== undefined &&
        !found.some((item) => sameWorkspace(item, at))
      ) {
        found.push(at);
      }
    }
    return found;
  }

  function offer(
    request: Extract<Request, { workspace: Workspace }>,
    payload: unknown,
  ): Promise<boolean> {
    const window = windowOf(request.workspace);
    if (window === undefined) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(false), ACK_TIMEOUT_MS);
      // 먼저 온 쪽이 이기고, 끝난 request의 늦은 ack는 pending에 없어 버려진다.
      function settle(opened: boolean) {
        if (!pending.delete(request.id)) return;
        clearTimeout(timer);
        resolve(opened);
      }
      pending.set(request.id, settle);
      window.webContents.send(SURFACE_REQUEST_CHANNEL, payload);
    });
  }

  const done = (id: string, output: unknown) =>
    ctx.coreInternal("memory", "host", "done", {
      id,
      result: "done",
      output,
    });

  // take가 기다리는 동안 다음 요청이 오면 바로 답이 오므로 답을 받자마자 다시 부른다.
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const rest = () =>
    new Promise<void>((resolve) => {
      retry = setTimeout(resolve, RETRY_MS);
    });
  async function loop() {
    while (!stopped) {
      // 늘 부른다: take가 shell이 붙어 있다는 표시(tool 호출을 받을 수 있다는 뜻)이고 hold의 heartbeat다.
      const reply = await ctx.coreInternal("memory", "host", "take", {
        workspaces: visibleWorkspaces(),
        tui: tui.sessions(),
      });
      if (!reply.ok) {
        await rest();
        continue;
      }
      const request = (reply.value as { request: Request | null }).request;
      if (request === null) continue;
      // handler가 오래 걸려도 탭 요청을 막지 않게 따로 돈다. 끝나면 결과를 done에 싣는다.
      if (request.kind === "tool_call") {
        void tools
          .run(request.payload)
          .then((output) => done(request.id, output));
        continue;
      }
      if (request.kind === "browser_call") {
        void driver
          .run(request.payload)
          .then((output) => done(request.id, output));
        continue;
      }
      const opened = await offer(request, { request });
      await ctx.coreInternal("memory", "host", "done", {
        id: request.id,
        result: opened ? "done" : "retry",
      });
      // 받지 못한 요청을 바로 다시 가져가지 않는다.
      if (!opened) await rest();
    }
  }
  void loop();

  return {
    stop() {
      stopped = true;
      clearTimeout(retry);
      ctx.ipc.removeHandler(SURFACE_WORKSPACE_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_ACK_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_REPORT_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_TAKE_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_EMULATE_CHANNEL);
    },
  };
}
