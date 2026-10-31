// gallery와 dev-mock이 쓰는 대기 목록 fake. events의 fake Gateway에 대기 항목을 채우고, 결정과 질문 답 route를
// 메모리에서 받아 항목을 빼고 event를 흘린다.
import {
  type TurnRequest,
  turnRequestDecide,
} from "../../../../../protocol/approvals/turn-request.ts";
import {
  type ActivationConsent,
  activationConsent,
  activationConsents,
} from "../../../../../protocol/apps/activation/consent.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../protocol/events/mod.ts";
import {
  jobDecideHold,
  type JobHold,
  jobHolds,
} from "../../../../../protocol/jobs/jobs.ts";
import {
  askAnswer,
  type AskQuestion,
  askRead,
} from "../../../../../protocol/lophn-agent/ask-tool.ts";
import type { AgentId } from "../../../../../protocol/lophn-agent/places.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import { createFakeSource, type FakeSource } from "../events/fake-source.ts";
import type { SettledRow } from "./settled.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
const PROJECT = id("prj", 1);
const ORDERS = id("app", 1);
const BUDGET = id("app", 2);
const INVENTORY = id("app", 3);

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

interface FakeSession {
  readonly id: string;
  readonly agent: AgentId;
  readonly place: SessionSnapshot["place"];
}

const AGENT_SESSION: FakeSession = {
  id: id("ses", 1),
  agent: id("agt", 1),
  place: { kind: "project", id: PROJECT },
};
const LOPHN_SESSION: FakeSession = {
  id: id("ses", 4),
  agent: "lophn",
  place: null,
};

function turnRequest(
  n: number,
  session: FakeSession,
  minutes: number,
  subject: TurnRequest["subject"],
  alwaysPatterns: string[] = [],
): { session: FakeSession; request: TurnRequest } {
  return {
    session,
    request: {
      id: id("apr", n),
      session: session.id,
      turn: id("trn", n),
      tool_call: id("tcl", n),
      subject,
      always_patterns: alwaysPatterns,
      created_at: ago(minutes),
    },
  };
}

export const SHELL_COMMAND = () =>
  turnRequest(
    11,
    AGENT_SESSION,
    1,
    { kind: "shell", command: "git push --force origin main" },
    ["git push *"],
  );

// 지금은 할당된 tool의 바깥 효과를 묻지 않아 실제로는 이 물음이 나오지 않는다. tool 카드의 그림 하나로 둔다.
export const EXTERNAL_CALL = () =>
  turnRequest(12, AGENT_SESSION, 4, {
    kind: "mcp_tool",
    server: "mail",
    tool: "send_message",
    effect: "external",
  });

const RELEASE_6 = id("rel", 6);
const RELEASE_7 = id("rel", 7);

export const ACTIVATION = (): ActivationConsent => ({
  app: ORDERS,
  app_name: "Orders",
  release: RELEASE_7,
  comparison: {
    previous_release: RELEASE_6,
    first: false,
    added_resources: [
      "net.fetch:api.payments.example:443",
      "secret.use:PAYMENTS_KEY",
      "fs.write:/exports/**",
    ],
    added_tools: [{ app: INVENTORY, tool: "stock.adjust" }],
    loss_steps: [
      {
        from: 3,
        to: 4,
        loss: [
          { kind: "drop_table", table: "legacy_orders" },
          { kind: "drop_column", table: "orders", column: "note" },
          { kind: "narrow_type", table: "orders", column: "total" },
        ],
      },
    ],
  },
  requested_at: ago(3),
});

export const FIRST_ACTIVATION = (): ActivationConsent => ({
  app: BUDGET,
  app_name: "Budget",
  release: id("rel", 1),
  comparison: {
    previous_release: null,
    first: true,
    added_resources: [
      "net.fetch:rates.example.org:443",
      "secret.use:RATES_KEY",
      "fs.read:/imports/**",
    ],
    added_tools: [{ app: ORDERS, tool: "refunds.create" }],
    loss_steps: [],
  },
  requested_at: ago(1),
});

const hoursAgo = (hours: number) => ago(hours * 60);
const jid = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;

function jobHold(
  n: number,
  dueHoursAgo: number,
  missed: number,
  job: Pick<JobHold["job"], "title" | "creator" | "every" | "at" | "action">,
): JobHold {
  const due = hoursAgo(dueHoursAgo);
  return {
    job: {
      id: jid("job", n),
      ...job,
      missed_policy: "hold",
      enabled: true,
      next_due_at: hoursAgo(-6),
      last_run: {
        job_run: jid("jbr", n),
        state: "held",
        due_at: due,
        started_at: null,
        ended_at: null,
      },
      created_at: hoursAgo(24 * 30),
      updated_at: hoursAgo(48),
    },
    job_run: {
      id: jid("jbr", n),
      job: jid("job", n),
      due_at: due,
      missed_count: missed,
      state: "held",
      reason: null,
      run: null,
      instance: null,
      session: null,
      started_at: null,
      ended_at: null,
      created_at: ago(dueHoursAgo * 60 - 5),
    },
  };
}

/** lophn이 만든 agent 호출. 한 번 놓쳤다. */
export const JOB_HOLD_AGENT = () =>
  jobHold(11, 9, 1, {
    title: "Morning digest",
    creator: { agent: "lophn", place: null },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: "lophn",
      agent_place: { kind: "project", id: PROJECT },
      prompt:
        "Summarize yesterday's finished tasks and list the open questions for today.",
    },
  });

/** 앱 place에서 만든 앱 tool 호출. 한 번 놓쳤다. */
export const JOB_HOLD_TOOL = () =>
  jobHold(13, 6, 1, {
    title: "Archive old orders",
    creator: { agent: "lophn", place: { kind: "app", id: ORDERS } },
    every: "12h",
    at: null,
    action: { kind: "tool_run", app: ORDERS, tool: "archive_old" },
  });

/** project place에서 만든 workflow 시작. 세 번 놓쳤다. */
export const JOB_HOLD_WORKFLOW = () =>
  jobHold(12, 48, 3, {
    title: "Weekly review",
    creator: { agent: "lophn", place: { kind: "project", id: PROJECT } },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PROJECT,
      workflow: "weekly-review",
      text: "Review last week's experiments and propose next steps.",
    },
  });

/** 앞 차례가 아직 돌아 [Start now]가 conflict로 막히는 workflow 시작. */
export const JOB_HOLD_BLOCKED = () => ({
  ...JOB_HOLD_WORKFLOW(),
  blocked: true as const,
});

const QUESTION_GROUP = id("qgr", 1);
const QUESTION_TURN = id("trn", 31);
const QUESTION_CALL = id("tcl", 31);

const QUESTION: readonly AskQuestion[] = [
  {
    question:
      "Include the three flaky scenarios in this week's regression count?",
    header: "Regression count",
    options: [
      { label: "Include them", description: "Count them as failures." },
      { label: "Leave them out", description: "Count only stable scenarios." },
    ],
    multiSelect: false,
  },
];

type Item =
  | ReturnType<typeof turnRequest>
  | ActivationConsent
  | JobHold
  | ReturnType<typeof JOB_HOLD_BLOCKED>
  | "question";

/** 모든 종류가 섞인 한 목록. */
export const allItems = (): readonly Item[] => [
  SHELL_COMMAND(),
  "question",
  ACTIVATION(),
  JOB_HOLD_AGENT(),
];

/** 결정한 뒤 잠깐 남는 줄 시나리오. */
export const SETTLED: readonly SettledRow[] = [
  {
    id: "settled-allowed",
    title: "Activate a new version of App 000001",
    who: "App 000001",
    state: "allowed",
  },
  {
    id: "settled-denied",
    title: "Run a command",
    who: "Agent · Session 000001 · Project 000001",
    state: "denied",
    agent: "Agent",
  },
  {
    id: "settled-cancelled",
    title: "Run a command",
    who: "Agent · Session 000001 · Project 000001",
    state: "cancelled",
  },
];

const COMMON = { as_of_seq: "0", next_cursor: null };

type Fake = ReturnType<typeof createFakeSource>;

// Gateway가 보내는 event를 그대로 흘린다. 모양은 받는 쪽이 busEventSchema로 읽는다.
function emitEvent(source: Fake, event: Record<string, unknown>) {
  source.emit({ kind: "event", event });
}

function ok(value: unknown): Promise<CoreReply> {
  return Promise.resolve({ ok: true, value });
}

function fail(code: string): Promise<CoreReply> {
  return Promise.resolve({ ok: false, error: { code, message: "fake" } });
}

/** 항목을 채운 fake Gateway. 열려 있는 동안 결정하면 항목이 빠진다. */
export function createFakeWaiting(
  items: readonly Item[] = allItems(),
): FakeSource {
  const sessions = new Map<string, SessionSnapshot>();
  const used: FakeSession[] = [];
  let consents: ActivationConsent[] = [];
  let holds: JobHold[] = [];
  const blocked = new Set<string>();
  let questionSession: FakeSession | null = null;

  function snapshotOf(session: FakeSession): SessionSnapshot {
    let snapshot = sessions.get(session.id);
    if (!snapshot) {
      snapshot = {
        session: session.id,
        agent: session.agent,
        place: session.place,
        state: "waiting",
        turn_requests: [],
        questions: [],
      };
      sessions.set(session.id, snapshot);
      used.push(session);
    }
    return snapshot;
  }

  for (const item of items) {
    if (item === "question") {
      questionSession = LOPHN_SESSION;
      const snapshot = snapshotOf(LOPHN_SESSION);
      sessions.set(snapshot.session, {
        ...snapshot,
        questions: [
          {
            group: QUESTION_GROUP,
            turn: QUESTION_TURN,
            tool_call: QUESTION_CALL,
          },
        ],
      });
    } else if ("request" in item) {
      const snapshot = snapshotOf(item.session);
      sessions.set(snapshot.session, {
        ...snapshot,
        turn_requests: [...snapshot.turn_requests, item.request],
      });
    } else if ("job_run" in item) {
      holds.push(item);
      if ("blocked" in item) blocked.add(item.job_run.id);
    } else {
      consents.push(item);
    }
  }

  const base = createFakeSource();
  const at = () => new Date().toISOString();

  return {
    ...base,
    // 창 사이에서 열려 있던 session의 SessionStarted는 Gateway가 다시 보내지 않으니 조건이 걸릴 때 먼저 흘린다.
    watch(conditions) {
      const done = base.watch!(conditions);
      for (const session of used) {
        emitEvent(base, {
          session: session.id,
          type: "SessionStarted",
          at: at(),
          payload: {
            agent: session.agent,
            place: session.place,
            revived: false,
          },
        });
      }
      return done;
    },
    call(input) {
      const key = `${input.kind}:${input.resource}/${input.method}`;
      const body = input.body as Record<string, unknown>;
      if (
        key ===
        `read:${sessionSnapshotsList.resource}/${sessionSnapshotsList.method}`
      ) {
        return ok({ ...COMMON, snapshots: [...sessions.values()] });
      }
      if (
        key ===
        `read:${activationConsents.resource}/${activationConsents.method}`
      ) {
        return ok({ ...COMMON, consents });
      }
      if (
        key ===
        `memory:${turnRequestDecide.resource}/${turnRequestDecide.method}`
      ) {
        const session = sessions.get(String(body.session));
        const request = session?.turn_requests.find(
          (r) => r.id === body.request,
        );
        if (!session || !request) return fail("not_found");
        const choice = body.choice as { kind: string; reason?: string };
        sessions.set(session.session, {
          ...session,
          turn_requests: session.turn_requests.filter((r) => r !== request),
        });
        const allowed = choice.kind !== "reject";
        emitEvent(base, {
          session: session.session,
          type: "TurnRequestClosed",
          at: at(),
          payload: {
            request: request.id,
            outcome: allowed ? "allow" : "reject",
          },
        });
        return ok({
          outcome: allowed
            ? { outcome: "allow", scope: choice.kind }
            : { outcome: "reject", reason: choice.reason ?? null },
        });
      }
      if (
        key ===
        `command:${activationConsent.resource}/${activationConsent.method}`
      ) {
        const decided = body.input as { release: string; choice: string };
        const consent = consents.find((c) => c.release === decided.release);
        if (!consent) return fail("not_found");
        consents = consents.filter((c) => c !== consent);
        emitEvent(base, {
          type: "ActivationConsentClosed",
          subject: consent.release,
          at: at(),
          payload: {
            app: consent.app,
            release: consent.release,
            outcome: decided.choice,
          },
        });
        return ok({ release: consent.release, outcome: decided.choice });
      }
      if (key === `read:${jobHolds.resource}/${jobHolds.method}`) {
        return ok({ ...COMMON, holds });
      }
      if (key === `command:${jobDecideHold.resource}/${jobDecideHold.method}`) {
        const decided = body.input as { job_run: string; choice: string };
        const hold = holds.find((h) => h.job_run.id === decided.job_run);
        if (!hold) return fail("not_found");
        if (decided.choice === "run_now" && blocked.has(decided.job_run)) {
          return fail("conflict");
        }
        holds = holds.filter((h) => h !== hold);
        emitEvent(base, {
          type: "JobChanged",
          subject: hold.job.id,
          at: at(),
          payload: { job_run: hold.job_run.id },
        });
        return ok({ job_run: hold.job_run });
      }
      if (key === `memory:${askRead.resource}/${askRead.method}`) {
        return questionSession === null
          ? fail("not_found")
          : ok({ group: QUESTION_GROUP, questions: QUESTION });
      }
      if (key === `memory:${askAnswer.resource}/${askAnswer.method}`) {
        if (questionSession === null) return fail("not_found");
        const session = sessions.get(questionSession.id)!;
        sessions.set(session.session, { ...session, questions: [] });
        questionSession = null;
        emitEvent(base, {
          session: session.session,
          type: "QuestionResolved",
          at: at(),
          payload: { group: QUESTION_GROUP, outcome: "submitted" },
        });
        return ok({ outcome: "submitted", answers: body.answers });
      }
      return base.call(input);
    },
  };
}
