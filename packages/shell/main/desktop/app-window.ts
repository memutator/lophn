// 앱 전용 창. 창 본문 전체를 앱 view 하나가
// 채운다. view는 본문 view와 같은 app-frame registry와 Electron adapter로 열어 같은 session·
// scheme·preload 경계를 쓴다. 창 자신은 shell preload도 앱 preload도 없는 빈 창이다. main은
// 현재 앱 기록(`apps/get`)에서 채택된 release를 읽고 그 release의 전용 창 screen을 live로 연다.
// 앱 하나에 전용 창은 하나이고 다시 요청하면 그 창을 앞으로 가져온다.
import {
  type CallResult,
  failure,
  type Outcome,
} from "../app-frame/app-connection.ts";
import type {
  AppFrameService,
  AppFrameViewState,
  ViewBounds,
} from "../app-frame/registry.ts";
import { type WebPreferences, webPreferences } from "./security.ts";
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, windowTitle } from "./window.ts";

export interface AppWindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
  /** 앱 view가 붙고 나서 보인다. */
  show: false;
  autoHideMenuBar: true;
  webPreferences: WebPreferences;
}

/** 시스템 제목 표시줄이 있는 창. 끌 shell 상단 바가 없어서다. preload는 없다. */
function appWindowConfig(
  packaged: boolean,
  appName: string,
): AppWindowConfig {
  return {
    width: MIN_WINDOW_WIDTH,
    height: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: windowTitle(appName),
    show: false,
    autoHideMenuBar: true,
    webPreferences: webPreferences(packaged),
  };
}

/** 만든 전용 창. ref는 app-frame registry가 view를 붙일 창 이름이다. */
interface AppWindowSurface {
  readonly ref: string;
  /** 창 본문 전체(DIP). */
  body(): ViewBounds;
  onResize(listener: () => void): void;
  onClosed(listener: () => void): void;
  reveal(): void;
  close(): void;
}

interface AppWindowDeps {
  /** 그 앱의 현재 기록. `apps/get {app}`이다. */
  readApp(app: string): Promise<CallResult>;
  /** 그 release에서 전용 창에 여는 screen. 선언에 full 크기로 적힌 첫 screen이다. */
  entryScreen(app: string, release: string): Promise<Outcome<string>>;
  create(config: AppWindowConfig): AppWindowSurface;
  frame: Pick<AppFrameService, "open" | "setBounds" | "closeWindow">;
  packaged: boolean;
  log(message: string): void;
}

interface OpenedAppWindow {
  window: string;
  view: AppFrameViewState;
}

interface Current {
  app: { name: string; release: string };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// 열 수 있는 앱만 남긴다. 보관됐거나 채택된 release가 없으면 없는 앱과 같다.
function currentApp(reply: CallResult): Current | undefined {
  if (!reply.ok) return undefined;
  const app = record(record(reply.value)?.app);
  if (
    app === undefined || app.status !== "active" ||
    typeof app.active_release !== "string" || typeof app.name !== "string"
  ) {
    return undefined;
  }
  return { app: { name: app.name, release: app.active_release } };
}

export function createAppWindows(deps: AppWindowDeps) {
  const opened = new Map<
    string,
    { surface: AppWindowSurface; view: AppFrameViewState }
  >();
  const opening = new Map<string, Promise<Outcome<OpenedAppWindow>>>();

  async function openNew(app: string): Promise<Outcome<OpenedAppWindow>> {
    const current = currentApp(await deps.readApp(app));
    if (current === undefined) {
      return failure("unavailable", "app is not available");
    }
    const { name, release } = current.app;
    const screen = await deps.entryScreen(app, release);
    if (!screen.ok) return screen;
    const surface = deps.create(appWindowConfig(deps.packaged, name));
    const view = await deps.frame.open({
      app,
      mode: "live",
      release,
      screen: screen.value,
      size: "full",
      parentWindow: surface.ref,
      bounds: surface.body(),
    });
    if (!view.ok) {
      surface.close();
      return view;
    }
    const entry = { surface, view: view.value };
    opened.set(app, entry);
    surface.onResize(() => {
      const placed = deps.frame.setBounds(
        view.value.view_session,
        surface.body(),
      );
      if (!placed.ok) {
        deps.log(`앱 창 크기를 맞추지 못했다: ${placed.error.code}`);
      }
    });
    surface.onClosed(() => {
      if (opened.get(app) === entry) opened.delete(app);
      deps.frame.closeWindow(surface.ref);
    });
    surface.reveal();
    return { ok: true, value: { window: surface.ref, view: view.value } };
  }

  return {
    /** 그 앱의 전용 창을 연다. 이미 있으면 앞으로 가져온다. */
    open(app: string): Promise<Outcome<OpenedAppWindow>> {
      const existing = opened.get(app);
      if (existing !== undefined) {
        existing.surface.reveal();
        return Promise.resolve({
          ok: true,
          value: { window: existing.surface.ref, view: existing.view },
        });
      }
      const pending = opening.get(app);
      if (pending !== undefined) return pending;
      const started = openNew(app).finally(() => opening.delete(app));
      opening.set(app, started);
      return started;
    },
  };
}
