// view 생성·교체·숨김·폐기·실제 attach를 같은 view_session과 generation으로 남긴다.
// core 감독 통로의 `shell_view_lifetime` diagnostic에는
// 개수만 싣고, main log에는 안전한 대상 참조(app·release·mode)를 함께 둔다. URL·query·본문·
// token·socket 경로는 어디에도 쓰지 않는다.

const VIEW_EVENTS = [
  "created",
  "hidden",
  "replaced",
  "disposed",
  "attached",
] as const;

export type ViewEvent = typeof VIEW_EVENTS[number];

// 감독 pipe의 component는 최상위/이름 모양이다. shell main은 platform 감독 아래의 이름을 쓴다.
const VIEW_DIAGNOSTIC_COMPONENT = "platform/shell-main";

interface ViewLifetimeDiagnostic {
  type: "diagnostic";
  kind: "shell_view_lifetime";
  payload: {
    component: string;
    observed_at: string;
    view_id: string;
    generation: number;
    created: number;
    hidden: number;
    replaced: number;
    disposed: number;
    attached: number;
  };
}

/** 기록 대상. view 신원은 main registry가 정한 값이다. */
interface ViewRecord {
  view_session: string;
  generation: number;
  app: string;
  release: string | null;
  mode: string;
}

interface ViewDiagnosticsDeps {
  /** 감독 pipe로 보낸다. 보내지 못하면 false다. 실패해도 view 동작은 막지 않는다. */
  send(message: ViewLifetimeDiagnostic): boolean;
  log(line: string): void;
  clock: { nowIso(): string };
}

export function createViewDiagnostics(deps: ViewDiagnosticsDeps) {
  const counts = new Map<string, Record<ViewEvent, number>>();
  return {
    record(view: ViewRecord, event: ViewEvent): ViewLifetimeDiagnostic {
      let current = counts.get(view.view_session);
      if (current === undefined) {
        current = {
          created: 0,
          hidden: 0,
          replaced: 0,
          disposed: 0,
          attached: 0,
        };
        counts.set(view.view_session, current);
      }
      current[event] += 1;
      const message: ViewLifetimeDiagnostic = {
        type: "diagnostic",
        kind: "shell_view_lifetime",
        payload: {
          component: VIEW_DIAGNOSTIC_COMPONENT,
          observed_at: deps.clock.nowIso(),
          view_id: view.view_session,
          generation: view.generation,
          ...current,
        },
      };
      // 폐기된 view의 개수는 더 쓰이지 않는다. 같은 id가 다시 오면 새로 센다.
      if (event === "disposed") counts.delete(view.view_session);
      const sent = deps.send(message);
      deps.log(
        `view ${view.view_session} generation=${view.generation} ${event} ` +
          `app=${view.app} release=${
            view.release ?? "none"
          } mode=${view.mode}` +
          (sent ? "" : " diagnostic=unsent"),
      );
      return message;
    },
  };
}

export type ViewDiagnostics = ReturnType<typeof createViewDiagnostics>;
