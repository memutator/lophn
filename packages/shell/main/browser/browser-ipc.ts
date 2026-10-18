// shell renderer의 browser 탭 IPC. 매 요청마다 sender가 살아 있는 desktop 창 main frame인지,
// 입력이 schema에 맞는지 본다. 창은 sender에서 main이 정한다. view의 bounds·숨기기·폐기는
// 앱 view와 같은 길(view-ipc.ts)을 쓴다.
import {
  BROWSER_ADOPT_CHANNEL,
  BROWSER_CLEAR_DATA_CHANNEL,
  BROWSER_COMMAND_CHANNEL,
  BROWSER_NAVIGATE_CHANNEL,
  BROWSER_OPEN_CHANNEL,
  browserAdoptSchema,
  browserCommandSchema,
  browserNavigateSchema,
  browserOpenSchema,
  type BrowserReply,
  type BrowserViewState,
} from "../../ipc/browser.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { BrowserViews } from "./registry.ts";

interface BrowserIpcDeps {
  registry: ContentsRegistry;
  /** sender webContents가 본문인 창. desktop 창이 아니면 undefined다. */
  windowOf(sender: CallerContents): string | undefined;
  views: Pick<
    BrowserViews,
    "open" | "adopt" | "navigate" | "command" | "reloadAll"
  >;
  /** installBrowserSession이 돌려준 것. */
  clearData(): Promise<void>;
}

interface BrowserIpcHandlers {
  open(
    event: IpcEvent,
    input: unknown,
  ): Promise<BrowserReply<BrowserViewState>>;
  adopt(
    event: IpcEvent,
    input: unknown,
  ): Promise<BrowserReply<BrowserViewState>>;
  navigate(
    event: IpcEvent,
    input: unknown,
  ): Promise<BrowserReply<BrowserViewState>>;
  command(event: IpcEvent, input: unknown): Promise<BrowserReply<null>>;
  clearData(event: IpcEvent): Promise<BrowserReply<null>>;
}

const DESKTOP_HOST = "desktop";

export function createBrowserIpc(deps: BrowserIpcDeps): BrowserIpcHandlers {
  function callerWindow(event: IpcEvent): BrowserReply<string> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const window = caller.value.origin.host === DESKTOP_HOST
      ? deps.windowOf(event.sender)
      : undefined;
    if (window === undefined) {
      return {
        ok: false,
        error: { code: "forbidden", message: "caller is not a desktop window" },
      };
    }
    return { ok: true, value: window };
  }

  return {
    async open(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return window;
      const checked = checkInput(browserOpenSchema, input);
      if (!checked.ok) return checked;
      return await deps.views.open(window.value, checked.value.url);
    },
    adopt(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return Promise.resolve(window);
      const checked = checkInput(browserAdoptSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.adopt(window.value, checked.value.view_session),
      );
    },
    navigate(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return Promise.resolve(window);
      const checked = checkInput(browserNavigateSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.navigate(
          window.value,
          checked.value.view_session,
          checked.value.input,
        ),
      );
    },
    command(event, input) {
      const window = callerWindow(event);
      if (!window.ok) return Promise.resolve(window);
      const checked = checkInput(browserCommandSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.command(
          window.value,
          checked.value.view_session,
          checked.value.command,
        ),
      );
    },
    async clearData(event) {
      const window = callerWindow(event);
      if (!window.ok) return window;
      try {
        await deps.clearData();
      } catch {
        return {
          ok: false,
          error: { code: "unavailable", message: "could not clear data" },
        };
      }
      deps.views.reloadAll();
      return { ok: true, value: null };
    },
  };
}

interface BrowserIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [BROWSER_OPEN_CHANNEL, "open"],
  [BROWSER_ADOPT_CHANNEL, "adopt"],
  [BROWSER_NAVIGATE_CHANNEL, "navigate"],
  [BROWSER_COMMAND_CHANNEL, "command"],
  [BROWSER_CLEAR_DATA_CHANNEL, "clearData"],
] as const;

export function registerBrowserIpc(
  ipc: BrowserIpcMain,
  handlers: BrowserIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeBrowserIpc(
  ipc: Pick<BrowserIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
