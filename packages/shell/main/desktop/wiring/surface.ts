// core의 host queue를 가져와 그 workspace를 보이는 창에 push한다(agent가 연 탭). 단 browser 탭(`--url`)은 그 workspace를 보이는 창이
// 없으면 가장 최근 일반 창이 page를 만들어 두고(일반 창이 하나도 없으면 focus 없이 하나 연다), page가 붙을 때(bind) core에 답한다. core가 시킬 일을 담는 queue는
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
  SURFACE_RELEASE_ID,
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
import { recentWindow } from "./desktop-window.ts";
import type { ExtensionTools } from "./extensions.ts";

// take가 실패하거나 창이 탭 요청을 받지 못했을 때 다시 가져가기 전에 쉬는 시간이다.
const RETRY_MS = 1000;
// 창이 탭을 열고 ack하는 기한이다. 넘으면 retry로 되돌려 RETRY_MS 뒤 다시 보낸다.
const ACK_TIMEOUT_MS = 1500;
// 창이 없어 browser 탭 열기가 새로 연 창마저 만들지 못했을 때 agent가 받는 문장이다(원인, 다음 할 일, 되풀이가 통하는지).
const NO_WINDOW =
  "No lophn window could be opened, so the browser page cannot be created. Retrying may help once; if it fails again, tell the person.";
// page가 붙었다(bind)고 core의 browser 탭 열기에 답하는 결과다.
const BIND_OK = { content: [{ type: "text", text: "opened" }] };
// page를 둘 창이 열기에 답하기 전에 닫혔다.
const WINDOW_CLOSED =
  "The lophn window that was to hold the browser page was closed, so the tab was not opened. Try `lophn tab open` once more; if it fails again, tell the person.";

type Workspace = NonNullable<SurfaceWorkspace["workspace"]>;
// tab 요청은 workspace가 있고, extension tool 호출(`tool_call`)과 browser 호출(`browser_call`)은 workspace를 가리지 않아 payload만 있다.
type Request =
  | {
      id: string;
      kind: "tab_open" | "tab_close" | "tab_show";
      workspace: Workspace;
      payload: { tab: string; target?: Record<string, unknown> };
    }
  | {
      id: string;
      kind: "tool_call";
      payload: Parameters<ExtensionTools["run"]>[0];
    }
  | {
      id: string;
      kind: "browser_call";
      payload: Parameters<BrowserDriver["run"]>[0];
    }
  | {
      id: string;
      kind: "terminal_interrupt";
      payload: { terminal_ref: string };
    };

const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

export function register(
  ctx: ShellContext,
  tui: HarnessTui,
  tools: ExtensionTools,
  appFrame: Pick<AppFrameService, "senderView">,
  artifacts: Pick<ArtifactViews, "guestId">,
  interruptTerminal: (
    terminalRef: string,
  ) => Promise<{ ok: true } | { ok: false; code: string; message: string }>,
): Registered & Pick<BrowserDriver, "typeOnce"> {
  const registry = ctx.overlays.overlayRegistry();
  // 창(webContents id)이 보이는 workspace.
  const shown = new Map<number, Workspace>();
  const pending = new Map<string, (opened: boolean) => void>();
  // browser·preview·artifact host 탭이 어느 창(webContents id)의 어느 view인지. 창이 bind로 알린다.
  const bound = new Map<string, { window: number; view_session: string }>();
  // 이 main이 창에 보낸 browser 탭 열기의 workspace와 page를 둔 일반 창. 창이 닫히면 page가 사라지므로 그 탭을 core 표에서 빼야 하는
  // 탭이다. 창은 열기를 보낸 창이고, 다른 일반 창이 bind하면 그 창으로 바뀐다. 닫기가 bind 전에 오면 이 창으로 보낸다.
  const hostBrowser = new Map<
    string,
    { workspace: Workspace; window: number }
  >();
  // page가 만들어졌다고(bind) 알리기를 기다리는 browser 탭 열기. 탭 id로 찾는다.
  const opening = new Map<string, string>();

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
    releaseLogin: (request) => ctx.core.releaseLogin(request),
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
    // page가 창과 함께 사라졌으니 core 표에도 두지 않는다. detached 창은 탭이 원래 창으로 돌아가므로 page를 둔 일반 창만 본다.
    for (const [tab, at] of hostBrowser) {
      if (at.window !== contentsId) continue;
      hostBrowser.delete(tab);
      const request = opening.get(tab);
      if (request !== undefined) {
        opening.delete(tab);
        void done(request, {
          error: { code: "unavailable", message: WINDOW_CLOSED },
        });
      } else {
        void ctx.coreInternal("memory", "host", "report", {
          tab,
          state: "closed",
        });
      }
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
        const before = bound.get(tab);
        bound.set(tab, { window: event.sender.id, view_session });
        const host = hostBrowser.get(tab);
        if (host !== undefined && regular(event.sender.id) !== undefined) {
          host.window = event.sender.id;
        }
        releaseOld(tab, before, event.sender.id);
        const request = opening.get(tab);
        if (request !== undefined) {
          opening.delete(tab);
          void done(request, BIND_OK);
        }
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
        hostBrowser.delete(parsed.value.tab);
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

  // 다른 창이 같은 탭의 page를 새로 만들어 bind했다. 그 workspace를 띄우지 않은 옛 창은 자기 page를 놓는다.
  // 띄운 창이면 탭이 layout에 열려 있어 놓지 않는다(알려진 한계).
  function releaseOld(
    tab: string,
    before: { window: number } | undefined,
    now: number,
  ) {
    const workspace = hostBrowser.get(tab)?.workspace;
    if (
      before === undefined ||
      before.window === now ||
      workspace === undefined
    )
      return;
    const old = [...ctx.windows].find(
      (window) => window.webContents.id === before.window,
    );
    const at = shown.get(before.window);
    if (
      old === undefined ||
      old.isDestroyed() ||
      (at !== undefined && sameWorkspace(at, workspace))
    ) {
      return;
    }
    old.webContents.send(SURFACE_REQUEST_CHANNEL, {
      request: {
        id: SURFACE_RELEASE_ID,
        kind: "tab_close",
        workspace,
        payload: { tab },
      },
    });
  }

  // detached 창과 앱 전용 창이 아닌 살아 있는 창.
  const regular = (id: number | undefined) =>
    [...ctx.windows].find(
      (window) =>
        !window.isDestroyed() &&
        !ctx.detached.has(window) &&
        !ctx.appWindows.has(window) &&
        window.webContents.id === id,
    );

  // browser 탭의 page는 어느 workspace를 띄운 창이든 산다. 그 workspace를 띄운 창이 없으면 가장 최근 창이 받는다.
  // browser 탭의 닫기는 page를 가진 창이 먼저고, bind 전이면 열기를 보낸 창이다.
  function windowFor(request: Extract<Request, { workspace: Workspace }>) {
    const { tab, target } = request.payload;
    const host = hostBrowser.get(tab);
    return (
      (request.kind === "tab_close" && host !== undefined
        ? (regular(bound.get(tab)?.window) ?? regular(host.window))
        : undefined) ??
      windowOf(request.workspace) ??
      (target !== undefined && "browser" in target
        ? recentWindow(ctx)
        : undefined)
    );
  }

  function offer(
    request: Extract<Request, { workspace: Workspace }>,
    payload: unknown,
    window: NonNullable<ReturnType<typeof windowFor>>,
  ): Promise<boolean> {
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

  // 닫힌 탭의 흔적을 지운다. 열기를 기다리던 것도 닫기가 이긴다.
  function forgetTab(tab: string): void {
    bound.delete(tab);
    hostBrowser.delete(tab);
    opening.delete(tab);
    control.forget(tab);
  }

  const done = (id: string, output?: unknown) =>
    ctx.coreInternal("memory", "host", "done", {
      id,
      result: "done",
      ...(output === undefined ? {} : { output }),
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
      if (request.kind === "terminal_interrupt") {
        // 앱이 멈춘 session이 터미널 탭의 coding agent다. 그 harness의 끊기 key를 친다.
        void interruptTerminal(request.payload.terminal_ref).then((result) =>
          done(
            request.id,
            result.ok
              ? { content: [{ type: "text", text: "interrupted" }] }
              : { error: { code: result.code, message: result.message } },
          ),
        );
        continue;
      }
      if (request.kind === "browser_call") {
        // 호출마다 그 page를 가진 창에 알려 쓴 때를 센다(상한을 넘으면 오래 안 쓴 page부터 놓는다).
        const now = control.current(request.payload.tab);
        if (now !== undefined) pushControl(request.payload.tab, now);
        void driver
          .run(request.payload)
          .then((output) => done(request.id, output));
        continue;
      }
      const browserOpen =
        request.kind === "tab_open" &&
        "browser" in (request.payload.target ?? {});
      const { tab } = request.payload;
      // page를 둘 창이 하나도 없으면 focus 없이 하나 연다. 창이 아직 받을 준비가 안 됐으면 아래 ack 기한과 retry가 기다린다.
      const target =
        windowFor(request) ??
        (browserOpen
          ? await ctx.desktop.openInactive().catch(() => undefined)
          : undefined);
      if (target === undefined) {
        if (browserOpen) {
          // 창을 만들지 못했다. core가 기다리지 않고 이유를 agent에게 돌려주게 한다.
          void done(request.id, {
            error: { code: "unavailable", message: NO_WINDOW },
          });
          continue;
        }
        // 창과 함께 page가 사라졌으면 닫을 것이 없다.
        if (request.kind === "tab_close") {
          forgetTab(tab);
          await done(request.id);
          continue;
        }
      }
      if (target === undefined) {
        await ctx.coreInternal("memory", "host", "done", {
          id: request.id,
          result: "retry",
        });
        await rest();
        continue;
      }
      if (browserOpen) {
        hostBrowser.set(tab, {
          workspace: request.workspace,
          window: target.webContents.id,
        });
      }
      const opened = await offer(request, { request }, target);
      if (opened && request.kind === "tab_close") forgetTab(tab);
      if (opened && browserOpen) {
        // 창이 page를 만들겠다고 답했다. page가 붙어 bind가 오면 core에 알린다.
        if (bound.has(tab)) await done(request.id, BIND_OK);
        else opening.set(tab, request.id);
        continue;
      }
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
    // 보호 입력 창의 한 번 넣기가 쓴다(secret-input wiring).
    typeOnce: (input) => driver.typeOnce(input),
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
