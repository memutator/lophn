// gallery와 dev-mock이 쓰는 대기 목록 fake. events의 fake Gateway에 대기 항목을 채우고, 결정과 질문 답 route를
// 메모리에서 받아 항목을 빼고 event를 흘린다.
import {
  approvalsDecide,
  approvalsDecideTurn,
  approvalsPending,
  type PendingApproval,
  type RequestChoice,
  type TurnPermissionRequest,
} from "../../../../../protocol/approvals/mod.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../protocol/events/mod.ts";
import {
  askAnswer,
  type AskQuestion,
  askRead,
} from "../../../../../protocol/lophn-agent/ask-tool.ts";
import type { JsonObject } from "../../../../../protocol/base/json-values.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { AgentRef } from "../../../../../protocol/lophn-agent/places.ts";
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
  readonly agent: CallAgent;
  /** intent의 요청한 agent. coding session은 그 앱의 App Engineer가 맡긴 일로 둔다. */
  readonly actor: AgentRef;
  readonly place: SessionSnapshot["place"];
}

const OPERATOR_SESSION: FakeSession = {
  id: id("ses", 1),
  agent: { role: "operator", agent: id("agt", 1) },
  actor: { role: "operator", agent: id("agt", 1) },
  place: { kind: "project", id: PROJECT },
};
const MANAGER_SESSION: FakeSession = {
  id: id("ses", 2),
  agent: { role: "project_manager", project: PROJECT },
  actor: { role: "project_manager", project: PROJECT },
  place: { kind: "project", id: PROJECT },
};
const CODING_SESSION: FakeSession = {
  id: id("ses", 3),
  agent: { role: "coding_agent", app: ORDERS },
  actor: { role: "app_engineer", app: ORDERS },
  place: { kind: "app", id: ORDERS },
};
const LOPHN_SESSION: FakeSession = {
  id: id("ses", 4),
  agent: { role: "lophn" },
  actor: { role: "lophn" },
  place: null,
};

type Turn = Omit<TurnPermissionRequest, "id" | "created_at" | "session">;

function turnRequest(
  n: number,
  session: FakeSession,
  minutes: number,
  parts: Pick<Turn, "intent" | "choices">,
): { session: FakeSession; request: TurnPermissionRequest } {
  const origin = {
    kind: "turn" as const,
    session: session.id,
    turn: id("trn", n),
    tool_call: id("tcl", n),
  };
  return {
    session,
    request: {
      id: id("apr", n),
      session: session.id,
      turn: origin.turn,
      tool_call: origin.tool_call,
      intent: { ...parts.intent, origin },
      choices: parts.choices,
      fingerprint: "0".repeat(64),
      created_at: ago(minutes),
    },
  };
}

const TOOL_CHOICES: RequestChoice[] = ["once", "session", "always", "reject"];
const ALLOW_CHOICES: RequestChoice[] = ["allow", "reject"];

type Draft = Pick<TurnPermissionRequest, "intent">["intent"];

function agentIntent(
  session: FakeSession,
  rest: Pick<Draft, "kind" | "target" | "effect" | "input">,
): Draft {
  return {
    ...rest,
    actor: { kind: "agent", agent: session.actor, session: session.id },
    origin: { kind: "event", seq: "1" },
  };
}

export const APP_TOOL_CALL = () =>
  turnRequest(11, OPERATOR_SESSION, 1, {
    intent: agentIntent(OPERATOR_SESSION, {
      kind: "app_tool",
      target: { kind: "app_tool", app: BUDGET, tool: "entries.create" },
      effect: "write",
      input: { category: "refunds", amount: 1800, month: "2026-09" },
    }),
    choices: TOOL_CHOICES,
  });

export const EXTERNAL_CALL = () =>
  turnRequest(12, OPERATOR_SESSION, 4, {
    intent: agentIntent(OPERATOR_SESSION, {
      kind: "mcp_tool",
      target: { kind: "mcp_tool", server: "mail", tool: "send_message" },
      effect: "external",
      input: { to: "finance@phroner.example", subject: "Sep close" },
    }),
    choices: TOOL_CHOICES,
  });

export const CONFIG_EDIT = () =>
  turnRequest(13, MANAGER_SESSION, 6, {
    intent: agentIntent(MANAGER_SESSION, {
      kind: "settings_edit",
      target: { kind: "settings_edit", what: "instructions", id: null },
      effect: "write",
      input: { section: "Review rules", lines: 12 },
    }),
    choices: ALLOW_CHOICES,
  });

export const CODING_ASK = () =>
  turnRequest(14, CODING_SESSION, 2, {
    intent: agentIntent(CODING_SESSION, {
      kind: "app_tool",
      target: { kind: "app_tool", app: ORDERS, tool: "orders.list" },
      effect: "read",
      input: {},
    }),
    choices: ["once", "reject"],
  });

function pending(
  n: number,
  minutes: number,
  intent: PendingApproval["intent"],
): PendingApproval {
  return {
    id: id("apr", n),
    intent,
    choices: [...ALLOW_CHOICES],
    status: "pending",
    reject_reason: null,
    applied: null,
    created_seq: String(n),
    decided_seq: null,
    created_at: ago(minutes),
    decided_at: null,
  };
}

function activationIntent(
  release: string,
  comparison: JsonObject,
  agent: AgentRef,
  session: string,
): PendingApproval["intent"] {
  return {
    kind: "activation",
    actor: { kind: "agent", agent, session },
    target: { kind: "activation", app: ORDERS, release },
    effect: "read",
    input: comparison,
    origin: { kind: "activation", app: ORDERS, release },
  };
}

const RELEASE_6 = id("rel", 6);
const RELEASE_7 = id("rel", 7);

export const ACTIVATION = () =>
  pending(
    21,
    3,
    activationIntent(
      RELEASE_7,
      {
        previous_release: RELEASE_6,
        first: false,
        added_resources: [
          "net.fetch:api.payments.example:443",
          "secret.use:PAYMENTS_KEY",
          "fs.write:/exports/**",
        ],
        added_tools: [{ app: INVENTORY, tool: "stock.adjust" }],
        loss_steps: [{
          from: 3,
          to: 4,
          loss: [
            { kind: "drop_table", table: "legacy_orders" },
            { kind: "drop_column", table: "orders", column: "note" },
            { kind: "narrow_type", table: "orders", column: "total" },
          ],
        }],
      },
      { role: "app_engineer", app: ORDERS },
      OPERATOR_SESSION.id,
    ),
  );

export const FIRST_ACTIVATION = () =>
  pending(
    22,
    1,
    activationIntent(
      id("rel", 1),
      {
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
      { role: "app_engineer", app: BUDGET },
      OPERATOR_SESSION.id,
    ),
  );

export const REACTION = () =>
  pending(23, 5, {
    kind: "reaction",
    actor: { kind: "program", seq: "42" },
    target: { kind: "reaction", event: "ReleaseActivationFailed" },
    effect: "read",
    input: {
      app: ORDERS,
      summary: "Refund total does not match the order lines",
    },
    origin: { kind: "event", seq: "42" },
  });

const QUESTION_GROUP = id("qgr", 1);
const QUESTION_TURN = id("trn", 31);
const QUESTION_CALL = id("tcl", 31);

const QUESTION: readonly AskQuestion[] = [{
  question:
    "Include the three flaky scenarios in this week's regression count?",
  header: "Regression count",
  options: [
    { label: "Include them", description: "Count them as failures." },
    { label: "Leave them out", description: "Count only stable scenarios." },
  ],
  multiSelect: false,
}];

type Item = ReturnType<typeof turnRequest> | PendingApproval | "question";

/** 모든 종류가 섞인 한 목록. */
export const allItems = (): readonly Item[] => [
  APP_TOOL_CALL(),
  CODING_ASK(),
  "question",
  ACTIVATION(),
  REACTION(),
];

/** 결정한 뒤 잠깐 남는 줄 시나리오. */
export const SETTLED: readonly SettledRow[] = [
  {
    id: "settled-accepted",
    title: "Activate a new version of App 000001",
    who: "App Engineer · Session 000001 · App 000001",
    state: "accepted",
  },
  {
    id: "settled-applied",
    title: "Open a session with App Engineer?",
    who: "Reaction · App 000002",
    state: "applied",
  },
  {
    id: "settled-denied",
    title: "Use the send_message tool",
    who: "Operator · Session 000001 · Project 000001",
    state: "denied",
    agent: "Operator",
  },
  {
    id: "settled-cancelled",
    title: "Change settings",
    who: "Project Manager · Session 000002 · Project 000001",
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
  let approvals: PendingApproval[] = [];
  let questionSession: FakeSession | null = null;

  function snapshotOf(session: FakeSession): SessionSnapshot {
    let snapshot = sessions.get(session.id);
    if (!snapshot) {
      snapshot = {
        session: session.id,
        agent: session.agent,
        place: session.place,
        state: "waiting",
        permission_requests: [],
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
        questions: [{
          group: QUESTION_GROUP,
          turn: QUESTION_TURN,
          tool_call: QUESTION_CALL,
        }],
      });
    } else if ("session" in item && "request" in item) {
      const snapshot = snapshotOf(item.session);
      sessions.set(snapshot.session, {
        ...snapshot,
        permission_requests: [...snapshot.permission_requests, item.request],
      });
    } else if ("intent" in item) {
      approvals.push(item as PendingApproval);
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
            external_session: null,
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
        key === `read:${approvalsPending.resource}/${approvalsPending.method}`
      ) {
        return ok({ ...COMMON, requests: approvals });
      }
      if (
        key ===
          `memory:${approvalsDecideTurn.resource}/${approvalsDecideTurn.method}`
      ) {
        const session = sessions.get(String(body.session));
        const request = session?.permission_requests.find((r) =>
          r.id === body.request
        );
        if (!session || !request) return fail("not_found");
        const choice = body.choice as { kind: string; reason?: string };
        sessions.set(session.session, {
          ...session,
          permission_requests: session.permission_requests.filter((r) =>
            r !== request
          ),
        });
        const allowed = choice.kind !== "reject";
        emitEvent(base, {
          session: session.session,
          type: "PermissionResolved",
          at: at(),
          payload: {
            request: request.id,
            outcome: allowed ? "allow" : "reject",
          },
        });
        return ok({
          outcome: allowed
            ? {
              outcome: "allow",
              scope: choice.kind === "allow" ? "once" : choice.kind,
            }
            : { outcome: "reject", reason: choice.reason ?? null },
        });
      }
      if (
        key === `command:${approvalsDecide.resource}/${approvalsDecide.method}`
      ) {
        const request = approvals.find((r) => r.id === body.request);
        if (!request) return fail("not_found");
        const choice = body.choice as { kind: string; reason?: string };
        approvals = approvals.filter((r) => r !== request);
        const allowed = choice.kind === "allow";
        emitEvent(base, {
          seq: "100",
          type: "ApprovalDecided",
          subject: request.id,
          actor: "user",
          at: at(),
          payload: {
            kind: request.intent.kind,
            decision: allowed ? "allow" : "reject",
            applied: allowed ? { state: "applied" } : null,
          },
        });
        return ok({
          request: {
            ...request,
            status: allowed ? "allow" : "reject",
            reject_reason: choice.reason ?? null,
            decided_at: at(),
          },
        });
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
