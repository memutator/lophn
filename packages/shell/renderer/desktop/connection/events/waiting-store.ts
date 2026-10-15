// 대기 목록. 사람이 답할 것(turn 안 request, 보류 request, 질문)을 session을 가리지 않고 한 목록에 든다.
// 항목은 원래 request 값을 그대로 들고, 같은 id는 한 번만 든다.
import type {
  PendingApproval,
  TurnPermissionRequest,
} from "../../../../../protocol/approvals/mod.ts";
import type {
  EventCondition,
  SessionSnapshot,
} from "../../../../../protocol/events/mod.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { placeOutputSchema } from "../../../../../protocol/lophn-agent/places.ts";
import type { z } from "zod";
import type { EventClient } from "./client.ts";
import type { TypedEvent } from "./typed.ts";
import { readPendingApprovals, readSessionSnapshots } from "./snapshots.ts";
import { createValueStore, syncOnReady } from "./store.ts";

type Place = z.infer<typeof placeOutputSchema>;

/** 질문 내용은 event와 snapshot 어디에도 없다. 내용은 질문 read로 따로 읽는다. */
export interface QuestionRequest {
  readonly group: string;
  readonly turn: string;
  readonly tool_call: string;
}

interface Common {
  readonly id: string;
  readonly session: string | null;
  readonly agent: CallAgent | null;
  readonly place: Place | null;
  /** event의 시각. snapshot에서 온 항목은 request가 만들어진 시각이다. */
  readonly receivedAt: string;
}

export type WaitingEntry =
  | Common & {
    readonly kind: "permission" | "coding";
    readonly request: TurnPermissionRequest;
  }
  | Common & { readonly kind: "question"; readonly request: QuestionRequest }
  | Common & {
    readonly kind: "activation" | "reaction";
    readonly request: PendingApproval;
  };

export interface WaitingState {
  readonly entries: readonly WaitingEntry[];
  readonly count: number;
}

export const WAITING_CONDITION: EventCondition = {
  types: [
    "SessionStarted",
    "PermissionRequested",
    "PermissionResolved",
    "QuestionAsked",
    "QuestionResolved",
    "ApprovalRequested",
  ],
};

/** 대기 목록에 드는 보류 request만 종류를 돌려준다. */
export function approvalWaitingKind(
  request: PendingApproval,
): "activation" | "reaction" | null {
  const kind = request.intent.kind;
  return kind === "activation" || kind === "reaction" ? kind : null;
}

export interface WaitingStore {
  get(): WaitingState;
  subscribe(listener: () => void): () => void;
  /** 결정을 낸 뒤 보류 request를 다시 읽어 맞춘다. */
  refresh(): Promise<void>;
  /** event client에 붙는다. 반환 함수가 뗀다. */
  start(): () => void;
}

export function createWaitingStore(
  client: EventClient,
  now: () => string,
): WaitingStore {
  const state = createValueStore<WaitingState>({ entries: [], count: 0 });
  let entries = new Map<string, WaitingEntry>();
  // session의 agent와 place는 SessionStarted에만 실려 온다.
  const sessions = new Map<
    string,
    { agent: CallAgent; place: Place | null }
  >();

  function publish() {
    const list = [...entries.values()];
    state.set({ entries: list, count: list.length });
  }

  function put(entry: WaitingEntry) {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }

  function permission(
    request: TurnPermissionRequest,
    receivedAt: string,
  ): WaitingEntry {
    const known = sessions.get(request.session);
    const actor = request.intent.actor;
    const agent = known?.agent ?? (actor.kind === "agent" ? actor.agent : null);
    return {
      id: request.id,
      kind: agent?.role === "coding_agent" ? "coding" : "permission",
      session: request.session,
      agent,
      place: known?.place ?? null,
      receivedAt,
      request,
    };
  }

  function approval(
    request: PendingApproval,
    kind: "activation" | "reaction",
  ): WaitingEntry {
    const actor = request.intent.actor;
    const target = request.intent.target;
    return {
      id: request.id,
      kind,
      session: null,
      agent: actor.kind === "agent" ? actor.agent : null,
      place: target.kind === "activation"
        ? { kind: "app", id: target.app }
        : null,
      receivedAt: request.created_at,
      request,
    };
  }

  function question(
    session: string,
    request: QuestionRequest,
    receivedAt: string,
  ): WaitingEntry {
    const known = sessions.get(session);
    return {
      id: request.group,
      kind: "question",
      session,
      agent: known?.agent ?? null,
      place: known?.place ?? null,
      receivedAt,
      request,
    };
  }

  function apply(event: TypedEvent) {
    switch (event.type) {
      case "SessionStarted":
        sessions.set(event.session, {
          agent: event.payload.agent,
          place: event.payload.place,
        });
        return;
      case "PermissionRequested":
        put(permission(event.payload.request, event.at));
        break;
      case "PermissionResolved":
        entries.delete(event.payload.request);
        break;
      case "QuestionAsked":
        put(question(event.session, event.payload, event.at));
        break;
      case "QuestionResolved":
        entries.delete(event.payload.group);
        break;
      case "ApprovalRequested": {
        const kind = approvalWaitingKind(event.payload.request);
        if (kind) put(approval(event.payload.request, kind));
        break;
      }
      default:
        return;
    }
    publish();
  }

  function replaceTurnRequests(snapshots: SessionSnapshot[]) {
    const at = now();
    const next: WaitingEntry[] = [];
    for (const snapshot of snapshots) {
      for (const request of snapshot.permission_requests) {
        next.push(permission(request, request.created_at));
      }
      for (const group of snapshot.questions) {
        next.push(question(snapshot.session, group, at));
      }
    }
    return next;
  }

  async function readAll() {
    const [snapshots, approvals] = await Promise.all([
      readSessionSnapshots(client.core),
      readPendingApprovals(client.core),
    ]);
    // 둘 다 읽혀야 통째로 맞춘다. 하나만 읽고 맞추면 읽지 못한 쪽 항목이 지워진다.
    if (snapshots === null || approvals === null) return null;
    return { snapshots, approvals };
  }

  function replace(
    read: { snapshots: SessionSnapshot[]; approvals: PendingApproval[] },
  ) {
    const next = replaceTurnRequests(read.snapshots);
    for (const request of read.approvals) {
      const kind = approvalWaitingKind(request);
      if (kind) next.push(approval(request, kind));
    }
    next.sort((a, b) => a.receivedAt < b.receivedAt ? -1 : 1);
    entries = new Map();
    for (const entry of next) put(entry);
    publish();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    async refresh() {
      const approvals = await readPendingApprovals(client.core);
      if (approvals === null) return;
      const pending = new Set(approvals.map((request) => request.id));
      for (const [id, entry] of entries) {
        if (
          (entry.kind === "activation" || entry.kind === "reaction") &&
          !pending.has(id)
        ) entries.delete(id);
      }
      for (const request of approvals) {
        const kind = approvalWaitingKind(request);
        if (kind) put(approval(request, kind));
      }
      publish();
    },
    start() {
      return client.subscribe(
        WAITING_CONDITION,
        syncOnReady({ read: readAll, replace, apply }),
      );
    },
  };
}
