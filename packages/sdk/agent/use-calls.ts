import { useCallback, useEffect, useRef, useState } from "react";
import { type AppBridge, appBridge } from "./bridge.ts";
import {
  type AgentCard,
  CALL_SETTLED_EVENT,
  type CallRow,
  type CallSettled,
} from "./call-types.ts";

export type CallsState =
  | { status: "loading" }
  | { status: "ready"; calls: CallRow[] }
  | { status: "failed"; code: string };

export interface UseAgentCalls {
  state: CallsState;
  /** 다시 읽는다. 읽는 동안 state는 이전 값 그대로다. */
  reload: () => void;
}

/**
 * 보이는 session이 받았거나 보낸 call들이다(새것부터, 최대 50). `session`이 null이면 읽지 않는다(`loading`). 화면이 열릴 때 읽고, 이 앱이 보낸 call이
 * 끝나 `call.settled` event가 오면 다시 읽는다. event는 앱이 선언의 `subscriptions`에 `{source: "lophn", event: "call.settled"}`를 적었을 때만 온다
 * (적지 않으면 `reload`로 읽는다). 앱 view 밖이면 `failed`(`unavailable`)다.
 */
export function useAgentCalls(
  session: string | null,
  app: AppBridge | undefined = appBridge(),
): UseAgentCalls {
  const [state, setState] = useState<CallsState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const reload = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    if (session === null) {
      setState({ status: "loading" });
      return;
    }
    if (app?.calls === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    const mine = ++latest.current;
    void app.calls.list(session).then(
      (result) => {
        if (mine !== latest.current) return;
        setState(
          result.ok
            ? { status: "ready", calls: result.value.calls }
            : { status: "failed", code: result.error.code },
        );
      },
      () => {
        if (mine === latest.current) {
          setState({ status: "failed", code: "unavailable" });
        }
      },
    );
  }, [app, session, round]);

  useEffect(() => onCallSettled(() => setRound((n) => n + 1), app), [app]);
  return { state, reload };
}

/** 이 앱이 보낸 call이 끝날 때마다 listener를 부른다(`call.settled` event). 돌려주는 함수로 푼다. */
export function onCallSettled(
  listener: (settled: CallSettled) => void,
  app: AppBridge | undefined = appBridge(),
): () => void {
  const events = app?.events;
  if (events === undefined) return () => {};
  return events.subscribe("lophn", CALL_SETTLED_EVENT, (payload) =>
    listener(payload as CallSettled),
  );
}

export type AgentsState =
  | { status: "loading" }
  | { status: "ready"; agents: AgentCard[] }
  | { status: "failed"; code: string };

/** 이 앱 workspace에서 부를 수 있는 agent들의 명함이다. 화면이 열릴 때 한 번 읽는다. */
export function useAgents(app: AppBridge | undefined = appBridge()): {
  state: AgentsState;
  reload: () => void;
} {
  const [state, setState] = useState<AgentsState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  useEffect(() => {
    if (app?.agents === undefined) {
      setState({ status: "failed", code: "unavailable" });
      return;
    }
    let live = true;
    void app.agents.list().then(
      (result) => {
        if (!live) return;
        setState(
          result.ok
            ? { status: "ready", agents: result.value.agents }
            : { status: "failed", code: result.error.code },
        );
      },
      () => live && setState({ status: "failed", code: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, [app, round]);
  return { state, reload };
}

/** 앱 화면에서 agent에게 call을 보내고 읽고 취소한다(`lophnApp.calls`). 앱 view 밖이면 `unavailable`이다. `send`는 key를 만들어 같은 call이 두 번 가지 않게 한다. */
export const calls = {
  send: (input: Parameters<NonNullable<AppBridge["calls"]>["send"]>[0]) =>
    appBridge()?.calls?.send({
      ...input,
      key: input.key ?? crypto.randomUUID(),
    }) ?? unavailable(),
  read: (call: string) => appBridge()?.calls?.read(call) ?? unavailable(),
  cancel: (call: string, reason?: string) =>
    appBridge()?.calls?.cancel(call, reason) ?? unavailable(),
  list: (session: string) => appBridge()?.calls?.list(session) ?? unavailable(),
};

function unavailable() {
  return Promise.resolve({
    ok: false as const,
    error: { code: "unavailable", message: "app bridge is unavailable" },
  });
}
