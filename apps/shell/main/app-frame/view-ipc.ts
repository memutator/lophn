// shell renderer의 앱 view IPC. 매 요청마다 sender가 살아 있는 desktop 창 main frame인지,
// 입력이 schema에 맞는지 본다(architecture/shell 2.3). overlay view와 앱 view는 부르지 못한다.
// 창은 sender에서 정하고 페이지가 적은 창·view 신원은 받지 않는다.
import type { ZodType } from "zod";

import {
  type AppFrameViewState,
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
import type { ViewVisibility } from "./visibility.ts";

export interface ViewIpcDeps {
  registry: ContentsRegistry;
  /** sender webContents가 본문인 창. desktop 창이 아니면 undefined다. */
  windowOf(sender: CallerContents): string | undefined;
  visibility: Pick<
    ViewVisibility,
    "openApp" | "setBounds" | "hide" | "close" | "reopen"
  >;
}

export interface ViewIpcHandlers {
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
    const window = caller.value.origin.host === DESKTOP_HOST
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
      return await deps.visibility.openApp(
        checked.value.window,
        checked.value.input,
      );
    },
    async setBounds(event, input) {
      const checked = guard(event, viewBoundsRequestSchema, input);
      if (!checked.ok) return checked;
      return await deps.visibility.setBounds(
        checked.value.window,
        checked.value.input.view_session,
        checked.value.input.bounds,
      );
    },
    setHidden(event, input) {
      const checked = guard(event, viewsHiddenSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.visibility.hide(
          checked.value.window,
          checked.value.input.view_sessions,
        ),
      );
    },
    close(event, input) {
      const checked = guard(event, viewCloseRequestSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.visibility.close(
          checked.value.window,
          checked.value.input.view_session,
        ),
      );
    },
    reopen(event, input) {
      const checked = guard(event, viewCloseRequestSchema, input);
      if (!checked.ok) return Promise.resolve(checked);
      return Promise.resolve(
        deps.visibility.reopen(
          checked.value.window,
          checked.value.input.view_session,
        ),
      );
    },
  };
}

export interface ViewIpcMain {
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
