// gallery와 dev-mock이 쓰는 대기 목록 fake. events의 fake Gateway에 대기 항목을 채우고, 결정과 질문 답 route를
// 메모리에서 받아 항목을 빼고 event를 흘린다.

import {
  type ShareRequest,
  shareRequestDecide,
  shareRequestList,
} from "../../../../../protocol/approvals/share-request.ts";
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
  type Notice,
  noticeDismiss,
  noticeMarkRead,
  noticesList,
  noticesOpen,
} from "../../../../../protocol/apps/notice.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../protocol/events/mod.ts";
import {
  type JobHold,
  type JobRecord,
  jobApprove,
  jobDecideHold,
  jobHolds,
  jobPending,
} from "../../../../../protocol/jobs/jobs.ts";
import {
  type AskQuestion,
  askAnswer,
  askRead,
} from "../../../../../protocol/lophn-agent/ask-tool.ts";
import {
  type MailHold,
  mailDecideHold,
  mailHolds,
} from "../../../../../protocol/lophn-agent/mail.ts";
import {
  type AgentId,
  lophnIdOf,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import { createFakeSource, type FakeSource } from "../events/fake-source.ts";
import type { SettledRow } from "./decide.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
export const PROJECT = id("prj", 1);
export const ORDERS = id("app", 1);
export const BUDGET = id("app", 2);
export const INVENTORY = id("app", 3);

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

interface FakeSession {
  readonly id: string;
  readonly agent: AgentId;
  readonly workspace: SessionSnapshot["workspace"];
}

const AGENT_SESSION: FakeSession = {
  id: id("ses", 1),
  agent: id("agt", 1),
  workspace: { kind: "project", id: PROJECT },
};
const LOPHN_SESSION: FakeSession = {
  id: id("ses", 4),
  agent: lophnIdOf(null),
  workspace: null,
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
      allowed_choices:
        alwaysPatterns.length > 0
          ? ["once", "session", "always", "reject"]
          : ["once", "session", "reject"],
      reason: null,
      outside_rewind: subject.kind === "shell",
      to_parent: false,
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

export const SHARE_REQUEST = (): ShareRequest => ({
  app: INVENTORY,
  app_name: "Inventory",
  agents: [
    { id: id("agt", 1), name: "Bookkeeper" },
    { id: id("agt", 2), name: "Support" },
  ],
  coding_agents: true,
  reason: "Both agents answer stock questions and should read the same counts.",
  session: id("ses", 5),
  public_skills: 2,
  public_commands: 3,
  requested_at: ago(2),
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
      trigger: null,
      fired_count: 0,
      skipped_count: 0,
      last_fired_at: null,
      last_skipped_at: null,
      last_skip_reason: null,
      source_gone: false,
      missed_policy: "hold",
      enabled: true,
      approved_at: hoursAgo(24 * 30),
      next_due_at: hoursAgo(-6),
      machine: null,
      runs_here: true,
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
      event: null,
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
    creator: { agent: lophnIdOf(null), workspace: null },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: lophnIdOf({ kind: "project", id: PROJECT }),
      agent_workspace: { kind: "project", id: PROJECT },
      prompt:
        "Summarize yesterday's finished tasks and list the open questions for today.",
    },
  });

/** 앱 workspace에서 만든 앱 tool 호출. 한 번 놓쳤다. */
export const JOB_HOLD_TOOL = () =>
  jobHold(13, 6, 1, {
    title: "Archive old orders",
    creator: {
      agent: lophnIdOf({ kind: "app", id: ORDERS }),
      workspace: { kind: "app", id: ORDERS },
    },
    every: "12h",
    at: null,
    action: { kind: "tool_run", app: ORDERS, tool: "archive_old" },
  });

/** project workspace에서 만든 workflow 시작. 세 번 놓쳤다. */
export const JOB_HOLD_WORKFLOW = () =>
  jobHold(12, 48, 3, {
    title: "Weekly review",
    creator: {
      agent: lophnIdOf({ kind: "project", id: PROJECT }),
      workspace: { kind: "project", id: PROJECT },
    },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PROJECT,
      workflow: "weekly-review",
      text: "Review last week's experiments and propose next steps.",
    },
  });

/** 앱 workspace에서 lophn이 만든, 승인을 기다리는 앱 tool 호출. */
export const JOB_APPROVAL_TOOL = (): { approval: JobRecord } => ({
  approval: {
    id: jid("job", 21),
    title: "Sync usage",
    creator: {
      agent: lophnIdOf({ kind: "app", id: ORDERS }),
      workspace: { kind: "app", id: ORDERS },
    },
    every: "15m",
    at: null,
    trigger: null,
    fired_count: 0,
    skipped_count: 0,
    last_fired_at: null,
    last_skipped_at: null,
    last_skip_reason: null,
    source_gone: false,
    action: { kind: "tool_run", app: ORDERS, tool: "usage.sync" },
    missed_policy: "run",
    enabled: true,
    approved_at: null,
    next_due_at: null,
    machine: null,
    runs_here: true,
    last_run: null,
    created_at: ago(3),
    updated_at: ago(3),
  },
});

/** 앞 차례가 아직 돌아 [Start now]가 conflict로 막히는 workflow 시작. */
export const JOB_HOLD_BLOCKED = () => ({
  ...JOB_HOLD_WORKFLOW(),
  blocked: true as const,
});

function mailHold(
  n: number,
  more: Pick<
    MailHold,
    "computer" | "from" | "address" | "project_name" | "text"
  > & {
    sentMinutesAgo: number;
    arrivedMinutesAgo: number;
    expiresInMinutes: number;
  },
): MailHold {
  return {
    origin: id("mch", n),
    mail: id("mal", n),
    computer: more.computer,
    from: more.from,
    address: more.address,
    project_name: more.project_name,
    reply: "result",
    text: more.text,
    sent_at: ago(more.sentMinutesAgo),
    arrived_at: ago(more.arrivedMinutesAgo),
    expires_at: ago(-more.expiresInMinutes),
  };
}

/** Windows 기계를 켜자 닿은 맡김: 몇 시간 전에 다른 컴퓨터의 agent가 build와 test를 맡겼다. */
export const MAIL_HOLD_WINDOWS = (): MailHold =>
  mailHold(41, {
    computer: "MacBook Pro",
    from: {
      machine: id("mch", 41),
      agent: "release-manager",
      session: id("ses", 41),
      name: "Release manager",
    },
    address: { agent: "windows-builder", workspace: { project: id("pri", 1) } },
    project_name: "alpha",
    text: "Build the Windows installer from main and run the full test suite. If a test fails, send me the failing test names and the first error of each.",
    sentMinutesAgo: 14 * 60,
    arrivedMinutesAgo: 6,
    expiresInMinutes: 6 * 24 * 60 + 10 * 60,
  });

/** 만료가 가까운 맡김: 거의 이레 전에 보냈다. 받을 project가 이 컴퓨터에 없다. */
export const MAIL_HOLD_EXPIRING = (): MailHold =>
  mailHold(42, {
    computer: "Home desktop",
    from: {
      machine: id("mch", 42),
      agent: "bookkeeper",
      session: null,
      name: "Bookkeeper",
    },
    address: { agent: "accountant", workspace: { project: id("pri", 2) } },
    // 이 컴퓨터에 그 project가 없어 이름 대신 짧은 id가 보인다.
    project_name: null,
    text: "Export last month's invoices as CSV and put the file in the shared folder.",
    sentMinutesAgo: 6 * 24 * 60 + 20 * 60,
    arrivedMinutesAgo: 95,
    expiresInMinutes: 4 * 60,
  });

/** 정하려는 순간 만료된 맡김: [Start now]와 [Skip]이 conflict로 막힌다. */
export const MAIL_HOLD_EXPIRED = () => ({
  ...MAIL_HOLD_EXPIRING(),
  expired: true as const,
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

const notice = (
  n: number,
  minutes: number,
  more: Partial<Notice> & Pick<Notice, "kind" | "title">,
): Notice => ({
  id: id("ntc", n),
  source: more.kind === "app" ? "app" : "program",
  app: ORDERS,
  app_name: "Orders",
  project: null,
  key: null,
  body: "",
  persistent: true,
  action: null,
  created_at: ago(minutes),
  read_at: null,
  ...more,
});

/** 휘발 알림 하나(앱이 남긴 것). Now 탭의 Notifications에 나온다. */
export const EPHEMERAL_NOTICE = () =>
  notice(1, 3, {
    kind: "app",
    persistent: false,
    app: BUDGET,
    app_name: "Budget",
    title: "Spending is at 84% of the monthly limit",
    body: "Checked just now.",
  });

/** 영구 기록 여럿: program 기록 종류들과 앱이 남긴 영구 알림. 첫 둘이 안 읽은 줄이다. */
export const HISTORY_NOTICES = (): readonly Notice[] => [
  notice(2, 12, {
    kind: "workspace_update_needed",
    app: null,
    app_name: null,
    title: "Updates for your workspace",
    body: "3 apps and 1 workflow must update, 2 items have new features.",
    action: {
      kind: "open_home_skill",
      skill: "update",
      args: "",
    },
  }),
  notice(3, 45, {
    kind: "release_failed",
    title: "Release r8 of Orders failed",
    body: "The app is back on release r7.",
  }),
  notice(4, 180, {
    kind: "release_activated",
    title: "Release r7 of Orders is active",
    read_at: ago(170),
  }),
  notice(5, 400, {
    kind: "app",
    source: "app",
    app: BUDGET,
    app_name: "Budget",
    title: "Weekly report is ready",
    body: "3 categories went over budget.",
    read_at: ago(390),
  }),
  notice(6, 1500, {
    kind: "app_unavailable",
    title: "Inventory stopped",
    body: "It crashed 3 times in a row.",
    app: INVENTORY,
    app_name: "Inventory",
    read_at: ago(1400),
  }),
  notice(7, 2900, {
    kind: "release_rolled_back",
    title: "Orders went back from r6 to r5",
    read_at: ago(2800),
  }),
  notice(8, 4300, {
    kind: "lophn_updated",
    title: "lophn updated from 0.19.0 to 0.20.0",
    app: null,
    app_name: null,
    read_at: ago(4200),
  }),
  notice(9, 5800, {
    kind: "phone_changed",
    app: null,
    app_name: null,
    title: "Your phone changed",
    body: "2 apps have phone screens drawn for the old phone. Ask lophn to redraw them.",
    read_at: ago(5700),
  }),
];

type Item =
  | Notice
  | ReturnType<typeof turnRequest>
  | ActivationConsent
  | JobHold
  | MailHold
  | ReturnType<typeof MAIL_HOLD_EXPIRED>
  | ReturnType<typeof JOB_HOLD_BLOCKED>
  | ReturnType<typeof JOB_APPROVAL_TOOL>
  | ShareRequest
  | "question";

/** 모든 종류가 섞인 한 목록. */
export const allItems = (): readonly Item[] => [
  SHELL_COMMAND(),
  "question",
  ACTIVATION(),
  JOB_APPROVAL_TOOL(),
  JOB_HOLD_AGENT(),
  MAIL_HOLD_WINDOWS(),
  EPHEMERAL_NOTICE(),
  ...HISTORY_NOTICES(),
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
  let mail: MailHold[] = [];
  const expired = new Set<string>();
  let pending: JobRecord[] = [];
  let shares: ShareRequest[] = [];
  const blocked = new Set<string>();
  let questionSession: FakeSession | null = null;
  const notices: Notice[] = [];

  function snapshotOf(session: FakeSession): SessionSnapshot {
    let snapshot = sessions.get(session.id);
    if (!snapshot) {
      snapshot = {
        session: session.id,
        agent: session.agent,
        workspace: session.workspace,
        spawned_by: null,
        runs_on: null,
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
    if (typeof item === "object" && "persistent" in item) {
      notices.push(item);
    } else if (item === "question") {
      questionSession = LOPHN_SESSION;
      const snapshot = snapshotOf(LOPHN_SESSION);
      sessions.set(snapshot.session, {
        ...snapshot,
        questions: [
          {
            group: QUESTION_GROUP,
            turn: QUESTION_TURN,
            tool_call: QUESTION_CALL,
            to_parent: false,
          },
        ],
      });
    } else if ("request" in item) {
      const snapshot = snapshotOf(item.session);
      sessions.set(snapshot.session, {
        ...snapshot,
        turn_requests: [...snapshot.turn_requests, item.request],
      });
    } else if ("coding_agents" in item) {
      shares.push(item);
    } else if ("approval" in item) {
      pending.push(item.approval);
    } else if ("origin" in item) {
      // strict schema라 목록에는 표시 칸 없이 나간다.
      const { expired: late, ...hold } = item as MailHold & {
        expired?: true;
      };
      mail.push(hold);
      if (late) expired.add(hold.mail);
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
            workspace: session.workspace,
            spawned_by: null,
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
      if (
        key === `read:${shareRequestList.resource}/${shareRequestList.method}`
      ) {
        return ok({ ...COMMON, requests: shares });
      }
      if (
        key ===
        `command:${shareRequestDecide.resource}/${shareRequestDecide.method}`
      ) {
        const decided = body.input as { app: string; choice: string };
        const request = shares.find((one) => one.app === decided.app);
        if (!request) return fail("not_found");
        shares = shares.filter((one) => one !== request);
        emitEvent(base, {
          type: "ShareRequestClosed",
          subject: request.app,
          at: at(),
          payload: { app: request.app, outcome: decided.choice },
        });
        return ok({ app: request.app, outcome: decided.choice });
      }
      if (key === `read:${noticesOpen.resource}/${noticesOpen.method}`) {
        return ok({ ...COMMON, notices: notices.filter((n) => !n.read_at) });
      }
      if (key === `read:${noticesList.resource}/${noticesList.method}`) {
        const want = body as {
          app?: string;
          project?: string;
          source?: string;
          kind?: string;
          persistent?: boolean;
          query?: string;
          since?: string;
          until?: string;
          cursor?: string;
          limit?: number;
        };
        const found = notices
          .filter(
            (n) =>
              (want.app === undefined || n.app === want.app) &&
              (want.project === undefined || n.project === want.project) &&
              (want.source === undefined || n.source === want.source) &&
              (want.kind === undefined || n.kind === want.kind) &&
              (want.persistent === undefined ||
                n.persistent === want.persistent) &&
              (want.query === undefined ||
                `${n.title} ${n.body}`
                  .toLowerCase()
                  .includes(want.query.toLowerCase())) &&
              (want.since === undefined || n.created_at >= want.since) &&
              (want.until === undefined || n.created_at < want.until),
          )
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        const from = Number(want.cursor ?? 0);
        const limit = want.limit ?? 50;
        const page = found.slice(from, from + limit);
        return ok({
          as_of_seq: "0",
          next_cursor:
            from + limit < found.length ? String(from + limit) : null,
          notices: page,
        });
      }
      if (
        key === `command:${noticeMarkRead.resource}/${noticeMarkRead.method}`
      ) {
        const { ids } = (body.input as { ids: string[] }) ?? { ids: [] };
        for (const row of notices) {
          if (ids.includes(row.id) && row.persistent && !row.read_at) {
            row.read_at = at();
            emitEvent(base, {
              type: "NoticeRead",
              subject: row.app,
              at: at(),
              payload: { id: row.id, read_at: row.read_at },
            });
          }
        }
        return ok({ marked: ids.length });
      }
      if (key === `command:${noticeDismiss.resource}/${noticeDismiss.method}`) {
        const row = notices.find(
          (n) => n.id === (body.input as { id: string }).id,
        );
        if (!row) return fail("not_found");
        if (row.persistent) {
          row.read_at = at();
          emitEvent(base, {
            type: "NoticeRead",
            subject: row.app,
            at: at(),
            payload: { id: row.id, read_at: row.read_at },
          });
        } else {
          notices.splice(notices.indexOf(row), 1);
          emitEvent(base, {
            type: "NoticeClosed",
            subject: row.app,
            at: at(),
            payload: { id: row.id },
          });
        }
        return ok({ id: row.id });
      }
      if (key === `command:sessions/open`) {
        return ok({
          id: (body.input as { id: string }).id,
          lifecycle: "open",
          workspace: null,
          state_seq: "0",
        });
      }
      if (key === `memory:acp/send`) return ok({});
      if (key === `read:${jobHolds.resource}/${jobHolds.method}`) {
        return ok({ ...COMMON, holds });
      }
      if (key === `read:${jobPending.resource}/${jobPending.method}`) {
        return ok({ ...COMMON, jobs: pending });
      }
      if (key === `command:${jobApprove.resource}/${jobApprove.method}`) {
        const decided = body.input as { job: string; choice: string };
        const job = pending.find((one) => one.id === decided.job);
        if (!job) return fail("not_found");
        pending = pending.filter((one) => one !== job);
        emitEvent(base, {
          type: "StateChanged",
          subject: null,
          at: at(),
          payload: { changes: [{ name: "jobs", id: job.id }] },
        });
        return ok({
          job:
            decided.choice === "reject" ? null : { ...job, approved_at: at() },
        });
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
          type: "StateChanged",
          subject: null,
          at: at(),
          payload: { changes: [{ name: "jobs", id: hold.job.id }] },
        });
        return ok({ job_run: hold.job_run });
      }
      if (key === `read:follow-ups/list`) {
        return ok({ ...COMMON, items: [] });
      }
      if (key === `memory:${mailHolds.resource}/${mailHolds.method}`) {
        return ok({ holds: mail });
      }
      if (
        key === `memory:${mailDecideHold.resource}/${mailDecideHold.method}`
      ) {
        const hold = mail.find((h) => h.mail === body.mail);
        if (!hold) return fail("not_found");
        if (expired.has(hold.mail)) return fail("conflict");
        mail = mail.filter((h) => h !== hold);
        emitEvent(base, {
          type: "StateChanged",
          subject: null,
          at: at(),
          payload: { changes: [{ name: "mail_holds", id: hold.mail }] },
        });
        return ok({
          delivery: body.decision === "run_now" ? "running" : null,
          reason: null,
          session: null,
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
