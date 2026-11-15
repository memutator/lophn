// Bus event와 터미널 signal을 push의 "계기"(Cause)로 바꾸는 순수 함수. 무엇을 계기로 치는지의 표가 이 file 한 곳이다.
import type { BusEvent } from "../../protocol/events/mod.ts";
import type { PushMessage, PushPrefs } from "./ports.ts";

// 이 시간 넘게 일한 turn의 끝만 알린다(짧은 turn은 사람이 그 자리에서 본다).
export const LONG_TURN_MS = 60_000;

export type Who = {
  title: string | null;
  agent: string | null;
  harness: string | null;
};
export type SessionInfo = Who & { opened_by_app: boolean };

export type Cause =
  | { kind: "approval"; session: string; who: Who }
  | { kind: "question"; session: string; who: Who }
  | { kind: "terminal_waiting"; session: string; who: Who }
  | {
      kind: "long_finish";
      session: string;
      outcome: "finished" | "failed";
      active_ms: number;
      who: Who;
    }
  | { kind: "consent"; app: string; app_name: string }
  | { kind: "share_request"; app: string; app_name: string }
  // 앱이 없는 기록(SDK 업데이트 필요)은 app이 null이고 누르면 Inbox를 연다.
  | { kind: "program_notice"; app: string | null; title: string }
  | { kind: "app_notify"; app: string; app_name: string | null; title: string }
  | { kind: "job_held"; job_title: string };

type Row = {
  setting: keyof PushPrefs;
  channelId: PushMessage["channelId"];
  priority: PushMessage["priority"];
};
const NEEDS_YOU: Row = {
  setting: "needs_you",
  channelId: "needs-you",
  priority: "high",
};
const APPS = { channelId: "apps", priority: "default" } as const;
export const CAUSE_ROW: Record<Cause["kind"], Row> = {
  approval: NEEDS_YOU,
  question: NEEDS_YOU,
  terminal_waiting: NEEDS_YOU,
  long_finish: {
    setting: "long_finish",
    channelId: "finished",
    priority: "default",
  },
  consent: { setting: "app_update", ...APPS },
  share_request: { setting: "app_update", ...APPS },
  program_notice: { setting: "app_update", ...APPS },
  app_notify: { setting: "app_notify", ...APPS },
  job_held: {
    setting: "job_missed",
    channelId: "needs-you",
    priority: "default",
  },
};

// 사람이 알아야 하는 program 기록. 켜짐·data migration·lophn 업데이트·앱이 멈춘 기록은 Inbox에만 남긴다.
const ALERT_PROGRAM_KINDS: ReadonlySet<string> = new Set([
  "release_failed",
  "release_rolled_back",
  "app_unavailable",
  "app_data_restored",
  "sdk_update_needed",
]);

// 끝난 turn의 종류. 완료와 실패만 센다(끊은 turn과 그 밖은 건너뛴다).
export function turnEndKind(outcome: {
  kind: string;
}): "finished" | "failed" | null {
  return outcome.kind === "completed"
    ? "finished"
    : outcome.kind === "failed"
      ? "failed"
      : null;
}

const whoOf = (info: Who): Who => ({
  title: info.title,
  agent: info.agent,
  harness: info.harness,
});

// session이 있는 event는 `info`(그 session)를 같이 준다. 계기가 아니면 null이다.
export function causeOf(
  event: BusEvent,
  info: SessionInfo | null,
): Cause | null {
  switch (event.type) {
    case "TurnRequestOpened":
      // 팀 자식의 요청은 부모가 푼다. app이 연 session의 승인은 사람이 가야 풀리므로 센다.
      if (event.payload.request.to_parent || info === null) return null;
      return { kind: "approval", session: event.session, who: whoOf(info) };
    case "QuestionAsked":
      if (event.payload.to_parent || info === null) return null;
      return { kind: "question", session: event.session, who: whoOf(info) };
    case "TurnEnded": {
      const outcome = turnEndKind(event.payload.outcome);
      const active = event.payload.active_ms;
      // app이 turn마다 agent를 부려 쓰므로 그 session의 turn 끝은 알리지 않는다.
      if (
        outcome === null ||
        active === null ||
        active < LONG_TURN_MS ||
        info === null ||
        info.opened_by_app
      ) {
        return null;
      }
      return {
        kind: "long_finish",
        session: event.session,
        outcome,
        active_ms: active,
        who: whoOf(info),
      };
    }
    case "ActivationConsentRequested":
      return {
        kind: "consent",
        app: event.payload.app,
        app_name: event.payload.app_name,
      };
    case "ShareRequestOpened":
      return {
        kind: "share_request",
        app: event.payload.app,
        app_name: event.payload.app_name,
      };
    case "NoticePosted": {
      const notice = event.payload;
      if (notice.read_at !== null) return null;
      if (notice.source === "program") {
        return ALERT_PROGRAM_KINDS.has(notice.kind)
          ? { kind: "program_notice", app: notice.app, title: notice.title }
          : null;
      }
      return notice.app === null
        ? null
        : {
            kind: "app_notify",
            app: notice.app,
            app_name: notice.app_name,
            title: notice.title,
          };
    }
    case "JobHeld":
      return { kind: "job_held", job_title: event.payload.job_title };
    default:
      return null;
  }
}

export type TerminalSignal = {
  terminal_ref: string;
  harness: string;
  title: string | null;
  kind: "waiting" | "finished" | "failed";
  active_ms: number | null;
};

export const terminalSession = (signal: { terminal_ref: string }): string =>
  `term:${signal.terminal_ref}`;

// 터미널은 agent 이름이 없고 harness가 이름 구실을 한다.
export function signalCause(signal: TerminalSignal): Cause | null {
  const session = terminalSession(signal);
  const who: Who = {
    title: signal.title,
    agent: null,
    harness: signal.harness,
  };
  if (signal.kind === "waiting") {
    return { kind: "terminal_waiting", session, who };
  }
  if (signal.active_ms === null || signal.active_ms < LONG_TURN_MS) return null;
  return {
    kind: "long_finish",
    session,
    outcome: signal.kind,
    active_ms: signal.active_ms,
    who,
  };
}
