// shell renderer의 앱 view IPC. 매 요청마다 sender가 살아 있는 desktop 창 main frame인지,
// 입력이 schema에 맞는지 본다. overlay view와 앱 view는 부르지 못한다.
// 창은 sender에서 main이 정한다.
// openApp·close·reopen은 앱 view와 artifact view의 것이다. bounds·hidden은 browser의 native
// popup·DevTools만 쓴다(앱 view·artifact view는 `<webview>`라 위치·보임을 renderer CSS가 정한다).
import type { ZodType } from "zod";

import {
  type AppFrameViewState,
  type AppViewOpen,
  appViewOpenSchema,
  VIEW_BOUNDS_CHANNEL,
  VIEW_CLOSE_CHANNEL,
  VIEW_OPEN_APP_CHANNEL,
  VIEW_REOPEN_CHANNEL,
  viewBoundsRequestSchema,
  viewCloseRequestSchema,
  type ViewReply,
  VIEWS_HIDDEN_CHANNEL,
  viewsHiddenSchema,
  type VisibilityResult,
} from "../../ipc/app-frame.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { Outcome } from "./app-connection.ts";

/** view가 붙을 창 본문 경계 안의 정수 rectangle(shell renderer의 CSS pixel). */
interface NativeViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewIpcDeps {
  registry: ContentsRegistry;
  /** sender webContents가 본문인 창. desktop 창이 아니면 undefined다. */
  windowOf(sender: CallerContents): string | undefined;
  views: {
    openApp(
      window: string,
      input: AppViewOpen,
    ): Promise<Outcome<AppFrameViewState>>;
    close(window: string, view_session: string): Outcome<null>;
    reopen(window: string, view_session: string): Outcome<AppFrameViewState>;
  };
  /** browser native popup·DevTools의 위치·숨김. 앱 view는 부르지 않는다. */
  bounds: {
    setBounds(
      window: string,
      view_session: string,
      bounds: NativeViewBounds,
      layer: number,
    ): Promise<Outcome<{ generation: number }>>;
    hide(
      window: string,
      view_sessions: readonly string[],
    ): Outcome<{ generation: number }>;
  };
}

interface ViewIpcHandlers {
  openApp(
    event: IpcEvent,
    input: unknown,
  ): Promise<ViewReply<AppFrameViewState>>;
  setBounds(
    event: IpcEvent,
    input: unknown,
  ): Promise<ViewReply<VisibilityResult>>;
  setHidden(
    event: IpcEvent,
    input: unknown,
  ): Promise<ViewReply<VisibilityResult>>;
  close(event: IpcEvent, input: unknown): Promise<ViewReply<null>>;
  reopen(
    event: IpcEvent,
    input: unknown,
  ): Promise<ViewReply<AppFrameViewState>>;
}

const DESKTOP_HOST = "desktop";

export function createViewIpc(deps: ViewIpcDeps): ViewIpcHandlers {
  // caller와 입력을 차례로 본다. 창을 못 찾으면 forbidden이다.
  function guard<T>(
    event: IpcEvent,
    schema: ZodType<T>,
    input: unknown,
  ): ViewReply<{ window: string; input: T }> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const window =
      caller.value.origin.host === DESKTOP_HOST
        ? deps.windowOf(event.sender)
        : undefined;
    if (window === undefined) {
      return {
        ok: false,
        error: { code: "forbidden", message: "caller is not a desktop window" },
      };
    }
    const checked = checkInput(schema, input);
    if (!checked.ok) return checked;
    return { ok: true, value: { window, input: checked.value } };
  }

  return {
    async openApp(event, input) {
      const checked = guard(event, appViewOpenSchema, input);
      if (!checked.ok) return checked;
      return await deps.views.openApp(
        checked.value.window,
        checked.value.input,
      );
    },
    async setBounds(event, input) {
      const checked = guard(event, viewBoundsRequestSchema, input);
      if (!checked.ok) return checked;
      return await deps.bounds.setBounds(
        checked.value.window,
        checked.value.input.view_session,
        checked.value.input.bounds,
        checked.value.input.layer ?? 0,
      );
    },
    setHidden(event, input) {
      const checked = guard(event, viewsHiddenSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.bounds.hide(
          checked.value.window,
          checked.value.input.view_sessions,
        ),
      );
    },
    close(event, input) {
      const checked = guard(event, viewCloseRequestSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.close(
          checked.value.window,
          checked.value.input.view_session,
        ),
      );
    },
    reopen(event, input) {
      const checked = guard(event, viewCloseRequestSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.views.reopen(
          checked.value.window,
          checked.value.input.view_session,
        ),
      );
    },
  };
}

interface ViewIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [VIEW_OPEN_APP_CHANNEL, "openApp"],
  [VIEW_BOUNDS_CHANNEL, "setBounds"],
  [VIEWS_HIDDEN_CHANNEL, "setHidden"],
  [VIEW_CLOSE_CHANNEL, "close"],
  [VIEW_REOPEN_CHANNEL, "reopen"],
] as const;

export function registerViewIpc(
  ipc: ViewIpcMain,
  handlers: ViewIpcHandlers,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => handlers[method](event, input));
  }
}

export function removeViewIpc(ipc: Pick<ViewIpcMain, "removeHandler">): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
