// 한 CLI session을 process 둘이 쓰지 않게 하는 harness queue·hold 규칙과, 팀원 turn 자격의 범위다.
// 깨지면 background handle이 살아 있는데 TUI가 같은 CLI session을 열거나, 한 탭이 남의 session을 가져가거나,
// 자격이 그 session·project 밖에 닿는다. harness wiring을 임시 ledger file과 가짜 writer로 세운다(core를 띄우지 않는다).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { cryptoRandom, manualClock, ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { callReply } from "../../../../protocol/lophn-agent/calls.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { harnessOperations } from "../../../agent-workspaces/credentials.ts";
import type { HarnessHold } from "../../../host-queue/mod.ts";
import { HARNESS_QUEUE_PUT_TOPIC } from "../../../lophn-agent/session/mod.ts";
import { conversationTestSteps } from "../../../lophn-agent/session/test-steps.ts";
import { installWorkspaceEnvironment } from "../../../lophn-agent/workspaces/environment.ts";
import { UNWIRED_WORKSPACE_DEPS } from "../../../lophn-agent/workspaces/unwired.ts";
import { CredentialRegistry } from "../../../server/identity/registry.ts";
import type { HarnessMembers } from "../../../terminal-agents/member.ts";
import { harnessWiring } from "./harness.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const BACKGROUND = id("ses", 1);
const MEMBER = id("ses", 2);
const PROJECT_MEMBER = id("ses", 3);
const PROJECT_BACKGROUND = id("ses", 4);
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
      values ('${BACKGROUND}', 'coding_claude', 'claude-code', 0, null, null, null, null, 'open', 1, 1),
             ('${MEMBER}', 'coding_omp', 'omp', 1, 'cli-m', null, null, null, 'open', 2, 2),
             ('${PROJECT_MEMBER}', 'coding_claude', 'claude-code', 1, 'cli-p', '${PROJECT}', 'project', '${PROJECT}', 'open', 3, 3),
             ('${PROJECT_BACKGROUND}', 'coding_claude', 'claude-code', 0, 'cli-h', '${PROJECT}', 'project', '${PROJECT}', 'open', 4, 4);
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
  const inputs: { command: string; input: unknown }[] = [];
  const provided = new Map<string, unknown>();
  const archived: string[] = [];
  const aliveBackground = new Set<string>();
  const evicted: string[] = [];
  const command = async (
    _who: unknown,
    envelope: { command: string; input: { session?: string } },
  ) => {
    commands.push(envelope.command);
    inputs.push({ command: envelope.command, input: envelope.input });
    if (envelope.command === "ArchiveSession") {
      archived.push(String(envelope.input.session));
    }
    return ok({ replayed: false, after_commit: [] });
  };
  const ctx = {
    clock,
    random: cryptoRandom,
    root: { path: root },
    registry,
    ledgerPath,
    peek: {
      terminalAgents: {
        background: {
          isAlive: (session: string) => aliveBackground.has(session),
          evict: (session: string) => {
            evicted.push(session);
            return aliveBackground.delete(session);
          },
        },
      },
    },
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
      get: (setting: { default?: unknown }) => setting.default,
    },
    provide: (name: string, value: unknown) => provided.set(name, value),
    bus: { publish: (_event: BusEvent) => {}, subscribe: () => () => {} },
    telemetry: { logger: { error() {}, warn() {}, info() {} } },
  };
  const built = await harnessWiring().build!(ctx as never);
  assert.ok(built.ok);
  const members = provided.get("harnessMembers") as HarnessMembers;
  const hold = provided.get("harnessHold") as HarnessHold;
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
    members,
    hold,
    registry,
    commands,
    inputs,
    archived,
    aliveBackground,
    evicted,
    put,
    ledgerPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("background session next/start works, and hold.open conflicts and kicks eviction while a background handle is alive", async () => {
  const kit = await setup();
  try {
    installWorkspaceEnvironment({
      deps: () => ({
        ...UNWIRED_WORKSPACE_DEPS,
        projects: {
          project: (prj) => ({ id: prj, archived: false }) as never,
          projectByName: () => null,
        },
      }),
    });

    // background()는 harness_gui=0만, describe()는 harness_gui=1만 낸다.
    assert.equal(kit.members.background?.(MEMBER), null);
    assert.equal(kit.members.background?.(PROJECT_MEMBER), null);
    assert.equal(kit.members.background?.(BACKGROUND)?.harness, "claude-code");
    assert.equal(
      kit.members.background?.(PROJECT_BACKGROUND)?.cli_session,
      "cli-h",
    );

    // TUI hold는 GUI 탭 session을 거절한다.
    const tabHold = kit.hold.open(PROJECT_MEMBER as Id<"ses">);
    assert.ok(!tabHold.ok && tabHold.error.code === "invalid_input");

    // background handle이 살아 있는 동안 TUI hold는 conflict를 내고 유휴 handle 정리를 요청한다.
    kit.aliveBackground.add(PROJECT_BACKGROUND);
    const blocked = kit.hold.open(PROJECT_BACKGROUND as Id<"ses">);
    assert.ok(!blocked.ok && blocked.error.code === "conflict");
    assert.deepEqual(kit.evicted, [PROJECT_BACKGROUND]);

    // evict가 handle을 닫은 뒤에는 hold가 열리고, hold 중에는 background next/start가 막힌다.
    const opened = kit.hold.open(PROJECT_BACKGROUND as Id<"ses">);
    assert.ok(opened.ok);
    assert.equal(opened.value.external_session, "cli-h");
    const heldMsg = await kit.put(PROJECT_BACKGROUND);
    assert.equal(await kit.members.next(PROJECT_BACKGROUND), null);
    const heldStart = await kit.members.start(PROJECT_BACKGROUND, heldMsg);
    assert.ok(!heldStart.ok && heldStart.error.code === "conflict");

    // hold가 없는 background session과 GUI member session은 모두 next/start가 된다.
    const bgMsg = await kit.put(BACKGROUND);
    assert.equal((await kit.members.next(BACKGROUND))?.message, bgMsg);
    assert.ok((await kit.members.start(BACKGROUND, bgMsg)).ok);

    const memberMsg = await kit.put(MEMBER);
    assert.equal((await kit.members.next(MEMBER))?.message, memberMsg);
    assert.ok((await kit.members.start(MEMBER, memberMsg)).ok);
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
      worktree_id: null,
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

test("a member turn's credential is scoped to that session and its project", async () => {
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
        session: BACKGROUND,
        turn: issued.value.turn,
      }).ok,
    );
  } finally {
    kit.cleanup();
  }
});

// worktree에서 연 탭의 팀원은 그 worktree에 고정해 연다. 원래 폴더의 같은 CLI session 팀원을 잇지 않는다. 섞이면 원래 폴더 권한 범위로
// worktree에서 일하고, 활성 turn 가드가 엉뚱한 checkout을 막거나 놓친다.
test("a tab in a worktree opens its member pinned to that worktree and never takes the original folder's member", async () => {
  const kit = await setup();
  try {
    const worktree = id("wkt", 1);
    const opened = await kit.members.ensure({
      harness: "claude-code",
      project: PROJECT,
      worktree_id: worktree,
      cli_session: "cli-p",
      taken: new Set(),
    });
    assert.ok(opened.ok && opened.value !== PROJECT_MEMBER);
    const sent = kit.inputs.find((one) => one.command === "OpenHarnessMember");
    assert.equal(
      (sent?.input as { worktree_id?: string }).worktree_id,
      worktree,
    );
    const profile = await kit.members.openForAgent!({
      harness: "claude-code",
      project: PROJECT,
      agent: "agt_x",
      worktree_id: worktree,
    });
    assert.ok(profile.ok);
    assert.equal(
      (kit.inputs.at(-1)?.input as { worktree_id?: string }).worktree_id,
      worktree,
    );
  } finally {
    kit.cleanup();
  }
});

// core가 탭을 열 팀원은 GUI 탭 팀원뿐이고(background session으로 탭을 열지 않는다), 사람이 coding session을 지우면 그 팀원만 보관한다.
test("only a GUI member is described for opening a tab, and forgetting a coding session archives only its member, for a person only", async () => {
  const kit = await setup();
  try {
    installWorkspaceEnvironment({
      deps: () => ({
        ...UNWIRED_WORKSPACE_DEPS,
        projects: {
          project: (prj) => ({ id: prj, archived: false }) as never,
          projectByName: () => null,
        },
      }),
    });
    assert.equal(kit.members.describe(PROJECT_BACKGROUND), null);
    assert.equal(kit.members.describe(MEMBER), null, "no project to open in");
    assert.deepEqual(kit.members.describe(PROJECT_MEMBER), {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-p",
      team: false,
      workflow_origin: null,
      worktree_id: null,
    });
    const origin = {
      project: id("prj", 9),
      workflow: "release",
      instance: id("wfi", 7),
      step: "verify",
    };
    const db = new DatabaseSync(kit.ledgerPath);
    try {
      db.prepare("update sessions set workflow_origin = ? where id = ?").run(
        JSON.stringify(origin),
        PROJECT_MEMBER,
      );
    } finally {
      db.close();
    }
    assert.deepEqual(kit.members.describe(PROJECT_MEMBER), {
      project: PROJECT,
      harness: "claude-code",
      cli_session: "cli-p",
      team: false,
      workflow_origin: origin,
      worktree_id: null,
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
