import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";

// assignment ledger 테스트. 실제 등록 executor(harness)와 임시 ledger 파일을 쓴다.
// 자리 보관에 반응하는 루프는 apps/core/testing/lophn-agent-assignments-reaction_test.ts에 있다.

const NOW = Date.UTC(2026, 0, 1);

const OPERATIONS = [
  "CreateBuiltinAssignment",
  "CreateAppEngineerAssignment",
  "CreateOperatorAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "SeedPlaceEvent",
  "ReadAssignment",
  "ListAssignments",
  "CommandResult",
];

function credential(actor: string, principal: string): AuthenticatedContext {
  return {
    actor,
    principal,
    credential_ref: `test:${principal}:${actor}`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

const userCred = credential("user", "user-1");
const machineCred = credential("machine", "machine-1");
const OPERATOR = "asg_01arz3ndektsv4rrffq69g5fa3";
const agentCred = credential(`agent:${OPERATOR}`, `agent:${OPERATOR}`);

const LOPHN = "asg_01arz3ndektsv4rrffq69g5fa1";
const CE = "asg_01arz3ndektsv4rrffq69g5fa2";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fb1";
const APP = "app_01arz3ndektsv4rrffq69g5fb2";

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function asg(n: number): string {
  return `asg_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

let keys = 0;
function envelope(command: string, input: unknown, compare: unknown = {}) {
  keys++;
  return {
    command,
    input,
    compare,
    idempotency_key: `assignment-k-${keys}`,
    prepared: [] as string[],
  };
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [new URL("./registration_test.ts", import.meta.url)],
    credentials: [userCred, machineCred, agentCred],
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  assert(
    !result.ok,
    result.ok ? "expected failure, got " + JSON.stringify(result.value) : "",
  );
  assertEquals(result.error.code, expected);
}

type Record_ = Record<string, unknown>;

// command 결과 안의 assignment 한 건.
function created(result: Result<unknown>): Record_ {
  const stored = value(result) as { result: { assignment: Record_ } };
  return stored.result.assignment;
}

async function rows(h: LedgerHarness, query: string, params: string[] = []) {
  return value(await h.inspect(query, params));
}

async function seedEvent(h: LedgerHarness, type: string, subject: string) {
  return value(
    await h.command(machineCred, envelope("SeedPlaceEvent", { type, subject })),
  );
}

async function seedPlaces(h: LedgerHarness) {
  await seedEvent(h, "ProjectCreated", PROJECT);
  await seedEvent(h, "AppCreated", APP);
}

function createOperator(
  h: LedgerHarness,
  id: string,
  scope: unknown,
  as: AuthenticatedContext = userCred,
) {
  return h.command(as, envelope("CreateOperatorAssignment", { id, scope }));
}

async function seedBuiltins(h: LedgerHarness) {
  for (const [id, role] of [[LOPHN, "lophn"], [CE, "context_engineer"]]) {
    value(
      await h.command(
        machineCred,
        envelope("CreateBuiltinAssignment", {
          id,
          role,
          scope: { kind: "all", id: null },
        }),
      ),
    );
  }
}

Deno.test("lophn-agent/assignments#R2 [agent-R12]: lophn and Context Engineer are one each, an app gets one App Engineer and a place takes any number of Operators", async () => {
  const h = await open();
  try {
    await seedBuiltins(h);
    await seedPlaces(h);
    // 역할마다 전역 하나: 둘째는 conflict다.
    code(
      await h.command(
        machineCred,
        envelope("CreateBuiltinAssignment", {
          id: asg(9),
          role: "lophn",
          scope: { kind: "all", id: null },
        }),
      ),
      "conflict",
    );
    // 앱마다 App Engineer 하나: 같은 앱 둘째는 다른 id여도 conflict다.
    const appCreated = (await seedEvent(h, "AppCreated", APP)) as {
      result: { seq: string };
    };
    const engineer = (id: string) =>
      h.command(
        machineCred,
        envelope("CreateAppEngineerAssignment", {
          id,
          app_created_seq: appCreated.result.seq,
          app: APP,
        }, {}),
      );
    assertEquals(created(await engineer(asg(5))).role, "app_engineer");
    code(await engineer(asg(6)), "conflict");
    // Operator는 한 자리에 여덟을 넘게도 만들어진다.
    for (let n = 10; n < 20; n++) {
      assertEquals(
        created(
          await createOperator(h, asg(n), { kind: "project", id: PROJECT }),
        )
          .role,
        "operator",
      );
    }
    assertEquals(
      (await rows(
        h,
        "select count(*) as n from assignments where role = 'operator' and scope_id = ?",
        [PROJECT],
      ))[0]!["n"],
      10n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R3 [agent-R12]: a read gives only identity, role, scope, state and revision, and the settings columns and tables are gone", async () => {
  const h = await open();
  try {
    await seedBuiltins(h);
    const read = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: LOPHN,
      }),
    ) as { assignment: Record_ };
    assertEquals(read.assignment, {
      id: LOPHN,
      role: "lophn",
      scope: { kind: "all", id: null },
      state: "enabled",
      pause_reason: null,
      revision: 1,
    });
    const list = value(
      await h.read({ resource: "assignments", method: "list" }, userCred, {
        role: "context_engineer",
      }),
    ) as { assignments: Record_[] };
    assertEquals(list.assignments.map((entry) => entry["id"]), [CE]);
    // preset·남길 문서·읽을 앱·주기·승인 칸과 판 기록 표는 없다.
    const columns =
      (await rows(h, "select name from pragma_table_info('assignments')"))
        .map((row) => String(row["name"]));
    assertEquals(columns.sort(), [
      "id",
      "pause_detail",
      "pause_target",
      "revision",
      "role",
      "scope_id",
      "scope_kind",
      "state",
    ]);
    const tables = (await rows(
      h,
      "select name from sqlite_master where type = 'table' and name like 'assignment%'",
    )).map((row) => String(row["name"]));
    assertEquals(tables, ["assignments"]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R4 [agent-R12]: a person creates an Operator assignment in a project or app, nobody else does and a repeat conflicts", async () => {
  const h = await open();
  try {
    await seedPlaces(h);
    const record = created(
      await createOperator(h, OPERATOR, { kind: "project", id: PROJECT }),
    );
    assertEquals(record, {
      id: OPERATOR,
      role: "operator",
      scope: { kind: "project", id: PROJECT },
      state: "enabled",
      pause_reason: null,
      revision: 1,
    });
    const events = await rows(
      h,
      "select subject, actor, payload from events where type = 'AssignmentCreated'",
    );
    assertEquals(events.length, 1);
    assertEquals(events[0]!["subject"], OPERATOR);
    assertEquals(events[0]!["actor"], "user");
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      revision: 1,
      role: "operator",
      scope: { kind: "project", id: PROJECT },
    });
    // 앱 자리도 된다.
    assertEquals(
      created(await createOperator(h, asg(7), { kind: "app", id: APP })).scope,
      { kind: "app", id: APP },
    );
    // 같은 id는 두 번 만들지 않는다.
    code(
      await createOperator(h, OPERATOR, { kind: "project", id: PROJECT }),
      "conflict",
    );
    // agent와 machine은 만들지 못한다.
    code(
      await createOperator(h, asg(8), { kind: "app", id: APP }, agentCred),
      "forbidden",
    );
    code(
      await createOperator(h, asg(8), { kind: "app", id: APP }, machineCred),
      "forbidden",
    );
    // 자리 `all`은 Operator의 자리가 아니고 없는 자리는 not_found다.
    code(
      await createOperator(h, asg(8), { kind: "all", id: null }),
      "invalid_input",
    );
    code(
      await createOperator(h, asg(8), {
        kind: "project",
        id: "prj_01arz3ndektsv4rrffq69g5fzz",
      }),
      "not_found",
    );
    assertEquals(
      (await rows(h, "select count(*) as n from assignments"))[0]!["n"],
      2n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R9 [agent-R12]: a person withdraws an Operator once, built-in and App Engineer assignments cannot be withdrawn", async () => {
  const h = await open();
  try {
    await seedBuiltins(h);
    await seedPlaces(h);
    created(
      await createOperator(h, OPERATOR, { kind: "project", id: PROJECT }),
    );
    const appCreated = (await seedEvent(h, "AppCreated", APP)) as {
      result: { seq: string };
    };
    created(
      await h.command(
        machineCred,
        envelope("CreateAppEngineerAssignment", {
          id: asg(5),
          app_created_seq: appCreated.result.seq,
          app: APP,
        }, {}),
      ),
    );
    const withdraw = (
      assignment: string,
      revision: number,
      state = "enabled",
      as: AuthenticatedContext = userCred,
    ) =>
      h.command(
        as,
        envelope("WithdrawAssignment", { assignment }, { revision, state }),
      );
    // lophn·Context Engineer·App Engineer는 거둘 수 없다.
    code(await withdraw(LOPHN, 1), "forbidden");
    code(await withdraw(CE, 1), "forbidden");
    code(await withdraw(asg(5), 1), "forbidden");
    // 낡은 revision은 conflict이고 사람만 거둔다.
    code(await withdraw(OPERATOR, 7), "conflict");
    code(await withdraw(OPERATOR, 1, "enabled", machineCred), "forbidden");
    code(await withdraw(OPERATOR, 1, "enabled", agentCred), "forbidden");
    const record = created(await withdraw(OPERATOR, 1));
    assertEquals([record["state"], record["revision"]], ["withdrawn", 2]);
    assertEquals(
      JSON.parse(String(
        (await rows(
          h,
          "select payload from events where type = 'AssignmentWithdrawn'",
        ))[0]!["payload"],
      )),
      { before: 1, after: 2 },
    );
    // 거둔 책임은 다시 거두거나 재개하지 않고 읽기는 남는다.
    code(await withdraw(OPERATOR, 2, "enabled"), "conflict");
    code(
      await h.command(
        machineCred,
        envelope("ResumeAssignment", { assignment: OPERATOR }, {
          revision: 2,
          state: "paused",
        }),
      ),
      "conflict",
    );
    const read = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: OPERATOR,
      }),
    ) as { assignment: Record_ };
    assertEquals(read.assignment["state"], "withdrawn");
    // 같은 자리에 새 Operator를 만들 수 있다.
    assertEquals(
      created(
        await createOperator(h, asg(21), { kind: "project", id: PROJECT }),
      )
        .state,
      "enabled",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R14 [agent-R12]: only the machine pauses, only for an archived place with scope_archived, and a person cannot pause or resume", async () => {
  const h = await open();
  try {
    await seedPlaces(h);
    created(
      await createOperator(h, OPERATOR, { kind: "project", id: PROJECT }),
    );
    const reason = (kind: string, target = PROJECT) => ({
      kind,
      detail: "The project was archived.",
      target,
    });
    const pause = (
      body: unknown,
      as: AuthenticatedContext = machineCred,
    ) =>
      h.command(
        as,
        envelope("PauseAssignment", { assignment: OPERATOR, reason: body }, {
          revision: 1,
          state: "enabled",
        }),
      );
    // 사람 멈춤과 옛 근거(연속 실패·output 보관·user)는 없다.
    code(await pause(reason("scope_archived"), userCred), "forbidden");
    code(await pause(reason("user")), "invalid_input");
    code(
      await pause({ ...reason("consecutive_failures"), runs: [] }),
      "invalid_input",
    );
    code(await pause(reason("output_archived")), "invalid_input");
    // 보관되지 않은 자리, 다른 자리의 근거는 멈추지 못한다.
    code(await pause(reason("scope_archived")), "forbidden");
    await seedEvent(h, "ProjectArchived", PROJECT);
    code(await pause(reason("scope_archived", APP)), "forbidden");
    // CAS가 다르면 멈추지 않는다.
    code(
      await h.command(
        machineCred,
        envelope(
          "PauseAssignment",
          { assignment: OPERATOR, reason: reason("scope_archived") },
          { revision: 9, state: "enabled" },
        ),
      ),
      "conflict",
    );
    const record = created(await pause(reason("scope_archived")));
    assertEquals(record["state"], "paused");
    assertEquals(record["revision"], 2);
    assertEquals(record["pause_reason"], reason("scope_archived"));
    const events = await rows(
      h,
      "select payload from events where type = 'AssignmentPaused'",
    );
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      before: 1,
      after: 2,
      reason: reason("scope_archived"),
    });
    // 사람 재개는 없다.
    code(
      await h.command(
        userCred,
        envelope("ResumeAssignment", { assignment: OPERATOR }, {
          revision: 2,
          state: "paused",
        }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R1 [agent-R12]: the machine resumes a paused assignment once the place is unarchived and not before", async () => {
  const h = await open();
  try {
    await seedPlaces(h);
    created(await createOperator(h, OPERATOR, { kind: "app", id: APP }));
    await seedEvent(h, "AppArchived", APP);
    created(
      await h.command(
        machineCred,
        envelope("PauseAssignment", {
          assignment: OPERATOR,
          reason: { kind: "scope_archived", detail: "archived", target: APP },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    const resume = (revision = 2) =>
      h.command(
        machineCred,
        envelope("ResumeAssignment", { assignment: OPERATOR }, {
          revision,
          state: "paused",
        }),
      );
    // 보관이 풀리기 전에는 재개하지 않는다.
    code(await resume(), "forbidden");
    await seedEvent(h, "AppUnarchived", APP);
    code(await resume(5), "conflict");
    const record = created(await resume());
    assertEquals(
      [record["state"], record["revision"], record["pause_reason"]],
      ["enabled", 3, null],
    );
    assertEquals(
      JSON.parse(String(
        (await rows(
          h,
          "select payload from events where type = 'AssignmentResumed'",
        ))[0]!["payload"],
      )),
      { before: 2, after: 3 },
    );
    const columns = (await rows(
      h,
      "select pause_detail, pause_target from assignments where id = ?",
      [OPERATOR],
    ))[0]!;
    assertEquals([columns["pause_detail"], columns["pause_target"]], [
      null,
      null,
    ]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/assignments#R16 [agent-R12]: reads show paused and withdrawn assignments with their reason and past records", async () => {
  const h = await open();
  try {
    await seedPlaces(h);
    created(
      await createOperator(h, OPERATOR, { kind: "project", id: PROJECT }),
    );
    created(await createOperator(h, asg(4), { kind: "project", id: PROJECT }));
    await seedEvent(h, "ProjectArchived", PROJECT);
    created(
      await h.command(
        machineCred,
        envelope("PauseAssignment", {
          assignment: OPERATOR,
          reason: {
            kind: "scope_archived",
            detail: "archived",
            target: PROJECT,
          },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    created(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: asg(4) }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    const list = async (state: string) =>
      (value(
        await h.read({ resource: "assignments", method: "list" }, userCred, {
          state,
        }),
      ) as { assignments: Record_[] }).assignments.map((entry) => entry["id"]);
    assertEquals(await list("paused"), [OPERATOR]);
    assertEquals(await list("withdrawn"), [asg(4)]);
    const paused = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: OPERATOR,
      }),
    ) as { assignment: Record_ };
    assertEquals(paused.assignment["pause_reason"], {
      kind: "scope_archived",
      detail: "archived",
      target: PROJECT,
    });
  } finally {
    await h.close();
  }
});
