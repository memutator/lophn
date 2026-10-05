import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  type LophnError,
  manualClock,
  ok,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/contracts/platform/mod.ts";
import { applyMigrations } from "../../../packages/platform/backup-and-migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  runCommand,
} from "../../../packages/platform/ledger/mod.ts";
import {
  createPresetCommands,
  presetSchemaSteps,
} from "../../../packages/lophn-agent/presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
} from "../../../packages/lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  runSchemaSteps,
} from "../../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  presetDefinitionJson,
  presetValidateDeps,
} from "../../../packages/lophn-agent/harness/run-loop/testing/mod.ts";
import { providerSchemaSteps } from "../../../packages/lophn-agent/harness/provider/mod.ts";
import { usageSchemaSteps } from "../../../packages/lophn-agent/harness/usage/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  hasUnappliedSteering,
} from "../../../packages/lophn-agent/conversation/mod.ts";
import {
  agentRun,
  BODY,
  cred,
  hashOf,
  id,
} from "../../../packages/lophn-agent/conversation/testing/mod.ts";
import { envelope } from "../../../packages/lophn-agent/harness/run-loop/testing/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./ledger.ts";

// 세션·메시지의 파일 ledger와 platform 판정이 끼는 시험. 명령마다 새 connection으로
// 실행하고 commit 직후 닫아(kill과 같다) 다시 연 파일에서 저장된 사실을 관측한다.
// harness로는 닫고 다시 열 수 없고 agent 자격의 run 판정은 platform 소유라 이 자리가
// 맡는다. 실제 provider를 부르지 않고 LOPHN_HOME을 열지 않는다.

const NOW = Date.UTC(2026, 0, 1);
const DAY = 24 * 60 * 60 * 1000;
const ASG_LOPHN = id("asg", 1);
const ASG_CE = id("asg", 2);
const SESSION = id("ses", 1);
const PLACE_GLOBAL = { kind: "global", id: null };

async function fileLedger() {
  const dir = await Deno.makeTempDir({ prefix: "conversation-file-" });
  const path = `${dir}/ledger.db`;
  const clock = manualClock(NOW);
  const applied = await applyMigrations(
    path,
    [
      ...LEDGER_SCHEMA_STEPS,
      ...providerSchemaSteps,
      ...usageSchemaSteps,
      ...presetSchemaSteps,
      ...assignmentSchemaSteps,
      ...runSchemaSteps,
      ...conversationSchemaSteps,
    ],
    { clock },
  );
  assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
  const deps = {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    ports: [],
    registerBlobRef: () =>
      err<LophnError>({ code: "unavailable", message: "blob 없음" }),
    call: () =>
      err<LophnError>({ code: "unavailable", message: "dispatch 없음" }),
    checkCredential: (ctx: AuthenticatedContext) => ok(ctx),
  };
  const presets = createPresetCommands(presetValidateDeps());
  const assignments = createAssignmentCommands();
  const runs = createRunCommands({ hasUnappliedSteering });
  const conversation = createConversationCommands({
    acceptRun: (tx, ctx, input, compare) =>
      runs.accept.handle(tx, { ...ctx, actor: "machine" }, input, compare),
  });
  const registry = [
    presets.registerDefault,
    assignments.createBuiltin,
    assignments.pause,
    assignments.resume,
    runs.accept,
    runs.start,
    runs.finish,
    conversation.open,
    conversation.receive,
    conversation.close,
  ];
  let key = 0;
  const execute = async (
    actor: string,
    command: string,
    input: unknown,
    compare: unknown,
  ) => {
    const opened = openConnection(path);
    assert(opened.ok, "open");
    try {
      return await runCommand(opened.value, deps, registry, cred(actor), {
        command,
        input,
        idempotency_key: `file-${++key}`,
        compare,
        prepared: [],
      });
    } finally {
      opened.value.close();
    }
  };
  const observe = <T>(
    read: (sql: {
      get: (q: string, p: never[]) => Record<string, unknown> | undefined;
    }) => T,
  ): T => {
    const opened = openConnection(path);
    assert(opened.ok, "reopen");
    try {
      return read(opened.value.sql as never);
    } finally {
      opened.value.close();
    }
  };
  const count = (table: string) =>
    observe((db) =>
      Number(db.get(`select count(*) as n from ${table}`, [])!["n"])
    );
  const must = async (...args: Parameters<typeof execute>) => {
    const result = await execute(...args);
    assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
    return result;
  };
  const definition = presetDefinitionJson("lophn");
  await must("machine", "RegisterDefaultPreset", {
    id: id("pst", 1),
    definition,
    definition_hash: hashOf(definition),
  }, {});
  await must("machine", "CreateBuiltinAssignment", {
    id: ASG_LOPHN,
    preset: id("pst", 1),
    preset_revision: 1,
    role: "lophn",
    scope: { kind: "all", id: null },
  }, {});
  await must("user", "OpenSession", {
    id: SESSION,
    assignment: ASG_LOPHN,
    role: "lophn",
    work_place: PLACE_GLOBAL,
    continued_from: null,
  }, { assignment_revision: 1, assignment_state: "enabled" });
  const receive = (
    message: string,
    revision: number,
    state: "enabled" | "paused",
  ) =>
    execute("user", "ReceiveMessage", {
      id: message,
      session: SESSION,
      body: BODY(message.length),
      mode: "request",
    }, {
      session_state: "open",
      session_state_seq: observe((db) =>
        String(db.get("select state_seq as s from sessions", [])!["s"])
      ),
      assignment_revision: revision,
      assignment_state: state,
    });
  return {
    clock,
    execute,
    must,
    observe,
    count,
    receive,
    close: () => Deno.remove(dir, { recursive: true }),
  };
}

Deno.test("lophn-agent/conversation#R2: confirmed messages and their runs stay after reopening the ledger file, with no midnight or idle expiry", async () => {
  const ledger = await fileLedger();
  try {
    const accepted = await ledger.receive(id("msg", 1), 1, "enabled");
    assert(accepted.ok, accepted.ok ? "" : JSON.stringify(accepted.error));
    // 자정과 31일 유휴가 지나도 세션은 열려 있고 미처리 말과 담당 run이 그대로다.
    ledger.clock.advance(31 * DAY);
    const after = ledger.observe((db) => ({
      session: db.get("select state, closed_reason from sessions", []),
      message: db.get("select run, applied_at_call from messages", []),
      run: db.get("select state, source_message from runs", []),
    }));
    assertEquals(after.session, { state: "open", closed_reason: null });
    assertEquals(after.run, {
      state: "accepted",
      source_message: id("msg", 1),
    });
    assert(after.message !== undefined && after.message["run"] !== null);
    assertEquals(after.message["applied_at_call"], null);
    // 다시 연 뒤 같은 말을 다시 입력시키지 않는다. 같은 id 재전송은 이전 결과다.
    const replay = await ledger.receive(id("msg", 1), 1, "enabled");
    assert(replay.ok, replay.ok ? "" : JSON.stringify(replay.error));
    assertEquals(ledger.count("runs"), 1);
    assertEquals(ledger.count("messages"), 1);
    // 닫는 command를 보내지 않는 한 어떤 경로도 세션을 닫지 않았다.
    assertEquals(ledger.count("sessions"), 1);
  } finally {
    await ledger.close();
  }
});

Deno.test("lophn-agent/conversation#R8: a session idle for 31 days and a paused assignment keep it open and readable", async () => {
  const ledger = await fileLedger();
  try {
    await ledger.must("user", "ReceiveMessage", {
      id: id("msg", 1),
      session: SESSION,
      body: BODY(1),
      mode: "request",
    }, {
      session_state: "open",
      session_state_seq: ledger.observe((db) =>
        String(db.get("select state_seq as s from sessions", [])!["s"])
      ),
      assignment_revision: 1,
      assignment_state: "enabled",
    });
    ledger.clock.advance(31 * DAY);
    // 일시 멈춤도 세션을 닫지 않는다. 멈춘 동안 온 다음 요청은 원문만 보존한다.
    await ledger.must("user", "PauseAssignment", {
      assignment: ASG_LOPHN,
      reason: { kind: "user", detail: "잠시", runs: [], target: null },
    }, { revision: 1, state: "enabled" });
    const kept = await ledger.receive(id("msg", 2), 2, "paused");
    assert(kept.ok, kept.ok ? "" : JSON.stringify(kept.error));
    const state = ledger.observe((db) => ({
      session: db.get("select state from sessions", []),
      kept: db.get("select run from messages where id = ?", [
        id("msg", 2),
      ] as never),
    }));
    assertEquals(state.session, { state: "open" });
    assertEquals(state.kept, { run: null });
    assertEquals(ledger.count("messages"), 2);
    assertEquals(ledger.count("runs"), 1);
  } finally {
    await ledger.close();
  }
});

// agent 자격의 기록은 platform이 자격에 묶인 run의 상태를 판정해야 통과한다
// (platform/ledger R11). 이 module은 그 판정을 runs 표에서 답한다.
async function openAgentHarness(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../../packages/lophn-agent/harness/provider/registration_test.ts",
        import.meta.url,
      ),
      new URL(
        "../../../packages/lophn-agent/harness/usage/registration_test.ts",
        import.meta.url,
      ),
      new URL(
        "./lophn-agent-conversation-registration_test.ts",
        import.meta.url,
      ),
    ],
    credentials: [cred("user"), cred("machine")],
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

Deno.test("lophn-agent/conversation#R4: an agent answer is the role's judgment bound to its own run and another assignment's agent cannot write", async () => {
  const h = await openAgentHarness();
  try {
    const must = async (
      ctx: AuthenticatedContext,
      command: string,
      input: unknown,
      compare: unknown = {},
    ) => {
      const result = await h.command(ctx, envelope(command, input, compare));
      assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
      return result.value.result as Record<string, unknown>;
    };
    const machine = cred("machine");
    const user = cred("user");
    for (
      const [assignment, kind] of [
        [ASG_LOPHN, "lophn"],
        [ASG_CE, "context_engineer"],
      ] as const
    ) {
      const definition = presetDefinitionJson(kind);
      await must(machine, "RegisterDefaultPreset", {
        id: id("pst", kind.length),
        definition,
        definition_hash: hashOf(definition),
      });
      await must(machine, "CreateBuiltinAssignment", {
        id: assignment,
        preset: id("pst", kind.length),
        preset_revision: 1,
        role: kind,
        scope: { kind: "all", id: null },
      });
    }
    const sessionSeq = async (session: string) => {
      const rows = await h.inspect(
        "select cast(state_seq as text) as s from sessions where id = ?",
        [session],
      );
      assert(rows.ok);
      return String(rows.value[0]!["s"]);
    };
    // 두 assignment 모두 세션 하나와 시작한 run 하나를 만든다.
    const runs: Record<string, string> = {};
    for (
      const [n, assignment, role] of [
        [1, ASG_LOPHN, "lophn"],
        [2, ASG_CE, "context_engineer"],
      ] as const
    ) {
      const session = id("ses", n);
      await must(user, "OpenSession", {
        id: session,
        assignment,
        role,
        work_place: PLACE_GLOBAL,
        continued_from: null,
      }, { assignment_revision: 1, assignment_state: "enabled" });
      const received = await must(user, "ReceiveMessage", {
        id: id("msg", n),
        session,
        body: BODY(n),
        mode: "request",
      }, {
        session_state: "open",
        session_state_seq: await sessionSeq(session),
        assignment_revision: 1,
        assignment_state: "enabled",
      }) as { message: { run: string } };
      runs[assignment] = received.message.run;
    }
    const agent = agentRun(ASG_LOPHN, runs[ASG_LOPHN]!);
    const other = agentRun(ASG_CE, runs[ASG_CE]!);
    assert((await h.setCredential(agent)).ok);
    assert((await h.setCredential(other)).ok);
    const record = (
      ctx: AuthenticatedContext,
      message: string,
      run: string | null,
    ) =>
      h.command(
        ctx,
        envelope("RecordMessage", {
          id: message,
          session: id("ses", 1),
          run,
          body: BODY(40),
          links: [],
        }),
      );
    // 자기 run의 답은 역할 판단(agent)으로 남고 사람 말과 구분된다.
    const answered = await record(agent, id("msg", 5), runs[ASG_LOPHN]!);
    assert(answered.ok, answered.ok ? "" : JSON.stringify(answered.error));
    const listed = await h.read(
      { resource: "messages", method: "list" },
      user,
      { session: id("ses", 1) },
    );
    assert(listed.ok);
    assertEquals(
      (listed.value as {
        messages: { message: { actor: string; mode: string | null } }[];
      }).messages.map((entry) => [entry.message.actor, entry.message.mode]),
      [["user", "request"], [`agent:${ASG_LOPHN}`, null]],
    );
    // agent는 자기 run의 답만 기록한다.
    const unbound = await record(agent, id("msg", 6), null);
    assert(!unbound.ok && unbound.error.code === "forbidden");
    // 다른 assignment의 agent는 이 세션을 없는 세션처럼 본다.
    const foreign = await record(other, id("msg", 7), runs[ASG_CE]!);
    assert(!foreign.ok && foreign.error.code === "not_found");
    const rows = await h.inspect("select count(*) as n from messages", []);
    assert(rows.ok);
    assertEquals(Number(rows.value[0]!["n"]), 3);
  } finally {
    await h.close();
  }
});
