import { useCallback, useEffect, useRef, useState } from "react";
import {
  SESSION_EVENTS,
  type SessionFilter,
  type SessionInfo,
  type SessionResult,
} from "./session-types.ts";

// 앱 view preload bridge `lophnApp.sessions`·`lophnApp.events`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).
export interface SessionsBridge {
  sessions: {
    list(
      filter?: SessionFilter,
    ): Promise<SessionResult<{ sessions: SessionInfo[] }>>;
    stop(session: string): Promise<SessionResult<{ stopped: boolean }>>;
    end(session: string): Promise<SessionResult<{ ended: boolean }>>;
  };
  events?: {
    subscribe(
      source: string,
      event: string,
      listener: (payload: unknown) => void,
    ): () => void;
  };
}

function sessionsBridge(): SessionsBridge | undefined {
  const app = (globalThis as { lophnApp?: Partial<SessionsBridge> }).lophnApp;
  return app?.sessions === undefined ? undefined : (app as SessionsBridge);
}

export type SessionsState =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionInfo[] }
  | { status: "failed"; code: string };

export interface UseSessions {
  state: SessionsState;
  /** 다시 읽는다. 읽는 동안 state는 이전 값 그대로다. */
  reload: () => void;
  /** 도는 turn을 멈춘다. 멈춘 것은 사람이 볼 수 있게 기록된다. */
  stop: (session: string) => Promise<SessionResult<{ stopped: boolean }>>;
  /** 이 앱이 연 session을 끝낸다(archive와 같은 영향). 남이 연 session은 `forbidden`이다. */
  end: (session: string) => Promise<SessionResult<{ ended: boolean }>>;
}

/**
 * 이 앱이 볼 수 있는 열린 session의 목록이다. 화면이 열릴 때 읽고, `session.started|running|waiting|idle|ended` event가 오면 다시
 * 읽는다. event는 화면의 앱이 선언의 `subscriptions`에 `{source: "lophn", event}`를 적었을 때만 온다(선언하지 않으면 `reload`로 읽는다).
 * 앱 view 밖이거나 이 기능이 없는 lophn이면 `failed`(`unavailable`)다.
 */
export function useSessions(
  filter: SessionFilter = {},
  app: SessionsBridge | undefined = sessionsBridge(),
): UseSessions {
  const [state, setState] = useState<SessionsState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const filterKey = JSON.stringify(filter);
  const reload = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    if (app === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    const mine = ++latest.current;
    void app.sessions.list(JSON.parse(filterKey) as SessionFilter).then(
      (result) => {
        if (mine !== latest.current) return;
        setState(
          result.ok
            ? { status: "ready", sessions: result.value.sessions }
            : { status: "failed", code: result.error.code },
        );
      },
      () => {
        if (mine === latest.current) {
          setState({ status: "failed", code: "unavailable" });
        }
      },
    );
  }, [app, filterKey, round]);

  useEffect(() => {
    const events = app?.events;
    if (events === undefined) return;
    const offs = SESSION_EVENTS.map((name) =>
      events.subscribe("lophn", name, () => setRound((n) => n + 1)),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [app]);

  const stop = useCallback(
    (session: string) =>
      app === undefined
        ? Promise.resolve<SessionResult<{ stopped: boolean }>>({
            ok: false,
            error: {
              code: "unavailable",
              message: "app bridge is unavailable",
            },
          })
        : app.sessions.stop(session),
    [app],
  );
  const end = useCallback(
    (session: string) =>
      app === undefined
        ? Promise.resolve<SessionResult<{ ended: boolean }>>({
            ok: false,
            error: {
              code: "unavailable",
              message: "app bridge is unavailable",
            },
          })
        : app.sessions.end(session),
    [app],
  );
  return { state, reload, stop, end };
}
