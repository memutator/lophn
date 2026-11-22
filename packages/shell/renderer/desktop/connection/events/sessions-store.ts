// session 목록과 상태. 상태는 event와 snapshot에서 이 쪽이 계산한다.
// 다른 컴퓨터에서 도는 팀원의 자리(snapshot의 `runs_on`)는 이 컴퓨터에서 도는 session이 아니라 `sessions`에 넣지 않고 `members`에 따로
// 둔다(Recent, 찾기, 넘기기, session 고르기가 자리를 session으로 보지 않게). 자리에는 `SessionStarted`가 없어 `StateChanged{sessions}`
// (자리가 열림)와 `StateChanged{agent_calls}`(spawn call의 배달이 바뀜)에 자리의 snapshot을 다시 읽는다.
import type { z } from "zod";
import type {
  BusEvent,
  EventCondition,
  SessionSnapshot,
  SessionState,
} from "../../../../../protocol/events/mod.ts";
import type {
  AgentId,
  workspaceOutputSchema,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import type { EventClient } from "./client.ts";
import { readSessionSnapshots } from "./snapshots.ts";
import { createValueStore, syncOnReady } from "./store.ts";
import type { UnseenStore } from "./unseen-store.ts";

type Workspace = z.infer<typeof workspaceOutputSchema>;
type EndReason = "archived" | "deleted" | "exited" | "lophn_stopped";

export interface SessionEntry {
  readonly session: string;
  readonly state: SessionState;
  readonly archived: boolean;
  /** 끝났다면 이유. 끝난 session도 기록으로는 남는다(지운 것은 목록에서 빠진다). */
  readonly ended: EndReason | null;
  readonly agent: AgentId | null;
  readonly workspace: Workspace | null;
  /** 팀(spawn tree)의 부모 session. 팀 밖이거나 모르면 null. */
  readonly spawnedBy: string | null;
  /** 사람이 보지 않는 사이 turn이 끝났다(Agent 탭의 finished 점). core가 정한다(`unseen`). */
  readonly unseen: boolean;
}

/** 다른 컴퓨터에서 도는 팀원의 자리. 끝난 자리는 빠진다. */
export interface MemberEntry {
  readonly session: string;
  readonly workspace: Workspace | null;
  /** 이 컴퓨터의 부모 session. */
  readonly spawnedBy: string | null;
  readonly runsOn: {
    readonly machine: string;
    /** spawn 때의 명단 이름. */
    readonly computer: string;
    /** 그 컴퓨터의 agent handle. */
    readonly handle: string;
    /** pending: 아직 닿지 않음(꺼졌거나 mail이 가는 중), held: 그 컴퓨터의 대기 목록, running: 그 컴퓨터가 받음. */
    readonly state: "pending" | "held" | "running";
    /** 사람이 보관할 때의 compare. */
    readonly stateSeq: string;
  };
}

export interface SessionsState {
  readonly sessions: readonly SessionEntry[];
  readonly members: readonly MemberEntry[];
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
    "StateChanged",
  ],
};

// 상태는 대기 중인 물음이 있으면 waiting, turn이 돌면 running, 아니면 base(idle, 신호가 없으면 unknown)다.
interface Record_ {
  base: "idle" | "unknown";
  turnActive: boolean;
  pending: Set<string>;
  ended: EndReason | null;
  agent: AgentId | null;
  workspace: Workspace | null;
  spawnedBy: string | null;
}

interface SessionsStore {
  get(): SessionsState;
  subscribe(listener: () => void): () => void;
  start(): () => void;
}

export function createSessionsStore(
  client: EventClient,
  unseen: Pick<UnseenStore, "get" | "subscribe"> | null = null,
): SessionsStore {
  const state = createValueStore<SessionsState>({ sessions: [], members: [] });
  let records = new Map<string, Record_>();
  let members = new Map<string, MemberEntry>();

  function publish() {
    const sessions: SessionEntry[] = [];
    for (const [session, record] of records) {
      sessions.push({
        session,
        state:
          record.pending.size > 0
            ? "waiting"
            : record.turnActive
              ? "running"
              : record.base,
        archived: record.ended === "archived",
        ended: record.ended,
        agent: record.agent,
        workspace: record.workspace,
        spawnedBy: record.spawnedBy,
        unseen: unseen?.get().marks.has(session) ?? false,
      });
    }
    state.set({ sessions, members: [...members.values()] });
  }

  // 끝난 자리와 읽어도 없는 자리는 뺀다.
  function putMember(snapshot: SessionSnapshot) {
    const place = snapshot.runs_on;
    if (place === null) return;
    if (place.state === "ended") {
      members.delete(snapshot.session);
      return;
    }
    members.set(snapshot.session, {
      session: snapshot.session,
      workspace: snapshot.workspace,
      spawnedBy: snapshot.spawned_by,
      runsOn: {
        machine: place.machine,
        computer: place.computer,
        handle: place.handle,
        state: place.state,
        stateSeq: place.state_seq,
      },
    });
  }

  async function readMembers(ids: string[]) {
    const snapshots = await readSessionSnapshots(client.core, ids);
    if (snapshots === null) return;
    const found = new Set(snapshots.map((snapshot) => snapshot.session));
    for (const id of ids) if (!found.has(id)) members.delete(id);
    for (const snapshot of snapshots) putMember(snapshot);
    publish();
  }

  // 이 컴퓨터의 session이 바뀐 것은 다른 event가 알린다. 모르는 id(새 자리일 수 있다)와 아는 자리만 다시 읽는다.
  function membersChanged(event: Extract<BusEvent, { type: "StateChanged" }>) {
    const ids = new Set<string>();
    for (const change of event.payload.changes) {
      if (
        change.name === "sessions" &&
        change.id !== null &&
        !records.has(change.id)
      ) {
        ids.add(change.id);
      } else if (change.name === "agent_calls") {
        for (const id of members.keys()) ids.add(id);
      }
    }
    if (ids.size > 0) void readMembers([...ids]);
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
        workspace: null,
        spawnedBy: null,
      };
      records.set(session, record);
    }
    return record;
  }

  function apply(event: BusEvent) {
    switch (event.type) {
      case "SessionStarted": {
        const { agent, workspace, spawned_by } = event.payload;
        records.set(event.session, {
          base: "idle",
          turnActive: false,
          pending: new Set(),
          ended: null,
          agent,
          workspace,
          spawnedBy: spawned_by,
        });
        break;
      }
      case "SessionEnded":
        if (members.delete(event.session)) break;
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
      case "StateChanged":
        membersChanged(event);
        return;
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
    members = new Map();
    for (const snapshot of snapshots) {
      if (snapshot.runs_on !== null) {
        putMember(snapshot);
        continue;
      }
      next.set(snapshot.session, {
        base: snapshot.state === "unknown" ? "unknown" : "idle",
        turnActive:
          snapshot.state === "running" || snapshot.state === "waiting",
        pending: new Set([
          ...snapshot.turn_requests.map((request) => request.id),
          ...snapshot.questions.map((question) => question.group),
        ]),
        ended: null,
        agent: snapshot.agent,
        workspace: snapshot.workspace,
        spawnedBy: snapshot.spawned_by,
      });
    }
    records = next;
    publish();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      const stopUnseen = unseen?.subscribe(publish);
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
