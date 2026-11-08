// core의 host queue를 가져와 그 workspace를 보이는 창에 push한다(agent가 연 탭). core가 시킬 일을 담는 queue는
// 메모리에 있고(`protocol/lophn-agent/host-queue.ts`), 여기가 1초마다 `host/take`로 가져간다. 창을 앞으로 가져오거나
// focus하지 않는다(알림의 `reveal()`과 다르다): agent가 연 탭은 사람이 하던 일을 끊지 않는다.
// extension `harness`의 tick과 한 loop로 합치지 못한다. 그 tick은 extension 안에서 설정 `extensions.harness.enabled`가 꺼지면
// 돌지 않고, extension은 shell main 내부를 import하지 못한다(check-deps rule `extension`).
import {
  SURFACE_ACK_CHANNEL,
  SURFACE_REPORT_CHANNEL,
  SURFACE_REQUEST_CHANNEL,
  SURFACE_WORKSPACE_CHANNEL,
  surfaceAckSchema,
  surfaceReportSchema,
  surfaceWorkspaceSchema,
  type SurfaceWorkspace,
} from "../../../ipc/surface.ts";
import { checkCaller, checkInput, type IpcEvent } from "../ipc-guard.ts";
import type { Registered, ShellContext } from "./context.ts";

const POLL_MS = 1000;
// 한 번에 가져가는 요청 수의 상한. 넘으면 다음 tick에 이어 간다.
const TAKE_MAX = 20;
// 창이 탭을 열고 ack하는 기한이다. 넘으면 retry로 되돌려 다음 tick에 다시 보낸다.
const ACK_TIMEOUT_MS = 1500;

type Workspace = NonNullable<SurfaceWorkspace["workspace"]>;
type Request = { id: string; workspace: Workspace };

const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

export function register(ctx: ShellContext): Registered {
  const registry = ctx.overlays.overlayRegistry();
  // 창(webContents id)이 보이는 workspace.
  const shown = new Map<number, Workspace>();
  const pending = new Map<string, (opened: boolean) => void>();

  ctx.windowHooks.closed.push(({ contentsId }) => shown.delete(contentsId));

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
      await ctx.coreInternal("memory", "host", "report", parsed.value);
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

  function offer(request: Request, payload: unknown): Promise<boolean> {
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

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (let taken = 0; taken < TAKE_MAX; taken += 1) {
        const workspaces = visibleWorkspaces();
        if (workspaces.length === 0) return;
        const reply = await ctx.coreInternal("memory", "host", "take", {
          workspaces,
        });
        if (!reply.ok) return;
        const request = (reply.value as { request: Request | null }).request;
        if (request === null) return;
        const opened = await offer(request, { request });
        await ctx.coreInternal("memory", "host", "done", {
          id: request.id,
          result: opened ? "done" : "retry",
        });
        // 받지 못한 요청을 바로 다시 가져가지 않는다. 다음 tick에 다시 시도한다.
        if (!opened) return;
      }
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => void tick(), POLL_MS);

  return {
    stop() {
      clearInterval(timer);
      ctx.ipc.removeHandler(SURFACE_WORKSPACE_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_ACK_CHANNEL);
      ctx.ipc.removeHandler(SURFACE_REPORT_CHANNEL);
    },
  };
}
