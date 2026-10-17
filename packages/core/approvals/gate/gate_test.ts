import { assertEquals } from "@std/assert";
import type {
  AgentGrantEntry,
  GateGrants,
  GateVerdict,
  Intent,
  ReactionGrant,
} from "../../../protocol/approvals/mod.ts";
import { agentGrantsSetCommand } from "../grants/commands.ts";
import { gate } from "./gate.ts";

const APP = "app_0000000000000000000000000a";
const OTHER = "app_0000000000000000000000000b";
const SESSION = "ses_0000000000000000000000000a";
const REL = "rel_0000000000000000000000000a";
const AGENT = { role: "lophn" } as const;

const open: ReactionGrant = {
  ProblemOpened: "open",
  ProblemReopened: "off",
  AppRestartHalted: "ask",
  ReleaseActivationFailed: "open",
  ContextViolationFound: "open",
};

function grants(
  entries: AgentGrantEntry[] | null,
  app: GateGrants["app"] = [],
): GateGrants {
  return {
    app,
    agent: entries === null ? null : { agent: AGENT, entries },
    reaction: open,
  };
}

const agentActor = { kind: "agent", agent: AGENT, session: SESSION } as const;
const origin = { kind: "event", seq: "1" } as unknown as Intent["origin"];

function appApi(effect: Intent["effect"]): Intent {
  return {
    kind: "app_api",
    actor: agentActor,
    target: { kind: "app_api", app: APP, api: "notes.add" },
    effect,
    input: {},
    origin,
  };
}

function other(target: Intent["target"], actor: Intent["actor"]): Intent {
  return {
    kind: target.kind,
    actor,
    target,
    effect: "read",
    input: {},
    origin,
  };
}

const appEntry = (
  apis: { api: string; setting: "excluded" | "never" | "ask" }[],
): AgentGrantEntry => ({ kind: "app", app: APP, apis });

function appGrant(scope: GateGrants["app"][number]["scope"]) {
  return {
    id: "grt_0000000000000000000000000a",
    app: OTHER,
    scope,
    status: "active" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    revoked_at: null,
  };
}

const appActor = { kind: "app", app: OTHER } as const;
const run: GateVerdict = { verdict: "run" };
const ask: GateVerdict = { verdict: "ask" };
const deny = (reason: "not_granted" | "excluded" | "reaction_off") =>
  ({ verdict: "deny", reason }) as GateVerdict;

function activation(input: Record<string, unknown>): Intent {
  return {
    kind: "activation",
    actor: { kind: "program", seq: "1" } as unknown as Intent["actor"],
    target: { kind: "activation", app: APP, release: REL },
    effect: "read",
    input: {
      previous_release: REL,
      first: false,
      added_resources: [],
      added_app_apis: [],
      loss_steps: [],
      ...input,
    },
    origin,
  };
}

const reaction = (event: keyof ReactionGrant) =>
  other(
    { kind: "reaction", event },
    {
      kind: "program",
      seq: "1",
    } as unknown as Intent["actor"],
  );

const cases: [string, Intent, GateGrants, GateVerdict][] = [
  ["read는 기본 run", appApi("read"), grants([appEntry([])]), run],
  ["write는 기본 run", appApi("write"), grants([appEntry([])]), run],
  ["external은 기본 ask", appApi("external"), grants([appEntry([])]), ask],
  [
    "never override로 external run",
    appApi("external"),
    grants([appEntry([{ api: "notes.add", setting: "never" }])]),
    run,
  ],
  [
    "excluded는 deny",
    appApi("read"),
    grants([appEntry([{ api: "notes.add", setting: "excluded" }])]),
    deny("excluded"),
  ],
  ["앱 entry 없음은 deny", appApi("read"), grants([]), deny("not_granted")],
  [
    "agent grant 없음은 deny",
    appApi("read"),
    grants(null),
    deny("not_granted"),
  ],
  [
    "mcp tool entry 없음은 deny",
    other({ kind: "mcp_tool", server: "s", tool: "t" }, agentActor),
    grants([]),
    deny("not_granted"),
  ],
  [
    "agent 부르기 entry 없음은 run(T4 기본 허락)",
    other({ kind: "agent_call", agent: AGENT }, agentActor),
    grants([]),
    run,
  ],
  [
    "agent 부르기 setting 없으면 run",
    other({ kind: "agent_call", agent: AGENT }, agentActor),
    grants([{ kind: "agent", agent: AGENT }]),
    run,
  ],
  [
    "agent 부르기 excluded는 deny",
    other({ kind: "agent_call", agent: AGENT }, agentActor),
    grants([{ kind: "agent", agent: AGENT, setting: "excluded" }]),
    deny("excluded"),
  ],
  [
    "settings_edit entry 없음은 ask",
    other({ kind: "settings_edit", what: "skill", id: null }, agentActor),
    grants([]),
    ask,
  ],
  [
    "settings_edit never는 run",
    other({ kind: "settings_edit", what: "skill", id: null }, agentActor),
    grants([{ kind: "settings", setting: "never" }]),
    run,
  ],
  ["reaction open", reaction("ProblemOpened"), grants(null), run],
  [
    "reaction off",
    reaction("ProblemReopened"),
    grants(null),
    deny("reaction_off"),
  ],
  ["reaction ask", reaction("AppRestartHalted"), grants(null), ask],
  [
    "activation 첫 release는 ask",
    activation({ first: true }),
    grants(null),
    ask,
  ],
  [
    "activation 늘어난 선언은 ask",
    activation({ added_resources: ["net:example.com:443"] }),
    grants(null),
    ask,
  ],
  ["activation 늘어난 선언 없음은 run", activation({}), grants(null), run],
  [
    "앱 net.fetch가 grant 밖이면 deny",
    other({
      kind: "app_resource",
      scope: { kind: "net.fetch", host: "evil.example", port: 443 },
    }, appActor),
    grants(null, [
      appGrant({ kind: "net.fetch", host: "a.example", port: 443 }),
    ]),
    deny("not_granted"),
  ],
  [
    "앱 net.fetch가 grant 안이면 run",
    other({
      kind: "app_resource",
      scope: { kind: "net.fetch", host: "a.example", port: 443 },
    }, appActor),
    grants(null, [
      appGrant({ kind: "net.fetch", host: "a.example", port: 443 }),
    ]),
    run,
  ],
  [
    "앱 fs는 폴더 안이면 run, 이름만 비슷한 옆 폴더는 deny",
    other({
      kind: "app_resource",
      scope: { kind: "fs.read", path: "/data2/x", recursive: false },
    }, appActor),
    grants(null, [
      appGrant({ kind: "fs.read", path: "/data", recursive: true }),
    ]),
    deny("not_granted"),
  ],
  [
    "앱이 다른 앱을 부르는 것은 app.call 범위 안에서만 run",
    other({ kind: "app_api", app: APP, api: "notes.add" }, appActor),
    grants(null, [
      appGrant({ kind: "app.call", app: APP, app_apis: ["notes.add"] }),
    ]),
    run,
  ],
  [
    "앱이 범위 밖 app-api를 부르면 deny",
    other({ kind: "app_api", app: APP, api: "notes.drop" }, appActor),
    grants(null, [
      appGrant({ kind: "app.call", app: APP, app_apis: ["notes.add"] }),
    ]),
    deny("not_granted"),
  ],
];

Deno.test("효과별 기본값대로 판정하고 grant 밖은 막는다", () => {
  for (const [name, intent, given, want] of cases) {
    assertEquals(gate(intent, given), want, name);
    assertEquals(gate(intent, given), want, `${name} (again)`);
  }
});

Deno.test("agent 자격으로 agentGrantsSet을 부르면 forbidden이다", () => {
  const result = agentGrantsSetCommand.handle(
    undefined as never,
    { actor: `agent:${SESSION}` } as never,
    { agent: AGENT, entries: [{ kind: "settings", setting: "never" }] },
    {},
  );
  assertEquals(!result.ok && result.error.code, "forbidden");
});
