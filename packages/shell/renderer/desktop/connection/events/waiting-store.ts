// 대기 목록. 사람이 답할 것(turn request, activation 동의, 질문)을 session을 가리지 않고 한 목록에 든다.
// 항목은 원래 request 값을 그대로 들고, 같은 id는 한 번만 든다.
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import { HOOK_EVENT_TABLE } from "../../../../../protocol/coding-agent/hook-signal.ts";
import type { HarnessId } from "../../../../../protocol/coding-agent/harnesses.ts";
import type {
  BusEvent,
  EventCondition,
  SessionSnapshot,
} from "../../../../../protocol/events/mod.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { placeOutputSchema } from "../../../../../protocol/lophn-agent/places.ts";
import type { z } from "zod";
import type { TerminalApi, TerminalRuntime } from "../../../../ipc/terminal.ts";
import type { EventClient } from "./client.ts";
import { readActivationConsents, readSessionSnapshots } from "./snapshots.ts";
import { createValueStore, syncOnReady } from "./store.ts";

type Place = z.infer<typeof placeOutputSchema>;

/** 질문 내용은 event와 snapshot 어디에도 없다. 내용은 질문 read로 따로 읽는다. */
interface QuestionRequest {
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
  // coding은 harness가 물어 온 것이다. 답은 터미널에서 한다.
  | Common & {
    readonly kind: "permission" | "coding";
    readonly request: TurnRequest;
  }
  | Common & { readonly kind: "question"; readonly request: QuestionRequest }
  // 터미널을 열었는데 첫 hook 신호가 없다. folder trust 같은 확인에서 멈췄을 수 있다. id는 start:<session>이다.
  | Common & { readonly kind: "coding_start" }
  // id는 release다. 같은 release는 한 줄이다.
  | Common & {
    readonly kind: "activation";
    readonly request: ActivationConsent;
  };

export interface WaitingState {
  readonly entries: readonly WaitingEntry[];
  readonly count: number;
}

const WAITING_CONDITION: EventCondition = {
  types: [
    "SessionStarted",
    "SessionEnded",
    "TurnRequestOpened",
    "TurnRequestClosed",
    "QuestionAsked",
    "QuestionResolved",
    "ActivationConsentRequested",
    "ActivationConsentClosed",
  ],
};

/**
 * runtime(터미널을 연 창)과 snapshot(뒤에 연 창, 다시 붙은 창) 두 길이 같은 delay를 쓴다.
 * 정상 시작의 SessionStart는 이보다 빨리 온다고 보고 정한 값이다(근거 기록 없음). 이보다 늦으면 항목이 뜬다.
 */
const STARTING_QUIET_MS = 5000;

/** `setTimeout` 꼴. 전역을 읽지 않으려고 인자로 받는다. */
export interface Timer {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** 첫 신호가 SessionStarted인 harness만 터미널 시작 뒤 첫 신호를 기다릴 수 있다. */
function startsWithSessionStart(harness: string | undefined): boolean {
  const table = HOOK_EVENT_TABLE[harness as HarnessId];
  return table !== undefined &&
    Object.values(table).includes("SessionStarted");
}

interface WaitingStore {
  get(): WaitingState;
  subscribe(listener: () => void): () => void;
  /** event client에 붙는다. 반환 함수가 뗀다. */
  start(): () => void;
}

export function createWaitingStore(
  client: EventClient,
  now: () => string,
  terminals: Pick<TerminalApi, "onRuntime"> | null,
  timer: Timer,
): WaitingStore {
  const state = createValueStore<WaitingState>({ entries: [], count: 0 });
  let entries = new Map<string, WaitingEntry>();
  // session의 agent와 place는 SessionStarted와 snapshot에 실려 온다.
  const sessions = new Map<
    string,
    { agent: CallAgent; place: Place | null }
  >();

  // 첫 신호를 기다리는 coding session(runtime이나 snapshot에서 알았다). 항목이 뜬 뒤에도 끝날 때까지 남는다.
  const waitingStart = new Map<string, unknown>();
  // 첫 신호를 들었거나 끝난 session. runtime이 state마다 다시 와도 다시 세지 않는다.
  const done = new Set<string>();

  function stopWaitingStart(session: string) {
    done.add(session);
    if (!waitingStart.has(session)) return false;
    timer.clear(waitingStart.get(session));
    waitingStart.delete(session);
    return entries.delete(`start:${session}`);
  }

  function waitStart(
    session: string,
    app: string,
    harness: string | undefined,
  ) {
    if (done.has(session) || waitingStart.has(session)) return;
    if (!startsWithSessionStart(harness)) return;
    waitingStart.set(
      session,
      timer.set(() => {
        const known = sessions.get(session);
        put({
          id: `start:${session}`,
          kind: "coding_start",
          session,
          agent: known?.agent ?? { role: "coding_agent", app },
          place: known?.place ?? { kind: "app", id: app },
          receivedAt: now(),
        });
        publish();
      }, STARTING_QUIET_MS),
    );
  }

  function watchStart(runtime: TerminalRuntime) {
    const coding = runtime.coding_session;
    if (runtime.launch_kind !== "coding_tui" || !coding) return;
    const session = coding.session;
    if (done.has(session)) return;
    if (runtime.state === "exited" || runtime.state === "unknown") {
      if (stopWaitingStart(session)) publish();
      return;
    }
    waitStart(session, coding.app, runtime.product);
  }

  function publish() {
    const list = [...entries.values()];
    state.set({ entries: list, count: list.length });
  }

  function put(entry: WaitingEntry) {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }

  // turn request에는 요청한 agent가 없다. session을 알 때만 agent와 place가 있다.
  function permission(request: TurnRequest, receivedAt: string): WaitingEntry {
    const known = sessions.get(request.session);
    return {
      id: request.id,
      kind: request.subject.kind === "harness" ? "coding" : "permission",
      session: request.session,
      agent: known?.agent ?? null,
      place: known?.place ?? null,
      receivedAt,
      request,
    };
  }

  function consent(request: ActivationConsent): WaitingEntry {
    return {
      id: request.release,
      kind: "activation",
      session: null,
      agent: null,
      place: { kind: "app", id: request.app },
      receivedAt: request.requested_at,
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

  function apply(event: BusEvent) {
    switch (event.type) {
      case "SessionStarted":
        sessions.set(event.session, {
          agent: event.payload.agent,
          place: event.payload.place,
        });
        if (!stopWaitingStart(event.session)) return;
        break;
      case "SessionEnded":
        if (!stopWaitingStart(event.session)) return;
        break;
      case "TurnRequestOpened":
        put(permission(event.payload.request, event.at));
        break;
      case "TurnRequestClosed":
        entries.delete(event.payload.request);
        break;
      case "QuestionAsked":
        put(question(event.session, event.payload, event.at));
        break;
      case "QuestionResolved":
        entries.delete(event.payload.group);
        break;
      case "ActivationConsentRequested":
        // 비교 내용은 event에 없다. 동의 대기를 다시 읽어 맞추고, 그 읽기가 publish한다.
        void refreshConsents();
        return;
      case "ActivationConsentClosed":
        entries.delete(event.payload.release);
        break;
      default:
        return;
    }
    publish();
  }

  function replaceTurnRequests(snapshots: SessionSnapshot[]) {
    const at = now();
    const next: WaitingEntry[] = [];
    for (const snapshot of snapshots) {
      sessions.set(snapshot.session, {
        agent: snapshot.agent,
        place: snapshot.place,
      });
      for (const request of snapshot.turn_requests) {
        next.push(permission(request, request.created_at));
      }
      for (const group of snapshot.questions) {
        next.push(question(snapshot.session, group, at));
      }
    }
    return next;
  }

  async function readAll() {
    const [snapshots, consents] = await Promise.all([
      readSessionSnapshots(client.core),
      readActivationConsents(client.core),
    ]);
    // 둘 다 읽혀야 통째로 맞춘다. 하나만 읽고 맞추면 읽지 못한 쪽 항목이 지워진다.
    if (snapshots === null || consents === null) return null;
    return { snapshots, consents };
  }

  async function refreshConsents() {
    const consents = await readActivationConsents(client.core);
    if (consents === null) return;
    const open = new Set(consents.map((one) => one.release));
    for (const [id, entry] of entries) {
      if (entry.kind === "activation" && !open.has(id)) entries.delete(id);
    }
    for (const one of consents) put(consent(one));
    publish();
  }

  function replace(
    read: { snapshots: SessionSnapshot[]; consents: ActivationConsent[] },
  ) {
    // snapshot에서 첫 신호를 들은 session이거나 없는 session은 기다리지 않는다.
    for (const session of [...waitingStart.keys()]) {
      const snapshot = read.snapshots.find((one) => one.session === session);
      if (snapshot?.state !== "unknown") stopWaitingStart(session);
    }
    // 이미 첫 신호를 들은 session은 done에 넣어, 다시 붙은 뒤 온 runtime event가 새로 세지 않게 한다.
    for (const snapshot of read.snapshots) {
      if (snapshot.agent.role !== "coding_agent") continue;
      if (snapshot.state === "unknown") {
        waitStart(snapshot.session, snapshot.agent.app, snapshot.harness);
      } else stopWaitingStart(snapshot.session);
    }
    const starts = [...entries.values()].filter((entry) =>
      entry.kind === "coding_start"
    );
    const next = replaceTurnRequests(read.snapshots);
    for (const one of read.consents) next.push(consent(one));
    next.sort((a, b) => a.receivedAt < b.receivedAt ? -1 : 1);
    entries = new Map();
    for (const entry of next) put(entry);
    for (const entry of starts) put(entry);
    publish();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      const stopRuntime = terminals?.onRuntime(watchStart);
      const stopEvents = client.subscribe(
        WAITING_CONDITION,
        syncOnReady({ read: readAll, replace, apply }),
      );
      return () => {
        stopRuntime?.();
        stopEvents();
        for (const handle of waitingStart.values()) timer.clear(handle);
      };
    },
  };
}
