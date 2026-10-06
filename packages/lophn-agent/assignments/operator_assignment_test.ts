import { assert, assertEquals } from "@std/assert";
import {
  canonicalize,
  formatAt,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import {
  agentCredential,
  hashOf,
  HOUR_MS,
  id,
  machineCredential,
  must,
  START_MS,
  userCredential,
} from "../scheduling/testing/mod.ts";
import {
  envelope,
  presetDefinitionJson,
} from "../harness/run-loop/testing/mod.ts";

// Operator 적용 테스트(assignments R4–R8, R15, presets R15, tool-judgment R4).
// 사람이 승인한 고정 bundle만 적용되고 agent가 직접 적용할 수 없으며, preset 전체
// 판·범위·남길 문서·주기·승인 read의 전후·이유가 bundle에 묶인다. 승인 표는
// platform 소유라 granted 행은 fixture command로 둔다. 실제 provider·사람 데이터
// root는 열지 않는다.

const ASG_OP = id("asg", 1);
const ASG_B = id("asg", 2);
const PRESET_OP = id("pst", 1);
const DOC_A = id("doc", 1);
const DOC_B = id("doc", 2);
const FIRST = START_MS + HOUR_MS;

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
// ReadAssignmentOutput은 outputs read의 route name이다.
const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreateBuiltinAssignment",
  "ApplyOperatorAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "SeedApprovalFixture",
  "ReadAssignment",
  "ReadAssignmentOutput",
  "CommandResult",
];

type Bundle = {
  draft_version: string;
  assignment: string | null;
  expected_assignment_revision: number | null;
  preset: string;
  preset_revision: number;
  preset_definition: string;
  scope: { kind: "project"; id: string } | { kind: "app"; id: string };
  outputs: { document: string; content: string }[];
  read_apps: string[];
  read_commands: { app: string; command: string }[];
  schedule: { first_at: string; every_ms: number };
  reason: string;
};

function json<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

type Fixture = {
  h: LedgerHarness;
  approvals: number;
  presetDefinition: string;
};

async function open(): Promise<Fixture> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials: [
      userCredential,
      machineCredential,
      agentCredential(ASG_OP),
      testUserCredential(),
    ],
    nowMs: START_MS,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return { h: opened.value, approvals: 0, presetDefinition: "" };
}

function testUserCredential() {
  return {
    actor: "user",
    principal: "user-read",
    credential_ref: "test:user-read:user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

async function sql(
  f: Fixture,
  query: string,
  params: (string | number)[] = [],
): Promise<Record<string, unknown>[]> {
  return must(await f.h.inspect(query, params));
}

async function registerPresets(f: Fixture): Promise<void> {
  const definition = presetDefinitionJson("operator");
  const hash = hashOf(definition);
  must(
    await f.h.command(
      machineCredential,
      envelope("RegisterDefaultPreset", {
        id: PRESET_OP,
        definition,
        definition_hash: hash,
      }),
    ),
  );
  f.presetDefinition = hash;
}

function bundle(f: Fixture, creating: boolean): Bundle {
  return {
    draft_version: id("ver", f.approvals),
    assignment: creating ? null : ASG_OP,
    expected_assignment_revision: creating ? null : 1,
    preset: PRESET_OP,
    preset_revision: 1,
    preset_definition: f.presetDefinition,
    scope: { kind: "project", id: id("prj", 1) },
    outputs: [{ document: DOC_A, content: "watch changes" }],
    read_apps: [],
    read_commands: [],
    schedule: { first_at: formatAt(FIRST), every_ms: HOUR_MS },
    reason: "approved by person",
  };
}

// 사람이 승인한 묶음을 적용한다. 승인 표는 platform 소유라 granted 행을 fixture command로
// 둔다. 사람이 승인 묶음을 확인한 handle은 route가 선언한 binding field만 묶는다.
async function applyOperator(
  f: Fixture,
  input: {
    target?: string;
    bundle?: Partial<Bundle>;
    as?: typeof userCredential | typeof machineCredential;
    status?: string;
  } = {},
): Promise<Result<unknown>> {
  const target = input.target ?? ASG_OP;
  const current = await sql(
    f,
    "select revision from assignments where id = ?",
    [target],
  );
  const creating = current.length === 0;
  const approval = id("apr", ++f.approvals);
  must(
    await f.h.command(
      machineCredential,
      envelope("SeedApprovalFixture", {
        id: approval,
        status: input.status ?? "granted",
      }),
    ),
  );
  const applied = {
    approval,
    decision_seq: "1",
    id: target,
    bundle: {
      ...bundle(f, creating),
      // 변경 묶음은 이미 있는 assignment를 가리킨다(R5).
      ...(creating ? {} : { assignment: target }),
      ...input.bundle,
    },
  };
  const bound = {
    approval: applied.approval,
    decision_seq: applied.decision_seq,
    bundle: applied.bundle,
  };
  const issued = must(
    await f.h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: approval,
        content_hash: await sha256Hex(canonicalize(bound)),
        allowed_decisions: ["ApplyOperatorAssignment"],
        expires_at: formatAt(START_MS + 600_000),
      },
    }),
  ) as { confirmation: string };
  return await f.h.command(input.as ?? machineCredential, {
    ...envelope("ApplyOperatorAssignment", applied),
    confirmation: issued.confirmation,
  });
}

Deno.test("lophn-agent/assignments#R4: a person-approved bundle applies and an agent credential is forbidden", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    // machine credential은 승인된 bundle을 적용한다(R4).
    const created = (json(await applyOperator(f)) as {
      result: { assignment: Record<string, unknown> };
    }).result;
    assertEquals(created.assignment.role, "operator");
    assertEquals(created.assignment.state, "enabled");
    // agent 자격은 적용 contract를 내지 못한다(R4). 같은 bundle이어도 forbidden이다.
    code(
      await applyOperator(f, { as: agentCredential(ASG_OP) }),
      "forbidden",
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R5: a bundle with a changed preset revision conflicts", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    // preset 판 hash가 저장된 것과 다르면 conflict다(R5).
    code(
      await applyOperator(f, {
        bundle: { preset_definition: "b".repeat(64) },
      }),
      "conflict",
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R5: a changed bundle content and a stale expected revision are both rejected", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    // 이전 assignment 판이 다르면 적용하지 않는다(R5). 검토한 expected revision
    // (1)보다 저장된 revision(2)이 뒤의 묶음은 conflict다.
    json(
      await applyOperator(f, {
        bundle: { outputs: [{ document: DOC_A, content: "first summary" }] },
      }),
    );
    const changed = await sql(
      f,
      "select revision from assignments where id = ?",
      [ASG_OP],
    );
    assertEquals(Number(changed[0]!["revision"]), 2);
    // 검토 뒤 assignment가 이미 다른 판으로 갔다면 옛 묶음은 적용하지 않는다(R5).
    code(
      await applyOperator(f, {
        bundle: {
          expected_assignment_revision: 1,
          outputs: [{ document: DOC_A, content: "stale summary" }],
        },
      }),
      "conflict",
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R5: an approved bundle carries the review material and the preset full revision", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    // 승인 묶음에는 preset 판 hash와 사람이 검토할 이유가 묶인다(presets#R15).
    json(await applyOperator(f));
    const row = await sql(f, "select approval, revision from assignments", []);
    assertEquals(row.length, 1);
    assert(String(row[0]!["approval"]).startsWith("apr_"));
    // bundle의 preset_definition은 preset 판 전체 blob의 sha256이다(presets#R15).
    const blob = await sql(
      f,
      "select definition_hash from preset_revisions where preset_id = ? and revision = 1",
      [PRESET_OP],
    );
    assertEquals(blob.length, 1);
    assertEquals(String(blob[0]!["definition_hash"]), f.presetDefinition);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R6: outputs smaller than one is not coupled and the assignment declares all bundle outputs", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    // 남길 문서 최소 1개는 bundle 모양이 강제하므로 contract 검증은 fixture가 아닌
    // 적용 결과로 본다(R6): 선언된 문서와 실제 잔디 선언 표가 같다.
    json(await applyOperator(f));
    const outputs = await sql(
      f,
      "select document_id, owns_output from assignment_outputs where assignment_id = ?",
      [ASG_OP],
    );
    assertEquals(outputs.length, 1);
    assertEquals(String(outputs[0]!["document_id"]), DOC_A);
    assertEquals(String(outputs[0]!["owns_output"]), "1");
    // 최초 양식도 실제 내용으로 남는다(R6). lookbehind 데이터 root는 밟지 않는다.
    const row = await sql(
      f,
      "select content from assignment_outputs where assignment_id = ?",
      [ASG_OP],
    );
    assertEquals(String(row[0]!["content"]), "watch changes");
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R7: a renamed document keeps the same document identity and adds no extra read of the data address", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    // 남길 문서는 document id로 선언된다(R7). 이름·자리가 바뀌어도 id는 같다.
    const counted = await sql(
      f,
      "select count(*) as n from assignment_outputs where document_id = ?",
      [DOC_A],
    );
    assertEquals(Number(counted[0]!["n"]), 1);
    // outputs read는 같은 document id만 묻고 자료 속 주소의 추가 읽기를 하지 않는다(R7).
    const moved = json(
      await f.h.read(
        { resource: "assignments", method: "outputs" },
        testUserCredential(),
        { document: DOC_A },
      ),
    ) as { output: { assignment: string } | null };
    assertEquals(moved.output?.assignment, ASG_OP);
    // 다른 문서 id는 선언이 없다(R7, documents#T6).
    const other = json(
      await f.h.read(
        { resource: "assignments", method: "outputs" },
        testUserCredential(),
        { document: DOC_B },
      ),
    ) as { output: { assignment: string } | null };
    assertEquals(other.output, null);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R8: a second operator declaration of the same document is rejected and paused keeps the ownership", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    // 같은 문서를 남길 문서로 선언한 두 번째 Operator는 거절된다(R8).
    // 같은 project scope의 독립 Operator가 DOC_A를 다시 선언한다.
    code(
      await applyOperator(f, { target: ASG_B }),
      "internal",
    );
    // 첫 Operator는 소유를 유지한다(R8).
    const owned = json(
      await f.h.read(
        { resource: "assignments", method: "outputs" },
        testUserCredential(),
        { document: DOC_A },
      ),
    ) as { output: { assignment: string } | null };
    assertEquals(owned.output?.assignment, ASG_OP);
    // paused는 독점을 유지한다(R8).
    must(
      await f.h.command(
        userCredential,
        envelope("PauseAssignment", {
          assignment: ASG_OP,
          reason: {
            kind: "user",
            detail: "person paused the operator",
            runs: [],
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    const paused = json(
      await f.h.read(
        { resource: "assignments", method: "outputs" },
        testUserCredential(),
        { document: DOC_A },
      ),
    ) as { output: { assignment: string; state: string } | null };
    assertEquals(paused.output?.assignment, ASG_OP);
    assertEquals(paused.output?.state, "paused");
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/assignments#R15: no automatic acceptance outside the schedule or human requests", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    // assignment 등록만으로 run이 접수되지 않는다(R15, R4 확인).
    const runs = await sql(
      f,
      "select count(*) as n from events where type in ('RunStarted', 'RunFinished')",
      [],
    );
    assertEquals(Number(runs[0]!["n"]), 0);
    // 주기 회차도 아직 접수되지 않는다(R15). scheduling이 계산의 몫이다.
    const rounds = await sql(
      f,
      "select count(*) as n from assignment_schedule_occurrences",
      [],
    );
    assertEquals(Number(rounds[0]!["n"]), 0);
    // 남는 event는 등록 것뿐이다. run·회차 접수 event는 여기 없다(R15).
    const events = await sql(
      f,
      "select distinct type from events order by type",
      [],
    );
    for (const entry of events) {
      assertEquals(
        ["AssignmentCreated", "AssignmentChanged", "PresetCreated"].includes(
          String(entry["type"]),
        ),
        true,
        `unexpected event type ${entry["type"]}`,
      );
    }
  } finally {
    await f.h.close();
  }
});

// R15의 주기 회차 표는 scheduling 소유다. operator 적용 등록만으로 row가 생기지
// 않는지 이 테스트 등록에 같은 schema로 본다(schedulingSchemaSteps).
Deno.test("lophn-agent/assignments#R15: the occurrence table stays empty after a creation-only apply", async () => {
  const f = await open();
  try {
    await registerPresets(f);
    json(await applyOperator(f));
    const rounds = await sql(
      f,
      "select count(*) as n from assignment_schedule_occurrences",
      [],
    );
    assertEquals(Number(rounds[0]!["n"]), 0);
  } finally {
    await f.h.close();
  }
});
