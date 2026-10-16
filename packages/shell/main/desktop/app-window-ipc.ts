// 앱 공간의 [Open in new window]와 OS 앱 바로가기 추가·삭제 IPC.
// 매 요청마다 sender가 살아 있는 desktop 창 main frame인지, 입력이 앱 ID 하나인지 본다.
// overlay·앱 view·보호 창은 부르지 못한다. 바로가기의 앱 이름은
// renderer가 아니라 core 기록에서 읽고, 실제 OS 쓰기는 주입한 os-entry adapter만 한다.
import {
  APP_SHORTCUT_ADD_CHANNEL,
  APP_SHORTCUT_REMOVE_CHANNEL,
  APP_WINDOW_OPEN_CHANNEL,
  type AppWindowErrorCode,
  type AppWindowReply,
  appWindowRequestSchema,
} from "../../ipc/app-window.ts";
import type { CallResult, Outcome } from "../app-frame/app-connection.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";
import type { OsEntryApp, OsEntryResult } from "./os-entry/entry.ts";

interface AppWindowIpcDeps {
  registry: ContentsRegistry;
  /** 그 앱의 전용 창을 연다(app-window.ts). */
  openWindow(app: string): Promise<Outcome<unknown>>;
  /** 그 앱의 현재 기록. `apps/get {app}`이다. */
  readApp(app: string): Promise<CallResult>;
  /** os-entry의 installOsEntry·removeOsEntry에 실제 환경을 묶은 것. */
  entries: {
    install(app: OsEntryApp): OsEntryResult;
    remove(app: string): OsEntryResult;
  };
}

interface AppWindowIpcHandlers {
  openWindow(event: IpcEvent, input: unknown): Promise<AppWindowReply>;
  addShortcut(event: IpcEvent, input: unknown): Promise<AppWindowReply>;
  removeShortcut(event: IpcEvent, input: unknown): Promise<AppWindowReply>;
}

const DESKTOP_HOST = "desktop";

function failed(code: AppWindowErrorCode): AppWindowReply {
  return { ok: false, code };
}

// 개발·headless 실행과 지원하지 않는 OS는 등록하지 않은 것이다. 실행 파일을 믿을 수 없으면 OS 실패다.
function entryReply(result: OsEntryResult): AppWindowReply {
  if (result.ok) return { ok: true };
  switch (result.reason) {
    case "invalid_app":
      return failed("invalid_input");
    case "not_packaged":
    case "unsupported":
      return failed("not_installed");
    case "unverified_path":
    case "os_failed":
      return failed("os_failed");
  }
}

// 바로가기에 쓸 이름. 보관됐거나 기록이 없는 앱은 등록하지 않는다.
function activeName(reply: CallResult): string | undefined {
  if (!reply.ok) return undefined;
  const app = (reply.value as { app?: unknown } | null)?.app as
    | { status?: unknown; name?: unknown }
    | undefined;
  if (app?.status !== "active" || typeof app.name !== "string") return;
  return app.name;
}

export function createAppWindowIpc(
  deps: AppWindowIpcDeps,
): AppWindowIpcHandlers {
  function guard(event: IpcEvent, input: unknown): string | AppWindowReply {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return failed("forbidden");
    if (caller.value.origin.host !== DESKTOP_HOST) return failed("forbidden");
    const checked = checkInput(appWindowRequestSchema, input);
    if (!checked.ok) return failed("invalid_input");
    return checked.value.app;
  }

  return {
    async openWindow(event, input) {
      const app = guard(event, input);
      if (typeof app !== "string") return app;
      const opened = await deps.openWindow(app);
      return opened.ok ? { ok: true } : failed("unavailable");
    },
    async addShortcut(event, input) {
      const app = guard(event, input);
      if (typeof app !== "string") return app;
      const name = activeName(await deps.readApp(app));
      if (name === undefined) return failed("unavailable");
      return entryReply(deps.entries.install({ id: app, name }));
    },
    removeShortcut(event, input) {
      const app = guard(event, input);
      if (typeof app !== "string") return Promise.resolve(app);
      return Promise.resolve(entryReply(deps.entries.remove(app)));
    },
  };
}

interface AppWindowIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [APP_WINDOW_OPEN_CHANNEL, "openWindow"],
  [APP_SHORTCUT_ADD_CHANNEL, "addShortcut"],
  [APP_SHORTCUT_REMOVE_CHANNEL, "removeShortcut"],
] as const;

export function registerAppWindowIpc(
  ipc: AppWindowIpcMain,
  handlers: AppWindowIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeAppWindowIpc(
  ipc: Pick<AppWindowIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
