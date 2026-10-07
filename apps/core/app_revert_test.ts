// lophn-agent#T48 앱 revert. 되돌림 근거(tool_calls.app_command와 result.content.revert
// receipt)를 가진 run을 RevertRun(user)이 applying으로 저장하고, machine이 앱의 선언된
// revert command를 원래 호출 역순으로 직접 부른 뒤 단계를 CheckpointRevert로 기록하고
// FinishRevert로 끝낸다(R10, R11). 등록은 packages/lophn-agent/revert/registration_test.ts
// (run·assignment·tool_calls·revert 표, 앱 owner, 시험용 소유자)를 쓴다. 실제 앱 호출은
// runtime이 direct call로 하고, 이 테스트는 runtime 흉내로 machine 자격의 CheckpointRevert
// ·FinishRevert를 부른다. 실제 provider를 부르지 않고 사람 데이터 root를 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import { revertRun } from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  SqlParam,
  SqlRow,
} from "../../packages/contracts/platform/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./testing/ledger.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  acceptRun,
  ASG_LOPHN,
  envelope,
  finishRunFixture,
  machineCredential,
  must,
  RUN_LIMITS,
  RUN_NOW,
  RUN_OPERATIONS,
  runId,
  seedAssignments,
  seedRunLimits,
  startRunFixture,
  userCredential,
} from "../../packages/lophn-agent/harness/run-loop/testing/runs.ts";
import {
  buildRevertInput,
  type RevertGroup,
} from "../../packages/lophn-agent/revert/mod.ts";

const MY_OPERATIONS = [
  "RevertRun",
  "PreviewRevert",
  "ListReverts",
  "CheckpointRevert",
  "FinishRevert",
  "RecordAppCall",
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "RecordNote",
];
const user: AuthenticatedContext = {
  ...userCredential,
  scope: { operations: [...RUN_OPERATIONS, ...MY_OPERATIONS], targets: {} },
};
const machine: AuthenticatedContext = {
  ...machineCredential,
  scope: { operations: [...RUN_OPERATIONS, ...MY_OPERATIONS], targets: {} },
};

const APP = id("app", 1);
const REL = id("rel", 1);
const RUN_1 = runId("run", 1);
const RUN_2 = runId("run", 2);
const MODEL_CALL = id("mcl", 1);
const INV_1 = id("inv", 1);
const INV_2 = id("inv", 2);
const INPUT_HASH = "1".repeat(64);
const OUTPUT_HASH = "2".repeat(64);

function id(prefix: string, n: number): string {
  const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../packages/lophn-agent/revert/registration_test.ts",
        import.meta.url,
      ),
    ],
    credentials: [user, machine],
    nowMs: RUN_NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  const h = opened.value;
  await seedAssignments(h);
  await seedRunLimits(h, RUN_LIMITS);
  return h;
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function sql(
  h: LedgerHarness,
  query: string,
  params: readonly SqlParam[] = [],
): Promise<SqlRow[]> {
  return value(await h.inspect(query, params));
}

// run 하나에 되돌림 근거가 있는 앱 write call 두 개를 남긴다. envelope의 run으로 event가
// 묶이고, 증거 행은 tool_calls 표에 둔다(원래 호출 계약 app_command와 receipt). 기록은
// machine 도구 chain(판정·시작·마침)을 요청 상태부터 거친다(tools R15).
async function appRun(
  h: LedgerHarness,
  run: string,
  revs: {
    toolCall: string;
    invocation: string;
    receipt: string;
    expected: string;
  }[],
  changes?: () => Promise<void>,
) {
  await must(
    await acceptRun(h, {
      run,
      source: { kind: "message", message: id("msg", 1) },
    }),
  );
  must(await startRunFixture(h, run, ASG_LOPHN));
  for (const [index, rev] of revs.entries()) {
    value(
      await h.command(machine, {
        run,
        command: "RecordToolRequest",
        input: {
          id: rev.toolCall,
          run,
          model_call: MODEL_CALL,
          response_key: `call-${index + 1}`,
          response_order: 0,
          tool: "add_todo",
          definition_revision: "1",
          effect: "write",
          confirm: false,
          extension: null,
          input: INPUT_HASH,
          retry_of: null,
          attempt: 0,
          app_command: {
            app: APP,
            release: REL,
            command: "add_todo",
            blueprint_hash: INPUT_HASH,
            definition_hash: OUTPUT_HASH,
            permission_basis: {
              grant: id("grt", 1),
              scope: "todos",
              basis_seq: "0",
            },
            context_binding: null,
            revert_command: "revert_todo",
          },
        },
        compare: { run_state_seq: "1", model_call_finished_seq: "1" },
        idempotency_key: `req-${rev.toolCall}`,
        prepared: [],
      }),
    );
    value(
      await h.command(machine, {
        run,
        command: "DecideToolCall",
        input: {
          tool_call: rev.toolCall,
          decision: {
            decision: "allow",
            reason: "scope allows it",
            effect: "reversible_write",
            assignment_revision: 1,
            preset_revision: 1,
            contract_revision: "1",
            comparison_basis: null,
            approval: null,
          },
        },
        compare: { state_seq: "0" },
        idempotency_key: `dec-${rev.toolCall}`,
        prepared: [],
      }),
    );
    value(
      await h.command(machine, {
        run,
        command: "StartToolCall",
        input: {
          tool_call: rev.toolCall,
          started_at: new Date(RUN_NOW).toISOString(),
          approval: null,
        },
        compare: { state_seq: "1", run_state_seq: "1", assignment_revision: 1 },
        idempotency_key: `st-${rev.toolCall}`,
        prepared: [],
      }),
    );
    value(
      await h.command(machine, {
        run,
        command: "FinishToolCall",
        input: {
          tool_call: rev.toolCall,
          outcome: { kind: "success", code: "ok" },
          output: OUTPUT_HASH,
          result: {
            status: "success",
            summary: "command add_todo of todo finished",
            content: {
              invocation: rev.invocation,
              revert: {
                invocation: rev.invocation,
                receipt: rev.receipt,
                expected_revision: rev.expected,
              },
            },
            complete: true,
            source: null,
            continuation: null,
            pending: [],
          },
          finished_at: new Date(RUN_NOW).toISOString(),
          duration_ms: 1,
        },
        compare: { state_seq: "2" },
        idempotency_key: `fin-${rev.toolCall}`,
        prepared: [],
      }),
    );
  }
  if (changes !== undefined) await changes();
  must(
    await finishRunFixture(h, run, {
      kind: "completed",
      reason: "answer_completed",
    }),
  );
}

type Preview = { groups: RevertGroup[]; binding_hash: string };

async function preview(h: LedgerHarness, run: string): Promise<Preview> {
  return value(
    await h.read({ resource: "reverts", method: "preview" }, user, { run }),
  ) as Preview;
}

let counter = 0;

async function apply(
  h: LedgerHarness,
  run: string,
  shown?: Preview,
  revertId?: string,
) {
  const seen = shown ?? await preview(h, run);
  const items = value(
    await buildRevertInput(
      seen.groups,
      () => Promise.resolve({ ok: true as const, value: null }),
    ),
  );
  const input = {
    id: revertId ?? runId("rvt", 1),
    run,
    allow_partial: false,
    preview_hash: seen.binding_hash,
    groups: items,
  };
  const binding = await confirmationBinding(revertRun, input);
  assert(binding !== undefined);
  counter++;
  const issued = value(
    await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: `win-${counter}`,
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [revertRun.name],
        expires_at: new Date(RUN_NOW + 86_400_000).toISOString(),
      },
    }),
  ) as { confirmation: string };
  counter++;
  return await h.command(user, {
    command: "RevertRun",
    input,
    compare: { preview_hash: seen.binding_hash },
    idempotency_key: `revert-k-${counter}`,
    prepared: [],
    confirmation: issued.confirmation,
  });
}

function stepKey(revert: string, invocation: string): string {
  return `${revert}:${invocation}`;
}

Deno.test("lophn-agent/revert#R10: 저장한 invocation·receipt·현재 revision을 검증해 원래 호출 역순으로 앱 revert command를 직접 부르고 실제 결과를 기록한다", async () => {
  const h = await open();
  try {
    const call1 = id("tcl", 1);
    const call2 = id("tcl", 2);
    await appRun(h, RUN_1, [
      {
        toolCall: call1,
        invocation: INV_1,
        receipt: "change:101",
        expected: "7",
      },
      {
        toolCall: call2,
        invocation: INV_2,
        receipt: "change:102",
        expected: "7",
      },
    ]);
    // preview의 앱 묶음은 되돌림 근거(app_command와 receipt)를 가진다.
    const shown = await preview(h, RUN_1);
    const app = shown.groups.filter((group) =>
      group.owner === "apps/invocations"
    );
    assertEquals(app.length, 2);
    assertEquals(app[0]!.app_revert?.step_key, stepKey(RUN_1, INV_1));
    assertEquals(app[1]!.app_revert?.step_key, stepKey(RUN_1, INV_2));
    assertEquals(app[1]!.app_revert?.receipt, "change:102");
    assertEquals(app[0]!.app_revert?.invocation, INV_1);
    // applying으로 저장한다. 실제 복원은 아직 아니다.
    const started = value(await apply(h, RUN_1)) as {
      result: {
        id: string;
        outcome: string;
        result_seq: string | null;
      };
    };
    assertEquals(started.result.outcome, "applying");
    assertEquals(started.result.result_seq, null);
    const revert = started.result.id;
    // machine이 원래 호출 역순으로 단계를 기록한다(R10).
    const first = value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: stepKey(revert, INV_2),
          invocation: INV_2,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-1-${revert}`,
        prepared: [],
      }),
    ) as { result: { recorded: boolean } };
    assertEquals(first.result.recorded, true);
    // 같은 step_key의 같은 기록은 한 번만 받는다(R8).
    const again = value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: stepKey(revert, INV_2),
          invocation: INV_2,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-2-${revert}`,
        prepared: [],
      }),
    ) as { result: { recorded: boolean } };
    assertEquals(again.result.recorded, false);
    // 다른 invocation의 기록은 거절한다.
    code(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: stepKey(revert, INV_2),
          invocation: INV_1,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-3-${revert}`,
        prepared: [],
      }),
      "invalid_input",
    );
    // 나머지 단계를 끝내고 FinishRevert로 확정한다.
    const done = value(
      await h.command(machine, {
        command: "FinishRevert",
        input: {
          revert,
          step_keys: [stepKey(revert, INV_1), stepKey(revert, INV_2)],
        },
        compare: {},
        idempotency_key: `finish-${revert}`,
        prepared: [],
      }),
    ) as { result: { outcome: string; result_seq: string | null } };
    assertEquals(done.result.outcome, "applied");
    assert(done.result.result_seq !== null);
    // 실제 복원 결과는 run revert에 남는다. 앱 단계 결과는 restored다.
    const rows = await sql(
      h,
      `select result, reason, app_revert from revert_changes
       where revert = ? and owner = 'apps/invocations' order by ordinal`,
      [revert],
    );
    assertEquals(rows.length, 2);
    assertEquals(String(rows[0]!["result"]), "restored");
    assertEquals(String(rows[1]!["result"]), "restored");
    assertEquals(rows[0]!["app_revert"], null);
    assertEquals(rows[1]!["app_revert"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R11: 앱 revert와 ledger 복원은 한 transaction으로 보장하지 않고 시작 뒤 실패·충돌·응답 유실을 행마다 보존한다", async () => {
  const h = await open();
  try {
    const call1 = id("tcl", 3);
    const call2 = id("tcl", 4);
    await appRun(h, RUN_2, [
      {
        toolCall: call1,
        invocation: INV_1,
        receipt: "change:201",
        expected: "7",
      },
      {
        toolCall: call2,
        invocation: INV_2,
        receipt: "change:202",
        expected: "7",
      },
    ]);
    const started = value(await apply(h, RUN_2)) as {
      result: {
        id: string;
        outcome: string;
      };
    };
    assertEquals(started.result.outcome, "applying");
    const revert = started.result.id;
    // 첫 단계(마지막 호출 INV_2)가 실패하고, 둘째 단계(INV_1)는 응답 유실이다.
    value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: stepKey(revert, INV_2),
          invocation: INV_2,
          result: "failure",
        },
        compare: {},
        idempotency_key: `ck-4-${revert}`,
        prepared: [],
      }),
    );
    // 응답 유실 단계는 기록 없이 FinishRevert만 온다. 불명확으로 남는다(R11).
    const done = value(
      await h.command(machine, {
        command: "FinishRevert",
        input: {
          revert,
          step_keys: [stepKey(revert, INV_1), stepKey(revert, INV_2)],
        },
        compare: {},
        idempotency_key: `finish-${revert}`,
        prepared: [],
      }),
    ) as { result: { outcome: string } };
    assertEquals(done.result.outcome, "uncertain");
    // 실패는 partial이고 응답 유실은 uncertain이다. 전체 완료·전체 미실행으로 덮지 않는다.
    const rows = await sql(
      h,
      `select result, reason from revert_changes
       where revert = ? and owner = 'apps/invocations' order by ordinal`,
      [revert],
    );
    assertEquals(rows.length, 2);
    assertEquals(String(rows[0]!["result"]), "uncertain");
    assertEquals(String(rows[0]!["reason"]), "app_uncertain");
    assertEquals(String(rows[1]!["result"]), "failure");
    assertEquals(String(rows[1]!["reason"]), "app_failed");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R11: 시작 전 실패는 어느 것도 실행하지 않고 blocked 결과를 남긴다", async () => {
  const h = await open();
  try {
    const note = id("ctx", 1);
    const call1 = id("tcl", 5);
    // run이 진행되는 동안 사람이 아닌 변경을 더한다. apply 단계 전 실패다.
    await appRun(h, RUN_1, [
      {
        toolCall: call1,
        invocation: INV_1,
        receipt: "change:301",
        expected: "7",
      },
    ], async () => {
      value(
        await h.command(
          user,
          envelope("RecordNote", {
            note,
            value: "later",
          }),
        ),
      );
    });
    // 사람이 본 판: run의 app 묶음과 run 밖 note 묶음.
    const fresh = await preview(h, RUN_1);
    const app = fresh.groups.filter((group) =>
      group.owner === "apps/invocations"
    );
    assertEquals(app.length, 1);
    assertEquals(app[0]!.app_revert?.step_key, stepKey(RUN_1, INV_1));
    const notes = fresh.groups.filter((group) =>
      group.owner === "fixture/notes"
    );
    assertEquals(notes.map((group) => group.capability), ["conflict"]);
    // 사람이 이 판으로 요청한다. 충돌이 막으므로 어떤 변경도 시작하지 않는다.
    const blocked = value(await apply(h, RUN_1, fresh)) as {
      result: {
        id: string;
        outcome: string;
      };
    };
    assertEquals(blocked.result.outcome, "blocked");
    const revert = blocked.result.id;
    // applying이 아니므로 단계 기록도 끝내기도 거절된다(R11 시작 전 실패).
    code(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: stepKey(revert, INV_1),
          invocation: INV_1,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-6-${revert}`,
        prepared: [],
      }),
      "conflict",
    );
    code(
      await h.command(machine, {
        command: "FinishRevert",
        input: { revert, step_keys: [stepKey(revert, INV_1)] },
        compare: {},
        idempotency_key: `finish-b-${revert}`,
        prepared: [],
      }),
      "conflict",
    );
    // blocked 결과에는 run의 app 묶음이 그대로 남는다(R6). 실제 복원은 아니다.
    const rows = await sql(
      h,
      `select result, reason, app_revert from revert_changes
       where revert = ? and owner = 'apps/invocations' order by ordinal`,
      [revert],
    );
    assertEquals(rows.length, 1);
    assertEquals(String(rows[0]!["result"]), "unchanged");
    assertEquals(String(rows[0]!["reason"]), "blocked_conflict");
    assert(rows[0]!["app_revert"] !== null);
  } finally {
    await h.close();
  }
});
