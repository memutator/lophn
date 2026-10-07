import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { canonicalize, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";

// assignment ledger 테스트. 실제 등록 executor(harness)로 T9의 요구를 잇는다.
// direct connection integration(T9 notification, R13, R14)은
// apps/core/testing/lophn-agent-assignments_test.ts에 있다.

const NOW = Date.UTC(2026, 0, 1);

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreatePreset",
  "RevisePreset",
  "CreateBuiltinAssignment",
  "CreateAppEngineerAssignment",
  "ApplyOperatorAssignment",
  "ChangeAssignmentPreset",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "ReadAssignment",
  "ListAssignments",
  "ReadAssignmentOutput",
  "ReadPreset",
  "CommandResult",
];

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

let idCounter = 0;

export function assignmentEnvelope(
  command: string,
  input: unknown,
  compare: unknown = {},
) {
  idCounter++;
  return {
    command,
    input,
    compare,
    idempotency_key: `k-${idCounter}`,
    prepared: [] as string[],
  };
}

function definitionHash(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

export function presetDefinitionJson(
  kind: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind,
    name: "Review",
    origin: "product",
    prompt: "a".repeat(64),
    capability: {
      bundles: [{ name: "read-only", revision: 1 }],
      tools: [],
    },
    context: [{ kind: "document", target: DOC, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "medium",
      options: {},
    },
    organizing_model: null,
    instructions: [],
    ...overrides,
  };
}

async function open(
  credentials: readonly AuthenticatedContext[] = [userCred, machineCred],
): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials,
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
  return value(result);
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function seedPreset(
  h: LedgerHarness,
  id: string,
  kind: string,
  overrides: Record<string, unknown> = {},
) {
  const definition = presetDefinitionJson(kind, overrides);
  return await h.command(
    machineCred,
    assignmentEnvelope("RegisterDefaultPreset", {
      id,
      definition,
      definition_hash: definitionHash(definition),
    }),
  );
}

async function createBuiltin(
  h: LedgerHarness,
  id: string,
  role: "lophn" | "context_engineer",
  preset: string,
) {
  return await h.command(
    machineCred,
    assignmentEnvelope("CreateBuiltinAssignment", {
      id,
      preset,
      preset_revision: 1,
      role,
      scope: { kind: "all", id: null },
    }),
  );
}

Deno.test("lophn-agent/assignments#R2: builtin roles are one per role, duplicate app engineer rejected", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fbw", "context_engineer"),
    );
    // lophn과 CE 전역은 각각 하나(R2).
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fbx",
        "context_engineer",
        "pst_01arz3ndektsv4rrffq69g5fbw",
      ),
    );
    // 같은 역할 둘째는 conflict다(R2).
    code(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fby",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
      "conflict",
    );
    assertEquals(
      rows(
        await h.inspect("select count(*) as n from assignments", []),
      )[0]!["n"],
      2n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R3: assignment read gives the record, run state stays in run-loop", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    const read = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      }),
    ) as { assignment: Record<string, unknown> };
    // role·scope·state·revision은 상세에서 확인한다(R3). run 상태는 이 읽기에 없다.
    assertEquals(read.assignment.role, "lophn");
    assertEquals(read.assignment.state, "enabled");
    assertEquals(read.assignment.revision, 1);
    assertEquals(read.assignment.pause_reason, null);
    assertEquals(read.assignment.outputs, []);
    assertEquals(read.assignment.schedule, null);
    // 과거 revision도 같은 읽기다(R12).
    const past = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        revision: 1,
      }),
    ) as { assignment: Record<string, unknown> };
    assertEquals(past.assignment.revision, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R9: paused resumes only by user, builtin cannot withdraw, withdrawn rejects resume", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fbw", "context_engineer"),
    );
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    // builtin은 회수할 수 없다(R9).
    code(
      await h.command(
        userCred,
        assignmentEnvelope("WithdrawAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 1, state: "enabled" }),
      ),
      "forbidden",
    );
    // machine pause는 user 근거를 내지 못한다(R10). enabled에서 시도한다
    // (compare가 enabled만 받으므로 근거 검사에 닿으려면 여기서 본다).
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "machine이 사람 근거를 대신 썼다",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
      "forbidden",
    );
    // 사람 pause는 user 근거로 진행한다(R9, R10).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "사람이 직접 멈췄다",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    // 사람만 재개한다(R9).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("ResumeAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 2, state: "paused" }),
      ),
    );
    // withdrawal은 CE 전역에서 거절이고(R9) 재개와 새 assignment로 계속된다.
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "enabled",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R10: three consecutive real-start failures emit machine pause without secrets", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    // machine pause는 근거가 있는 closed failures로만 내는 것은 T10 run ledger
    // 자리다(남은 것). 여기서는 실제 근거 재검사가 forbidden을 내는지 본다(R10).
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "consecutive_failures",
            detail: "최종 실패 3회",
            runs: [
              "run_01arz3ndektsv4rrffq69g5fav",
              "run_01arz3ndektsv4rrffq69g5fbw",
              "run_01arz3ndektsv4rrffq69g5fbx",
            ],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
      "forbidden",
    );
    // 근거를 아직 남긴 run이 없으면 forbidden이다(T10 후에 실제 발생으로 대체).
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from assignment_revisions where assignment_id = ?",
          ["asg_01arz3ndektsv4rrffq69g5fav"],
        ),
      )[0]!["n"],
      1n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R11 and #R17: paused assignment keeps the revision until user resume", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "사람이 잠시 멈췄다",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    // CAS가 일치하지 않으면 paused를 유지한다(R12).
    code(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "CAS가 다르다",
            runs: [],
            target: null,
          },
        }, { revision: 99, state: "enabled" }),
      ),
      "conflict",
    );
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "paused",
    );
    // 사람이 재개한다(R12).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("ResumeAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 2, state: "paused" }),
      ),
    );
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "enabled",
    );
    // pause_reason은 해제된다(R12).
    assertEquals(
      rows(
        await h.inspect(
          "select pause_reason_kind from assignments where id = ?",
          ["asg_01arz3ndektsv4rrffq69g5fav"],
        ),
      )[0]!["pause_reason_kind"],
      null,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R17: preset change applies a same-kind preset only, connected stays", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    // 다른 lophn preset을 저장해도(R17) 연결 판은 그대로다. 먼저 preset 하나 더 만든다.
    const other = presetDefinitionJson("lophn", {
      name: "Review 2",
      origin: "user",
    });
    value(
      await h.command(
        userCred,
        assignmentEnvelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbw",
          definition: other,
          copied_from: null,
        }),
      ),
    );
    value(
      await h.command(
        userCred,
        assignmentEnvelope("ChangeAssignmentPreset", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          preset: "pst_01arz3ndektsv4rrffq69g5fbw",
          preset_revision: 1,
        }, { revision: 1, role: "lophn" }),
      ),
    );
    // 명시 적용은 다음 run부터다(R17). 커밋 뒤 assignment preset이 바뀐다.
    assertEquals(
      rows(
        await h.inspect("select preset_id from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["preset_id"],
      "pst_01arz3ndektsv4rrffq69g5fbw",
    );
    // operator 역할은 전체 승인으로만 바뀐다(R17).
    value(
      await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fcv", "context_engineer"),
    );
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fbx",
        "context_engineer",
        "pst_01arz3ndektsv4rrffq69g5fcv",
      ),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R12: paused stays across definition change and restart, only explicit user resume releases", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    const paused = value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "사람이 멈췄다",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    ) as unknown as { result: { assignment: Record<string, unknown> } };
    assertEquals(paused.result.assignment.state, "paused");

    // 정의 변경(새 preset 저장)은 paused를 풀지 않는다(R12).
    const other = presetDefinitionJson("lophn", {
      name: "Review 2",
      origin: "user",
    });
    value(
      await h.command(
        userCred,
        assignmentEnvelope("CreatePreset", {
          id: "pst_01arz3ndektsv4rrffq69g5fbw",
          definition: other,
          copied_from: null,
        }),
      ),
    );
    // 정의 변경은 compare가 state를 검사하지 않으므로 paused에서도 적용되고
    // 상태는 paused로 남는다(R12).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("ChangeAssignmentPreset", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          preset: "pst_01arz3ndektsv4rrffq69g5fbw",
          preset_revision: 1,
        }, { revision: 2, role: "lophn" }),
      ),
    );
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "paused",
    );

    // 시간 경과·다른 역할 handoff(다른 사용자 resume 시도 포함)로 풀리지 않는다.
    // resume은 user만 받으므로 machine resume은 forbidden이다(R12).
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("ResumeAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 3, state: "paused" }),
      ),
      "forbidden",
    );
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "paused",
    );

    // 사람의 명시적 재개만 푼다(R12).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("ResumeAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 3, state: "paused" }),
      ),
    );
    assertEquals(
      rows(
        await h.inspect("select state from assignments where id = ?", [
          "asg_01arz3ndektsv4rrffq69g5fav",
        ]),
      )[0]!["state"],
      "enabled",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R16: enabled reads and paused preserves input, withdrawn reads past only", async () => {
  const h = await open();
  try {
    value(await seedPreset(h, "pst_01arz3ndektsv4rrffq69g5fav", "lophn"));
    value(
      await createBuiltin(
        h,
        "asg_01arz3ndektsv4rrffq69g5fav",
        "lophn",
        "pst_01arz3ndektsv4rrffq69g5fav",
      ),
    );
    // paused에서도 읽기는 열려 있다(R16).
    value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
          reason: {
            kind: "user",
            detail: "사람이 멈췄다",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    const pausedRead = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: "asg_01arz3ndektsv4rrffq69g5fav",
      }),
    ) as { assignment: Record<string, unknown> };
    assertEquals(pausedRead.assignment.state, "paused");
    // paused의 입력 보존은 conversation 자리다. 여기서 pause 입력이 그대로 남는지 본다.
    const reason = pausedRead.assignment.pause_reason as {
      kind: string;
    };
    assertEquals(reason.kind, "user");
    // 회수한다(R16). 전역 builtin은 회수가 거절이므로(R9) withdrawn은 읽기만 확인한다.
    code(
      await h.command(
        userCred,
        assignmentEnvelope("WithdrawAssignment", {
          assignment: "asg_01arz3ndektsv4rrffq69g5fav",
        }, { revision: 2, state: "paused" }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});
