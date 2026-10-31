// 앱 전용 창. 빈 native 창이 아니라 shell 문서(`#app-window=<app>/<release>/<screen>`) 하나를 연다.
// renderer가 그 문서의 route에서 app view를 `<webview>`로 스스로 열고 창 본문에 채운다. main은
// 현재 앱 기록(`apps/get`)에서 채택된 release를 읽고 그 release의 전용 창 screen을 live로 정해
// 주소에 실어 준다. 앱 하나에 전용 창은 하나이고 다시 요청하면 그 창을 앞으로 가져온다.
import {
  type CallResult,
  failure,
  type Outcome,
} from "../app-frame/app-connection.ts";
import { windowTitle } from "./window.ts";

interface AppWindowSurface {
  readonly ref: string;
  reveal(): void;
  alive(): boolean;
}

interface AppWindowDeps {
  /** 그 앱의 현재 기록. `apps/get {app}`이다. */
  readApp(app: string): Promise<CallResult>;
  /** 그 release에서 전용 창에 여는 screen. 선언에 full 크기로 적힌 첫 screen이다. */
  entryScreen(app: string, release: string): Promise<Outcome<string>>;
  /** 제목이 붙은 desktop 창을 연다. 창을 연 쪽이 `ctx.appWindows`에 표시한다. */
  open(input: { hash: string; title: string }): AppWindowSurface | undefined;
}

interface Current {
  app: { name: string; release: string };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// 열 수 있는 앱만 남긴다. 보관됐거나 채택된 release가 없으면 없는 앱과 같다.
function currentApp(reply: CallResult): Current | undefined {
  if (!reply.ok) return undefined;
  const app = record(record(reply.value)?.app);
  if (
    app === undefined ||
    app.status !== "active" ||
    typeof app.active_release !== "string" ||
    typeof app.name !== "string"
  ) {
    return undefined;
  }
  return { app: { name: app.name, release: app.active_release } };
}

export interface AppWindows {
  /** 그 앱의 전용 창을 연다. 이미 있으면 앞으로 가져온다. */
  open(app: string): Promise<Outcome<{ window: string }>>;
}

export function createAppWindows(deps: AppWindowDeps): AppWindows {
  const opened = new Map<string, AppWindowSurface>();
  const opening = new Map<string, Promise<Outcome<{ window: string }>>>();

  async function openNew(app: string): Promise<Outcome<{ window: string }>> {
    const current = currentApp(await deps.readApp(app));
    if (current === undefined) {
      return failure("unavailable", "app is not available");
    }
    const { name, release } = current.app;
    const screen = await deps.entryScreen(app, release);
    if (!screen.ok) return screen;
    const surface = deps.open({
      hash: `#app-window=${encodeURIComponent(app)}/${encodeURIComponent(
        release,
      )}/${encodeURIComponent(screen.value)}`,
      title: windowTitle(name),
    });
    if (surface === undefined) {
      return failure("unavailable", "window could not open");
    }
    opened.set(app, surface);
    return { ok: true, value: { window: surface.ref } };
  }

  return {
    open(app) {
      const existing = opened.get(app);
      if (existing !== undefined) {
        if (existing.alive()) {
          existing.reveal();
          return Promise.resolve({ ok: true, value: { window: existing.ref } });
        }
        opened.delete(app);
      }
      const pending = opening.get(app);
      if (pending !== undefined) return pending;
      const started = openNew(app).finally(() => opening.delete(app));
      opening.set(app, started);
      return started;
    },
  };
}
