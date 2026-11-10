// 앱 process(handler, 시작 code)에서 쓰는 session lifecycle이다. React도 화면 bridge도 쓰지 않는다: `@lophn/agent/process`로 가져온다.
// 호출은 core를 거친다(broker). 어느 앱인지는 자식 연결이 정하고, 보이는 session은 이 앱 workspace에 사는 agent가 call로 닿을 수 있는
// workspace의 것뿐이다. 부모 invocation이 돌고 있지 않아도 된다. 상태가 바뀌는 때를 받으려면 `@lophn/cap-tool`의
// `subscribe("lophn", "session.running", …)`을 쓴다(선언의 `subscriptions`에 같은 (source, event)를 적는다).
import type {
  SessionFilter,
  SessionInfo,
  SessionResult,
  SessionStatus,
} from "./session-types.ts";

export type {
  SessionFilter,
  SessionInfo,
  SessionResult,
  SessionStatus,
} from "./session-types.ts";
export { SESSION_EVENTS } from "./session-types.ts";

// broker 경로는 core의 broker server와 같다(SDK는 core를 import하지 않는다).
const LIST_PATH = "/_lophn/broker/sessions/list";
const STATUS_PATH = "/_lophn/broker/sessions/status";
const STOP_PATH = "/_lophn/broker/sessions/stop";
const CAP_HOST = Symbol.for("lophn.cap-host");

type HostPort = {
  mode?: "live" | "preview" | "test";
  post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }>;
};

function host(): HostPort | undefined {
  const found = (globalThis as Record<symbol, unknown>)[CAP_HOST];
  return found !== null &&
    typeof found === "object" &&
    typeof (found as Partial<HostPort>).post === "function"
    ? (found as HostPort)
    : undefined;
}

const unavailable = (message: string): SessionResult<never> => ({
  ok: false,
  error: { code: "unavailable", message },
});

async function call<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<SessionResult<T>> {
  const port = host();
  if (port === undefined) return unavailable("sessions are not available");
  // preview·test는 core의 session에 닿지 않는다.
  if (port.mode !== undefined && port.mode !== "live") {
    return unavailable("sessions are only available in a live app");
  }
  let response: { status: number; body: unknown };
  try {
    response = await port.post(path, body);
  } catch {
    return unavailable("sessions could not reach the broker");
  }
  if (response.status === 200) return { ok: true, value: response.body as T };
  const error = (
    response.body as { error?: { code?: unknown; message?: unknown } } | null
  )?.error;
  return {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "unavailable",
      message:
        typeof error?.message === "string" ? error.message : "request failed",
    },
  };
}

export const sessions = {
  /** 이 앱이 볼 수 있는 열린 session. 켤 때 한 번 읽고 `subscribe("lophn", "session.*", …)`로 고친다. */
  list: (filter: SessionFilter = {}) =>
    call<{ sessions: SessionInfo[] }>(LIST_PATH, { ...filter }),
  /** session 하나의 token·비용·context 점유. 안 보이는 session은 `not_found`다. */
  status: (session: string) => call<SessionStatus>(STATUS_PATH, { session }),
  /**
   * 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 멈출 turn이 없으면 `stopped: false`다. 터미널 session은 그 CLI의 끊기 key를
   * 보내고 key가 없는 harness는 `unavailable`이다. 멈춘 것은 사람이 볼 수 있게 기록된다(앱 상세 Activity와 Inbox History).
   */
  stop: (session: string) => call<{ stopped: boolean }>(STOP_PATH, { session }),
};
