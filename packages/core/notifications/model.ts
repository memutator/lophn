import {
  NOTIFICATION_TRIGGERS,
  type NotificationTrigger,
} from "../../protocol/platform/mod.ts";
import { redactScreen } from "../../base/redaction/mod.ts";
import type { NotificationRow } from "./store.ts";

// 계기 표의 한 트리거. view가 source payload에서 redaction을 거친 제목·대상을 만든다.
export type NotificationView = {
  notification: NotificationRow;
  title: unknown;
  target: unknown;
};

// 표 밖 결정은 계기가 아니다(platform/notifications#R1, R2). 각 트리거의 조건은
// architecture 5.10의 한 행이다: 운영 보고 문제 3가지, 항상 5가지, machine pause,
// release activation 실패, context 위반 수 증가.
export function triggerOf(event: string): NotificationTrigger | undefined {
  return NOTIFICATION_TRIGGERS.find((trigger) => trigger.event === event);
}

type Payload = Record<string, unknown>;

function payloadIsObject(payload: unknown): payload is Payload {
  return payload !== null && typeof payload === "object" &&
    !Array.isArray(payload);
}

function eventTitle(event: string): unknown {
  return { kind: event };
}

function targetOf(
  event: string,
  subject: unknown,
  payload: unknown,
): unknown {
  const record = payloadIsObject(payload) ? payload : {};
  switch (event) {
    case "ProblemOpened":
    case "ProblemReopened":
      return {
        kind: "problem",
        problem: subject,
        app: record["app"] ?? null,
        report: record["report"] ?? null,
      };
    case "ProblemClosed":
      return { kind: "problem", problem: subject };
    case "ApprovalRequestCreated":
      return { kind: "approval", approval: subject };
    case "QuestionCreated":
      return {
        kind: "question",
        question: subject,
        session: record["session"] ?? null,
      };
    case "TicketConfirmed":
    case "TicketCheckFailed":
      return { kind: "ticket", ticket: subject, app: record["app"] };
    case "AssignmentPaused":
      return {
        kind: "assignment",
        assignment: subject,
        target: record["target"] ?? null,
      };
    case "ReleaseActivationFailed":
      return { kind: "release", release: subject };
    case "ContextViolationsRecorded":
      return { kind: "context", context: subject };
    default:
      return null;
  }
}

// machine이 멈춘 assignment만 계기다. 사람이 직접 멈춘 것은 소식이 아니다(R1).
function assignmentTriggered(payload: Payload): boolean {
  const reason = payload["reason"];
  return payloadIsObject(reason) && reason["kind"] === "scope_archived";
}

// 위반 수가 직전 기록보다 늘었을 때만 계기다. 줄거나 같으면 소식이 아니다(첫 기록의 before는 0).
function violationsRose(payload: Payload): boolean {
  const { before, after } = payload;
  return typeof before === "number" && typeof after === "number" &&
    after > before;
}

// 계기 판정은 source payload만 본다. event의 actor는 payload에 이미 들어갔다.
// AssignmentPaused pauseReason.kind가 machine이 아닐 때만 user다.
export function conditionMet(
  trigger: NotificationTrigger,
  payload: unknown,
): boolean {
  if (trigger.condition === "always") return true;
  if (!payloadIsObject(payload)) return false;
  if (trigger.event === "AssignmentPaused") return assignmentTriggered(payload);
  if (trigger.event === "ContextViolationsRecorded") {
    return violationsRose(payload);
  }
  return true;
}

// 제목·대상은 source 사실에서 만들고 redaction을 거친다(R3). 본문·대화·업무 상태는
// 복사하지 않는다. 화면 문자열 80자 초과는 안전 shape로, private 필드는 통째로 뺀다.
export function notificationView(
  row: NotificationRow,
  sourceEvent: string,
  subject: unknown,
  payload: unknown,
): NotificationView {
  const view = redactScreen(
    {
      title: eventTitle(sourceEvent),
      target: targetOf(sourceEvent, subject, payload),
    },
    ["title", "target"],
    [],
  );
  return {
    notification: row,
    title: view.ok && payloadIsObject(view.value)
      ? view.value["title"] ?? null
      : null,
    target: view.ok && payloadIsObject(view.value)
      ? view.value["target"] ?? null
      : null,
  };
}
