import type { Id } from "../../../protocol/base/ids.ts";
import type { TurnPermissionRequest } from "../../../protocol/approvals/mod.ts";
import type {
  AgentEvent,
  BusEvent,
  SessionSnapshot,
} from "../../../protocol/events/mod.ts";
import type { Bus } from "../../events/ports.ts";

// 대기 중인 권한 요청은 approvals가 가진 메모리 목록을 읽는다.
export interface SessionApprovals {
  turnRequests(session: Id<"ses">): readonly TurnPermissionRequest[];
}

type Entry = {
  agent: SessionSnapshot["agent"];
  place: SessionSnapshot["place"];
  running: boolean;
  // coding agent는 harness가 알려 준 것이 있어야 안다.
  heard: boolean;
  questions: SessionSnapshot["questions"];
  // 아직 푼 소식이 없는 권한 요청. 목록은 approvals가 준다.
  requests: Set<string>;
};

const TYPES = [
  "SessionStarted",
  "SessionEnded",
  "TurnStarted",
  "TurnEnded",
  "PermissionRequested",
  "PermissionResolved",
  "QuestionAsked",
  "QuestionResolved",
] as const;

// session의 지금 상태(running, waiting, idle, unknown)를 agent event에서 계산해 메모리에 둔다.
// 저장하지 않는다. lophn이 꺼졌다 켜지면 열린 session은 SessionStarted를 다시 받아 idle에서 시작한다.
export function createSessionSnapshots(
  bus: Pick<Bus, "subscribe">,
  approvals: SessionApprovals,
) {
  const sessions = new Map<string, Entry>();

  function apply(event: AgentEvent): void {
    const { session } = event;
    if (event.type === "SessionStarted") {
      sessions.set(session, {
        agent: event.payload.agent,
        place: event.payload.place,
        running: false,
        heard: event.payload.agent.role !== "coding_agent",
        questions: [],
        requests: new Set(),
      });
      return;
    }
    if (event.type === "SessionEnded") {
      sessions.delete(session);
      return;
    }
    const entry = sessions.get(session);
    if (entry === undefined) return;
    switch (event.type) {
      case "TurnStarted":
        entry.running = true;
        entry.heard = true;
        break;
      case "TurnEnded":
        entry.running = false;
        entry.heard = true;
        break;
      case "PermissionRequested":
        entry.requests.add(event.payload.request.id);
        break;
      case "PermissionResolved":
        entry.requests.delete(event.payload.request);
        break;
      case "QuestionAsked":
        entry.questions.push({
          group: event.payload.group,
          turn: event.payload.turn,
          tool_call: event.payload.tool_call,
        });
        break;
      case "QuestionResolved":
        entry.questions = entry.questions.filter((question) =>
          question.group !== event.payload.group
        );
        break;
    }
  }

  const off = bus.subscribe([{ types: [...TYPES] }], {
    send(event: BusEvent) {
      if ("session" in event) apply(event as AgentEvent);
    },
    close() {},
  });

  function snapshotOf(session: string, entry: Entry): SessionSnapshot {
    const permission_requests = approvals.turnRequests(session as Id<"ses">);
    const waiting = permission_requests.length > 0 ||
      entry.questions.length > 0;
    return {
      session,
      agent: entry.agent,
      place: entry.place,
      state: waiting
        ? "waiting"
        : !entry.heard
        ? "unknown"
        : entry.running
        ? "running"
        : "idle",
      permission_requests: [...permission_requests],
      questions: [...entry.questions],
    } as SessionSnapshot;
  }

  return {
    // sessions를 생략하면 열린 session 전부다.
    list(only?: readonly string[]): SessionSnapshot[] {
      const found: SessionSnapshot[] = [];
      for (const [session, entry] of sessions) {
        if (only === undefined || only.includes(session)) {
          found.push(snapshotOf(session, entry));
        }
      }
      return found;
    },
    stop: off,
  };
}
