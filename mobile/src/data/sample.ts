// The sample computer: the wireframe's made-up data behind a fake core, for dev builds only. It reuses the desktop's
// gallery fakes (the fake Gateway with the Inbox items, the in-memory conversation) and runs them through the same event
// client, stores and hooks as a real computer, so screens see the same shapes. What the person does changes memory only.
import type { AgentTabSource } from "../../../packages/shell/renderer/conversation/agent-tab-source.ts";
import {
  type AgentTabScene,
  createFakeAgentTabSource,
  SESSION_MAIN,
} from "../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  ACTIVATION,
  createFakeWaiting,
  HISTORY_NOTICES,
  JOB_HOLD_AGENT,
  SHELL_COMMAND,
} from "../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import type { SessionSnapshot } from "../../../packages/protocol/events/mod.ts";
import type { CharacterProfile } from "../../../packages/protocol/lophn-agent/agent-values.ts";
import {
  type AgentId,
  LOPHN_HOME_ID,
  lophnIdOf,
} from "../../../packages/protocol/lophn-agent/workspaces.ts";
import type { SampleComputer } from "./computers.ts";
import { type ComputerData, dataOf, type SampleConversation } from "./link.ts";

export const SAMPLE_KEY = "sample";

const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5p${String(n).padStart(3, "0")}`;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// The conversation fake's project and the Inbox fake's Orders app, so their sessions and items land in these workspaces.
const PHRONER = {
  kind: "project",
  id: "prj_01h455vb4pex5v6nkc6gd5f001",
} as const;
const ORDERS = { kind: "app", id: ACTIVATION().app } as const;
const CALENDAR = { kind: "app", id: id("app", 2) } as const;
const MEALS = { kind: "app", id: id("app", 3) } as const;
const READING = { kind: "app", id: id("app", 4) } as const;

const LOPHN_PHRONER = lophnIdOf(PHRONER);
const PLANNER = id("agt", 1);

const AGENTS: Record<string, { name: string; profile: CharacterProfile }> = {
  [LOPHN_HOME_ID]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [LOPHN_PHRONER]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [lophnIdOf(ORDERS)]: {
    name: "lophn",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  [PLANNER]: {
    name: "Experiment planner",
    profile: { kind: "character", shape: "round", color: "blue" },
  },
  coding_claude: {
    name: "Claude Code",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
  coding_codex: {
    name: "Codex",
    profile: { kind: "character", shape: "square", color: "coral" },
  },
};

interface Sample {
  readonly id: string;
  readonly agent: AgentId;
  readonly workspace: SessionSnapshot["workspace"];
  readonly title: string;
  readonly state: SessionSnapshot["state"];
  readonly minutesAgo: number;
  readonly desk: string | null;
}

// Weekly report (waiting on the cleanup command) and Harness change summary (waiting on a question) come from the Inbox fake.
const SESSIONS: readonly Sample[] = [
  {
    id: id("ses", 1),
    agent: LOPHN_HOME_ID,
    workspace: null,
    title: "Plan the week",
    state: "idle",
    minutesAgo: 25,
    desk: null,
  },
  {
    id: id("ses", 2),
    agent: "coding_claude",
    workspace: PHRONER,
    title: "Fix flaky retry in the scenario runner",
    state: "running",
    minutesAgo: 2,
    desk: "Main",
  },
  {
    id: id("ses", 3),
    agent: "coding_codex",
    workspace: PHRONER,
    title: "Split the eval board loader",
    state: "running",
    minutesAgo: 4,
    desk: "weekly-review",
  },
  {
    id: id("ses", 4),
    agent: PLANNER,
    workspace: PHRONER,
    title: "Tune the retry budget",
    state: "idle",
    minutesAgo: 3 * 24 * 60,
    desk: null,
  },
  {
    id: id("ses", 5),
    agent: LOPHN_PHRONER,
    workspace: PHRONER,
    title: "Explain the scoring change",
    state: "idle",
    minutesAgo: 6 * 24 * 60,
    desk: null,
  },
  {
    id: id("ses", 6),
    agent: lophnIdOf(ORDERS),
    workspace: ORDERS,
    title: "Add a CSV export",
    state: "idle",
    minutesAgo: 40,
    desk: null,
  },
];

const WEEKLY = {
  id: SESSION_MAIN,
  agent: LOPHN_PHRONER,
  workspace: PHRONER,
};

const TITLES: Record<string, { title: string; minutesAgo: number }> = {
  [SESSION_MAIN]: { title: "Weekly report", minutesAgo: 1 },
  // The Inbox fake's question waits in this Home session.
  ses_01h455vb4pex5v6nkc6gd5fd04: {
    title: "Harness change summary",
    minutesAgo: 0,
  },
  ...Object.fromEntries(
    SESSIONS.map((one) => [
      one.id,
      { title: one.title, minutesAgo: one.minutesAgo },
    ]),
  ),
};

const DESKS: Record<string, string> = {
  [SESSION_MAIN]: "Main",
  ...Object.fromEntries(
    SESSIONS.flatMap((one) => (one.desk === null ? [] : [[one.id, one.desk]])),
  ),
};

const COMMON = { as_of_seq: "0", next_cursor: null };

function inbox() {
  const shell = SHELL_COMMAND();
  return createFakeWaiting([
    {
      session: WEEKLY,
      request: {
        ...shell.request,
        session: WEEKLY.id,
        subject: { kind: "shell", command: "rm -r docs/reports/2026-w40" },
        always_patterns: ["rm -r *"],
      },
    },
    "question",
    ACTIVATION(),
    JOB_HOLD_AGENT(),
    ...HISTORY_NOTICES(),
  ]);
}

/** The fake Gateway plus the reads the workspace list makes: projects, apps, session titles and agent names. */
function sampleCore(): CoreSource {
  const fake = inbox();
  const snapshots: SessionSnapshot[] = SESSIONS.map((one) => ({
    session: one.id,
    agent: one.agent,
    workspace: one.workspace,
    state: one.state,
    turn_requests: [],
    questions: [],
  }));
  const reads: Record<string, (body: Record<string, unknown>) => unknown> = {
    "projects/list": () => ({
      ...COMMON,
      projects: [
        {
          id: PHRONER.id,
          name: "phroner",
          title: "phroner",
          purpose: "",
          revision: "1",
          status: "active",
          folders: [],
        },
      ],
    }),
    "apps/list": () => ({
      ...COMMON,
      apps: [
        [ORDERS, "Orders"],
        [CALENDAR, "Calendar"],
        [MEALS, "Meal planner"],
        [READING, "Reading list"],
      ].map(([app, name]) => ({
        id: (app as { id: string }).id,
        name,
      })),
    }),
    "sessions/list": (body) => {
      const agent = body.agent as string;
      const workspace = body.workspace as { id: string } | null;
      const all: { id: string; agent: string; workspace: { id: string } | null }[] = [
        ...SESSIONS,
        WEEKLY,
        {
          id: "ses_01h455vb4pex5v6nkc6gd5fd04",
          agent: LOPHN_HOME_ID,
          workspace: null,
        },
      ];
      return {
        ...COMMON,
        sessions: all
          .filter(
            (one) =>
              one.agent === agent &&
              (one.workspace?.id ?? null) === (workspace?.id ?? null),
          )
          .map((one) => ({
            id: one.id,
            agent: one.agent,
            workspace: one.workspace,
            title: TITLES[one.id]?.title ?? null,
            lifecycle: "open",
            last_active_at: ago(TITLES[one.id]?.minutesAgo ?? 0),
          })),
      };
    },
    "agents/read": (body) => {
      const agent = AGENTS[body.agent as string];
      return agent === undefined
        ? undefined
        : {
            agent: body.agent,
            effective: {
              name: { value: agent.name },
              profile: { value: agent.profile },
            },
          };
    },
  };
  return {
    ...fake,
    async call(input) {
      const key = `${input.resource}/${input.method}`;
      if (key === "session_snapshots/list") {
        const reply = await fake.call(input);
        const wanted = (input.body as { sessions?: string[] } | undefined)
          ?.sessions;
        const value = reply.value as { snapshots: SessionSnapshot[] };
        return {
          ok: true,
          value: {
            ...value,
            snapshots: [
              ...value.snapshots,
              ...snapshots.filter(
                (one) => wanted === undefined || wanted.includes(one.session),
              ),
            ],
          },
        };
      }
      const read = reads[key];
      if (read === undefined) return fake.call(input);
      const value = read((input.body ?? {}) as Record<string, unknown>);
      return value === undefined
        ? { ok: false, error: { code: "not_found", message: "sample" } }
        : { ok: true, value };
    },
  };
}

const SCENES: Record<SampleConversation, AgentTabScene> = {
  done: "report",
  working: "working",
  approval: "approval",
  question: "question",
};

/**
 * One in-memory conversation for every sample session; only Weekly report has messages. The state can be switched so
 * screens can show all four; listeners of `changed` hear the switch and read again.
 */
function sampleSource(): {
  source: AgentTabSource;
  show(state: SampleConversation): void;
} {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const make = (state: SampleConversation) => {
    const inner = createFakeAgentTabSource({
      scene: SCENES[state],
      now: Date.now,
    });
    inner.changed?.(notify);
    return inner;
  };
  let inner = make("approval");
  const source = new Proxy({} as AgentTabSource, {
    get: (_target, key) =>
      key === "changed"
        ? (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }
        : Reflect.get(inner, key),
  });
  return {
    source,
    show(state) {
      inner = make(state);
      notify();
    },
  };
}

export function createSampleComputer(): SampleComputer<ComputerData> {
  const conversation = sampleSource();
  const { data } = dataOf(sampleCore(), () => conversation.source);
  const sample: ComputerData = {
    ...data,
    deskOf: (session) => DESKS[session] ?? null,
    sample: { conversation: conversation.show },
  };
  return {
    key: SAMPLE_KEY,
    name: "mina-desktop",
    link: {
      data: sample,
      state: () => ({
        status: "connected",
        path: "direct",
        waiting: sample.waiting.get().count,
      }),
      subscribe: (listener) => sample.waiting.subscribe(listener),
      pause() {},
      resume() {},
      close() {},
    },
  };
}
