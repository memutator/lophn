// 대기 목록. 사람이 답할 것(turn request, activation 동의, 질문, job 등록 승인, job의 놓친 차례)을 session을 가리지 않고 한 목록에 든다.
// 항목은 원래 request 값을 그대로 들고, 같은 id는 한 번만 든다.
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import type { ShareRequest } from "../../../../../protocol/approvals/share-request.ts";
import type { JobHold, JobRecord } from "../../../../../protocol/jobs/jobs.ts";
import type {
  BusEvent,
  EventCondition,
  SessionSnapshot,
} from "../../../../../protocol/events/mod.ts";
import type {
  AgentId,
  placeOutputSchema,
} from "../../../../../protocol/lophn-agent/places.ts";
import type { z } from "zod";
import type { TerminalApi, TerminalRuntime } from "../../../../ipc/terminal.ts";
import type { EventClient } from "./client.ts";
import {
  readActivationConsents,
  readJobHolds,
  readJobPending,
  readSessionSnapshots,
  readShareRequests,
} from "./snapshots.ts";
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
  readonly agent: AgentId | null;
  readonly place: Place | null;
  /** event의 시각. snapshot에서 온 항목은 request가 만들어진 시각이다. */
  readonly receivedAt: string;
}

export type WaitingEntry =
  | (Common & {
      readonly kind: "permission";
      readonly request: TurnRequest;
    })
  | (Common & { readonly kind: "question"; readonly request: QuestionRequest })
  // id는 release다. 같은 release는 한 줄이다.
  | (Common & {
      readonly kind: "activation";
      readonly request: ActivationConsent;
    })
  // 놓친 차례를 사람이 정한다. id는 job run이다. session도 request도 없는 job 표의 줄이다.
  | (Common & { readonly kind: "job_hold"; readonly hold: JobHold })
  // agent가 만든 job의 등록 승인. id는 job이다.
  | (Common & { readonly kind: "job_approval"; readonly job: JobRecord })
  // 앱 place의 agent가 청한 앱 공유. id는 앱이다(앱마다 열린 요청은 하나).
  | (Common & { readonly kind: "share"; readonly request: ShareRequest });

type JobReads = { holds: JobHold[]; pending: JobRecord[] };
const JOB_KINDS: readonly WaitingEntry["kind"][] = ["job_hold", "job_approval"];

/** 사람이 보지 않는 사이 turn이 끝난 터미널 탭의 coding agent. */
export interface FinishedTerminal {
  readonly terminalRef: string;
  readonly harness: string;
  /** 탭 제목. 없으면 시작 폴더 이름이다(OS 알림과 같은 규칙). */
  readonly title: string;
}

export interface WaitingState {
  readonly entries: readonly WaitingEntry[];
  /** entries 수. */
  readonly count: number;
  readonly finished: readonly FinishedTerminal[];
}

const WAITING_CONDITION: EventCondition = {
  types: [
    "SessionStarted",
    "TurnRequestOpened",
    "TurnRequestClosed",
    "QuestionAsked",
    "QuestionResolved",
    "ActivationConsentRequested",
    "ActivationConsentClosed",
    "ShareRequestOpened",
    "ShareRequestClosed",
    // session이 없는 event라 session 조건과 섞지 않고 types에만 건다.
    "JobChanged",
  ],
};

function folderName(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .at(-1) ?? ""
  );
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
): WaitingStore {
  const state = createValueStore<WaitingState>({
    entries: [],
    count: 0,
    finished: [],
  });
  let entries = new Map<string, WaitingEntry>();
  // main이 push하는 runtime에서만 안다. 창이 뜨기 전에 끝난 turn은 다음 push 때 보인다.
  const finished = new Map<string, FinishedTerminal>();
  // session의 agent와 place는 SessionStarted와 snapshot에 실려 온다.
  const sessions = new Map<string, { agent: AgentId; place: Place | null }>();

  function publish() {
    const list = [...entries.values()];
    state.set({
      entries: list,
      count: list.length,
      finished: [...finished.values()],
    });
  }

  // 탭 점이 finished인 때와 같다: turn이 끝났고(idle) 사람이 아직 보지 않았다. unseen은 main이 지운다.
  function noteFinished(runtime: TerminalRuntime) {
    const agent = runtime.agent;
    const ref = runtime.terminal_ref;
    if (agent?.state === "idle" && agent.unseen) {
      const next = {
        terminalRef: ref,
        harness: agent.harness,
        title: folderName(runtime.cwd_at_start),
      };
      const before = finished.get(ref);
      if (before?.harness === next.harness && before.title === next.title) {
        return;
      }
      finished.set(ref, next);
    } else if (!finished.delete(ref)) return;
    publish();
  }

  function put(entry: WaitingEntry) {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }

  // turn request에는 요청한 agent가 없다. session을 알 때만 agent와 place가 있다.
  function permission(request: TurnRequest, receivedAt: string): WaitingEntry {
    const known = sessions.get(request.session);
    return {
      id: request.id,
      kind: "permission",
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

  function share(request: ShareRequest): WaitingEntry {
    return {
      id: request.app,
      kind: "share",
      session: request.session,
      agent: null,
      place: { kind: "app", id: request.app },
      receivedAt: request.requested_at,
      request,
    };
  }

  function jobHold(hold: JobHold): WaitingEntry {
    return {
      id: hold.job_run.id,
      kind: "job_hold",
      session: null,
      agent: hold.job.creator.agent,
      place: hold.job.creator.place,
      receivedAt: hold.job_run.created_at,
      hold,
    };
  }

  function jobApproval(job: JobRecord): WaitingEntry {
    return {
      id: job.id,
      kind: "job_approval",
      session: null,
      agent: job.creator.agent,
      place: job.creator.place,
      receivedAt: job.created_at,
      job,
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
        return;
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
      case "ShareRequestOpened":
        // 새 요청이 옛 것을 대신하고 내용은 event에 없다. 다시 읽어 맞추고, 그 읽기가 publish한다.
        void refreshShares();
        return;
      case "ShareRequestClosed":
        entries.delete(event.payload.app);
        break;
      case "JobChanged":
        // 어느 줄이 바뀌었는지 event에 없다. hold와 승인 대기를 다시 읽어 맞추고, 그 읽기가 publish한다.
        void refreshJobs();
        return;
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

  // hold와 승인 대기는 둘 다 읽혀야 맞춘다.
  async function readJobs(): Promise<JobReads | null> {
    const [holds, pending] = await Promise.all([
      readJobHolds(client.core),
      readJobPending(client.core),
    ]);
    return holds === null || pending === null ? null : { holds, pending };
  }

  function jobEntries(jobs: JobReads): WaitingEntry[] {
    return [...jobs.pending.map(jobApproval), ...jobs.holds.map(jobHold)];
  }

  async function readAll() {
    const [snapshots, consents, shares, jobs] = await Promise.all([
      readSessionSnapshots(client.core),
      readActivationConsents(client.core),
      readShareRequests(client.core),
      readJobs(),
    ]);
    // snapshot과 동의와 공유 요청은 모두 읽혀야 통째로 맞춘다. 하나만 읽고 맞추면 읽지 못한 쪽 항목이 지워진다.
    // job은 따로 본다. 못 읽으면(null) 지금의 job 항목을 둔 채 나머지만 맞춘다.
    if (snapshots === null || consents === null || shares === null) {
      return null;
    }
    return { snapshots, consents, shares, jobs };
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

  async function refreshShares() {
    const shares = await readShareRequests(client.core);
    if (shares === null) return;
    const open = new Set(shares.map((one) => one.app));
    for (const [id, entry] of entries) {
      if (entry.kind === "share" && !open.has(id)) entries.delete(id);
    }
    for (const one of shares) entries.set(one.app, share(one));
    publish();
  }

  async function refreshJobs() {
    const jobs = await readJobs();
    if (jobs === null) return;
    const next = jobEntries(jobs);
    const open = new Set(next.map((one) => one.id));
    for (const [id, entry] of entries) {
      if (JOB_KINDS.includes(entry.kind) && !open.has(id)) entries.delete(id);
    }
    for (const one of next) put(one);
    publish();
  }

  function replace(read: {
    snapshots: SessionSnapshot[];
    consents: ActivationConsent[];
    shares: ShareRequest[];
    jobs: JobReads | null;
  }) {
    // job을 못 읽었으면 지금의 job 항목도 그대로 둔다.
    const kept = [...entries.values()].filter(
      (entry) => read.jobs === null && JOB_KINDS.includes(entry.kind),
    );
    const next = replaceTurnRequests(read.snapshots);
    for (const one of read.consents) next.push(consent(one));
    for (const one of read.shares) next.push(share(one));
    if (read.jobs !== null) next.push(...jobEntries(read.jobs));
    next.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
    entries = new Map();
    for (const entry of next) put(entry);
    for (const entry of kept) put(entry);
    publish();
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      const stopRuntime = terminals?.onRuntime((runtime) => {
        noteFinished(runtime);
      });
      const stopEvents = client.subscribe(
        WAITING_CONDITION,
        syncOnReady({ read: readAll, replace, apply }),
      );
      return () => {
        stopRuntime?.();
        stopEvents();
      };
    },
  };
}
