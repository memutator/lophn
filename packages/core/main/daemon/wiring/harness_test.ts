// 한 CLI session을 process 둘이 쓰지 않게 하는 harness queue의 규칙과, GUI 탭 팀원 turn 자격의 범위다. 깨지면 headless `claude -p`가
// 열린 GUI 탭의 대화에 같이 쓰거나, 한 탭이 남의 session이나 다른 탭의 팀원 입력을 가져가거나, 자격이 그 session·project 밖에 닿는다.
// harness wiring을 임시 ledger file과 가짜 writer로 세운다(core를 띄우지 않는다).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { cryptoRandom, manualClock, ok } from "../../../../base/mod.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { callReply } from "../../../../protocol/lophn-agent/calls.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { harnessOperations } from "../../../agent-workspaces/credentials.ts";
import { harnessExtensionSetting } from "../../../config/mod.ts";
import { HARNESS_QUEUE_PUT_TOPIC } from "../../../lophn-agent/session/mod.ts";
import { conversationTestSteps } from "../../../lophn-agent/session/test-steps.ts";
import { installWorkspaceEnvironment } from "../../../lophn-agent/workspaces/environment.ts";
import { UNWIRED_WORKSPACE_DEPS } from "../../../lophn-agent/workspaces/unwired.ts";
import { CredentialRegistry } from "../../../server/identity/registry.ts";
import type { HarnessMembers } from "../../../terminal-agents/member.ts";
import { harnessWiring } from "./harness.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const HEADLESS = id("ses", 1);
const MEMBER = id("ses", 2);
const PROJECT_MEMBER = id("ses", 3);
const PROJECT_HEADLESS = id("ses", 4);
const PROJECT = id("prj", 1);
const PERSON = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: { process: "shell" },
  credential_ref: "user",
} as unknown as AuthenticatedContext;

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "lophn-harness-wiring-"));
  const ledgerPath = join(root, "lophn.db");
  const db = new DatabaseSync(ledgerPath);
  for (const step of conversationTestSteps) db.exec(step.sql);
  db.exec(`
    insert into sessions (id, agent, harness, harness_gui, harness_session, project, workspace_kind, workspace_id, lifecycle, created_seq, state_seq)
      values ('${HEADLESS}', 'coding_claude', 'claude-code', 0, null, null, null, null, 'open', 1, 1),
             ('${MEMBER}', 'coding_omp', 'omp', 1, 'cli-m', null, null, null, 'open', 2, 2),
             ('${PROJECT_MEMBER}', 'coding_claude', 'claude-code', 1, 'cli-p', '${PROJECT}', 'project', '${PROJECT}', 'open', 3, 3),
             ('${PROJECT_HEADLESS}', 'coding_claude', 'claude-code', 0, 'cli-h', '${PROJECT}', 'project', '${PROJECT}', 'open', 4, 4);
  `);
  db.close();

  const clock = manualClock(Date.parse("2026-11-21T00:00:00Z"));
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock,
    operations: [
      ...new Set([
        ...harnessOperations("home"),
        ...harnessOperations("project"),
      ]),
    ].map((name) => ({
      name,
      actors: name === callReply.name ? callReply.actors : ["agent" as const],
      kind: "command" as const,
    })),
  });
  const commands: string[] = [];
  const provided = new Map<string, unknown>();
  const archived: string[] = [];
  const command = async (
    _who: unknown,
    envelope: { command: string; input: { session?: string } },
  ) => {
    commands.push(envelope.command);
    if (envelope.command === "ArchiveSession") {
      archived.push(String(envelope.input.session));
    }
    return ok({ replayed: false, after_commit: [] });
  };
  const ctx = {
    clock,
    random: cryptoRandom,
    registry,
    ledgerPath,
    runtime: {
      record: async () => ok(undefined),
      reads: new Map([
        [
          "messages/body",
          async () =>
            ok({
              content: {
                schema_version: 1,
                parts: [{ kind: "text", text: "do it" }],
              },
            }),
        ],
      ]),
    },
    writer: { command },
    settings: {
      get: (setting: { default?: unknown }) =>
        setting === harnessExtensionSetting ? true : setting.default,
    },
    provide: (name: string, value: unknown) => provided.set(name, value),
    bus: { publish: (_event: BusEvent) => {}, subscribe: () => () => {} },
    telemetry: { logger: { error() {}, warn() {}, info() {} } },
  };
  const built = await harnessWiring().build!(ctx as never);
  assert.ok(built.ok);
  const memory = new Map(built.value.memory);
  const members = provided.get("harnessMembers") as HarnessMembers;
  // commit 뒤 harness queue에 넣는 길(Router의 harness transport가 내는 afterCommit)로 입력을 넣는다.
  const writer = built.value.writer!({
    command: async () =>
      ok({ replayed: false, after_commit: queued.splice(0) }),
  } as never);
  const queued: { topic: string; data: unknown }[] = [];
  let messages = 0;
  const put = async (session: string) => {
    const message = id("msg", ++messages);
    queued.push({
      topic: HARNESS_QUEUE_PUT_TOPIC,
      data: {
        session,
        at: "2026-11-21T00:00:00.000Z",
        input: {
          kind: "call",
          from: { kind: "agent", session: id("ses", 9) },
          call: id("cal", messages),
          reply_to: null,
          body: [],
          refs: [],
          delivery: "next_turn",
          message,
          reply: "result",
          outcome: null,
          event: null,
          notice: null,
          step: null,
          unattended: false,
        },
      },
    });
    await writer.command(PERSON, {} as never);
    return message;
  };
  return {
    memory,
    members,
    registry,
    commands,
    archived,
    put,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("headless take and start_turn never take a GUI member's input, and a GUI tab takes only a member's own queue", async () => {
  const kit = await setup();
  try {
    const memberInput = await kit.put(MEMBER);
    const headlessInput = await kit.put(HEADLESS);

    const take = await kit.memory.get("harness/take")!(PERSON, {});
    assert.ok(take.ok);
    const taken = (take.value as { input: { session: string } | null }).input;
    assert.equal(taken?.session, HEADLESS);
    const start = await kit.memory.get("harness/start_turn")!(PERSON, {
      session: MEMBER,
      input_message: memberInput,
    });
    assert.ok(!start.ok && start.error.code === "conflict");

    // GUI 연결은 headless session의 queue를 보지도 꺼내지도 못한다.
    assert.equal(await kit.members.next(HEADLESS), null);
    const stolen = await kit.members.start(HEADLESS, headlessInput);
    assert.ok(!stolen.ok && stolen.error.code === "conflict");
    assert.equal((await kit.members.next(MEMBER))?.message, memberInput);
    assert.ok((await kit.members.start(MEMBER, memberInput)).ok);
  } finally {
    kit.cleanup();
  }
});

test("a tab never takes a member another tab already holds", async () => {
  const kit = await setup();
  try {
    const input = {
      harness: "claude-code" as const,
      project: PROJECT,
      cli_session: "cli-p",
    };
    const free = await kit.members.ensure({ ...input, taken: new Set() });
    assert.ok(free.ok && free.value === PROJECT_MEMBER);
    const held = await kit.members.ensure({
      ...input,
      taken: new Set([PROJECT_MEMBER]),
    });
    assert.ok(held.ok && held.value !== PROJECT_MEMBER);
    assert.ok(kit.commands.includes("OpenHarnessMember"));
  } finally {
    kit.cleanup();
  }
});

test("a member turn's credential is scoped to that session and its project, and a headless session gets none from a tab", async () => {
  const kit = await setup();
  try {
    const issued = await kit.members.credential(PROJECT_MEMBER);
    assert.ok(issued.ok);
    const context = await kit.registry.authenticate(issued.value.token);
    assert.ok(context.ok);
    assert.equal(context.value.conditions.session, PROJECT_MEMBER);
    assert.equal(context.value.conditions.project, PROJECT);
    assert.equal(context.value.conditions.turn, issued.value.turn);
    assert.ok(
      !kit.registry.authorize(context.value, callReply.name, {
        session: HEADLESS,
        turn: issued.value.turn,
      }).ok,
    );
    const headless = await kit.members.credential(HEADLESS);
    assert.ok(!headless.ok && headless.error.code === "forbidden");
  } finally {
    kit.cleanup();
  }
});

// core가 탭을 열 팀원은 GUI 탭 팀원뿐이고(headless session으로 탭을 열지 않는다), 사람이 coding session을 지우면 그 팀원만 보관한다.
test("only a GUI member is described for opening a tab, and forgetting a coding session archives only its member, for a person only", async () => {
  const kit = await setup();
  try {
    // project가 있다고 읽히게 한다(core에서는 wiring이 놓는다).
    installWorkspaceEnvironment({
      deps: () => ({
        ...UNWIRED_WORKSPACE_DEPS,
        projects: {
          project: (id) => ({ id, archived: false }) as never,
          projectByName: () => null,
        },
      }),
    });
    assert.equal(kit.members.describe(PROJECT_HEADLESS), null);
    assert.equal(kit.members.describe(MEMBER), null, "no project to open in");
    assert.deepEqual(kit.members.describe(PROJECT_MEMBER), {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-p",
      team: false,
    });
    const agent = {
      ...PERSON,
      actor: "agent:ses_1",
    } as unknown as AuthenticatedContext;
    const refused = await kit.members.forget(agent, {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-p",
    });
    assert.ok(!refused.ok && refused.error.code === "forbidden");
    const forgot = await kit.members.forget(PERSON, {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-p",
    });
    assert.deepEqual(forgot, ok(1));
    assert.deepEqual(kit.archived, [PROJECT_MEMBER]);
  } finally {
    kit.cleanup();
  }
});
