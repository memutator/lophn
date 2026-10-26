// session 목록과 상태. 상태는 event와 snapshot에서 이 쪽이 계산한다.
import type { z } from "zod";
import type {
  BusEvent,
  EventCondition,
  SessionSnapshot,
  SessionState,
} from "../../../../../protocol/events/mod.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { placeOutputSchema } from "../../../../../protocol/lophn-agent/places.ts";
import type { LophnNoticeApi, UnseenSession } from "../../../../ipc/notice.ts";
import type { EventClient } from "./client.ts";
import { readSessionSnapshots } from "./snapshots.ts";
import { createValueStore, syncOnReady } from "./store.ts";

type Place = z.infer<typeof placeOutputSchema>;
type EndReason = "archived" | "deleted" | "exited" | "lophn_stopped";

export interface SessionEntry {
  readonly session: string;
  readonly state: SessionState;
  readonly archived: boolean;
  /** 끝났다면 이유. 끝난 session도 기록으로는 남는다(지운 것은 목록에서 빠진다). */
  readonly ended: EndReason | null;
  readonly agent: CallAgent | null;
  readonly place: Place | null;
  /** 사람이 보지 않는 사이 turn이 끝났다(Agent 탭의 finished 점). main이 정하고 agent 이름·얼굴·session 이름까지 읽어 보낸다. */
  readonly unseen: UnseenSession | null;
}

export interface SessionsState {
  readonly sessions: readonly SessionEntry[];
}

const SESSIONS_CONDITION: EventCondition = {
  types: [
    "SessionStarted",
    "SessionEnded",
    "TurnStarted",
    "TurnEnded",
    "TurnRequestOpened",
    "TurnRequestClosed",
    "QuestionAsked",
    "QuestionResolved",
  ],
};

// 상태는 대기 중인 물음이 있으면 waiting, turn이 돌면 running, 아니면 base(idle, 신호가 없으면 unknown)다.
interface Record_ {
  base: "idle" | "unknown";
  turnActive: boolean;
  pending: Set<string>;
  ended: EndReason | null;
  agent: CallAgent | null;
  place: Place | null;
}

interface SessionsStore {
  get(): SessionsState;
  subscribe(listener: () => void): () => void;
  start(): () => void;
}

export function createSessionsStore(
  client: EventClient,
  notice: Pick<LophnNoticeApi, "unseen" | "onUnseen"> | null = null,
): SessionsStore {
  const state = createValueStore<SessionsState>({ sessions: [] });
  let records = new Map<string, Record_>();
  // 창이 여럿이어도 정본은 main 하나라 이 쪽은 받은 목록을 그대로 둔다.
  let unseen: ReadonlyMap<string, UnseenSession> = new Map();

  function publish() {
    const sessions: SessionEntry[] = [];
    for (const [session, record] of records) {
      sessions.push({
        session,
        state: record.pending.size > 0
          ? "waiting"
          : record.turnActive
          ? "running"
          : record.base,
        archived: record.ended === "archived",
        ended: record.ended,
        agent: record.agent,
        place: record.place,
        unseen: unseen.get(session) ?? null,
      });
    }
    state.set({ sessions });
  }

  function recordOf(session: string): Record_ {
    let record = records.get(session);
    if (!record) {
      record = {
        base: "unknown",
        turnActive: false,
        pending: new Set(),
        ended: null,
        agent: null,
        place: null,
      };
      records.set(session, record);
    }
    return record;
  }

  function apply(event: BusEvent) {
    switch (event.type) {
      case "SessionStarted": {
        const { agent, place } = event.payload;
        records.set(event.session, {
          base: agent.role === "coding_agent" ? "unknown" : "idle",
          turnActive: false,
          pending: new Set(),
          ended: null,
          agent,
          place,
        });
        break;
      }
      case "SessionEnded":
        if (event.payload.reason === "deleted") records.delete(event.session);
        else recordOf(event.session).ended = event.payload.reason;
        break;
      case "TurnStarted": {
        const record = recordOf(event.session);
        record.turnActive = true;
        record.base = "idle";
        break;
      }
      case "TurnEnded": {
        const record = recordOf(event.session);
        record.turnActive = false;
        record.base = "idle";
        break;
      }
      case "TurnRequestOpened":
        recordOf(event.session).pending.add(event.payload.request.id);
        break;
      case "TurnRequestClosed":
        recordOf(event.session).pending.delete(event.payload.request);
        break;
      case "QuestionAsked":
        recordOf(event.session).pending.add(event.payload.group);
        break;
      case "QuestionResolved":
        recordOf(event.session).pending.delete(event.payload.group);
        break;
      default:
        return;
    }
    publish();
  }

  // snapshot은 열린 session 전부다. 없는 session은 지우되 archive한 것은 기록으로 둔다.
  function replace(snapshots: SessionSnapshot[]) {
    const next = new Map<string, Record_>();
    for (const [session, record] of records) {
      if (record.ended === "archived") next.set(session, record);
    }
    for (const snapshot of snapshots) {
      next.set(snapshot.session, {
        base: snapshot.state === "unknown" ? "unknown" : "idle",
        turnActive: snapshot.state === "running" ||
          snapshot.state === "waiting",
        pending: new Set([
          ...snapshot.turn_requests.map((request) => request.id),
          ...snapshot.questions.map((question) => question.group),
        ]),
        ended: null,
        agent: snapshot.agent,
        place: snapshot.place,
      });
    }
    records = next;
    publish();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      const stopUnseen = notice?.onUnseen((sessions) => {
        unseen = new Map(sessions.map((one) => [one.session, one]));
        publish();
      });
      void notice?.unseen().then((sessions) => {
        unseen = new Map(sessions.map((one) => [one.session, one]));
        publish();
      });
      const stop = client.subscribe(
        SESSIONS_CONDITION,
        syncOnReady({
          read: () => readSessionSnapshots(client.core),
          replace,
          apply,
        }),
      );
      return () => {
        stopUnseen?.();
        stop();
      };
    },
  };
}
