// session lifecycle의 값 모양이다. protocol/lophn-agent/session-lifecycle.ts의 `SessionInfo`·`SessionFilter`와 ReadSessionStatus 출력의 사본이다
// (SDK는 zod를 import하지 않는다). 필드가 바뀌면 같이 바꾼다.

export type SessionKind = "lophn" | "harness" | "terminal";
export type SessionState = "running" | "waiting" | "idle" | "unknown";

export type SessionInfo = {
  /** lophn·harness session은 `ses_…`, 터미널 coding agent는 `term:<탭>`이다. */
  session: string;
  kind: SessionKind;
  /** lophn·harness session의 agent. terminal은 null이다. */
  agent: { handle: string; name: string; runtime: string } | null;
  harness: string | null;
  /** home이면 null이다. */
  workspace: { kind: "project" | "app"; id: string } | null;
  title: string | null;
  state: SessionState;
  /** waiting일 때 무엇을 기다리나. */
  waiting_for: "approval" | "question" | null;
  last_active_at: string | null;
  spawned_by: string | null;
  /** session이 일하는 기본 폴더와 workspace 폴더 목록. */
  cwd: string | null;
  folders: string[];
  /** terminal session만. shell_pid는 PTY shell의 pid이고 CLI 자신의 pid가 아니다. */
  terminal: {
    harness: string;
    cli_session: string | null;
    tab: string;
    shell_pid: number | null;
  } | null;
};

export type SessionFilter = {
  workspace?: { kind: "home" } | { kind: "project" | "app"; id: string };
  state?: SessionState;
  harness?: string;
  kind?: SessionKind;
};

/** `sessions.status`가 주는 session 하나의 token·비용·context 점유. */
export type SessionStatus = {
  session: string;
  title: string | null;
  model: unknown;
  context: { tokens: number; limit: number } | null;
  calls: number;
  turns: number;
  tokens: unknown;
  costs: {
    kind: string;
    currency: string | null;
    amount: string | null;
    calls: number;
  }[];
  provider: unknown;
};

export type SessionError = { code: string; message: string };
export type SessionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SessionError };

/** session 목록 갱신 신호의 event 이름이다(`subscribe("lophn", name, …)`). */
export const SESSION_EVENTS = [
  "session.started",
  "session.running",
  "session.waiting",
  "session.idle",
  "session.ended",
] as const;
