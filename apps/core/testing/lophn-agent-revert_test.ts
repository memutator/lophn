import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../packages/base/mod.ts";
import { revertRun } from "../../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  SqlParam,
  SqlRow,
} from "../../../packages/contracts/platform/mod.ts";
import { createLedgerHarness, type LedgerHarness } from "./ledger.ts";
import { confirmationBinding } from "../../../packages/platform/identity/mod.ts";
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
} from "../../../packages/lophn-agent/harness/run-loop/testing/runs.ts";
import {
  buildRevertInput,
  type RevertGroup,
} from "../../../packages/lophn-agent/revert/mod.ts";

// revert engine의 전체 사전 검사와 원자 적용(lophn-agent/revert). 실제 등록 executor(harness)와
// 임시 ledger 파일을 쓰고, 소유 concern의 복원 command는 시험용 소유자(notes, mail)로 대신한다
// (packages/lophn-agent/revert/registration_test.ts). 문서의 실제 판정과 복원은
// apps/core/revert_test.ts가 실제 core와 documents로 본다. 실제 provider를 부르지 않고 사람
// 데이터 root를 열지 않는다. 앱 단계와 ledger 묶음이 섞인 revert의 끝내기(lophn-agent#T48, R10·R11)도
// 여기서 본다: 실제 앱 호출 쪽은 apps/core/app_revert_test.ts가 실제 core와 todo fixture로 본다.

const MY_OPERATIONS = [
  "RevertRun",
  "PreviewRevert",
  "ListReverts",
  "RecordNote",
  "TouchNote",
  "RestoreNote",
  "RecordMail",
  "RecordStranger",
  "RecordToolRequest",
  "DecideToolCall",
  "StartToolCall",
  "FinishToolCall",
  "CheckpointRevert",
  "FinishRevert",
];
const user: AuthenticatedContext = {
  ...userCredential,
  scope: { operations: [...RUN_OPERATIONS, ...MY_OPERATIONS], targets: {} },
};
const machine: AuthenticatedContext = {
  ...machineCredential,
  scope: { operations: [...RUN_OPERATIONS, ...MY_OPERATIONS], targets: {} },
};

const NOTE_A = runId("ctx", 1);
const NOTE_B = runId("ctx", 2);
const MAIL = runId("ntf", 1);
const THING = runId("trm", 1);
const RUN_1 = runId("run", 1);
const RUN_2 = runId("run", 2);

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL(
        "../../../packages/lophn-agent/revert/registration_test.ts",
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

async function count(
  h: LedgerHarness,
  query: string,
  params: readonly SqlParam[] = [],
): Promise<number> {
  return Number((await sql(h, query, params))[0]!["n"]);
}

// run 하나에 변경을 만든다. envelope의 run으로 event에 run이 묶인다.
function record(
  h: LedgerHarness,
  run: string,
  command: string,
  input: unknown,
) {
  return h.command(machine, { ...envelope(command, input), run });
}

async function note(
  h: LedgerHarness,
  run: string,
  id: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return value(
    await record(h, run, "RecordNote", { note: id, value: text, ...extra }),
  );
}

// 끝난 run. changes가 변경을 만든 뒤 마친다.
async function finished(
  h: LedgerHarness,
  run: string,
  message: number,
  changes: () => Promise<void>,
) {
  must(
    await acceptRun(h, {
      run,
      source: { kind: "message", message: runId("msg", message) },
    }),
  );
  must(await startRunFixture(h, run, ASG_LOPHN));
  await changes();
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

async function noteValue(h: LedgerHarness, id: string): Promise<string> {
  return String(
    (await sql(h, "select value from fixture_notes where id = ?", [id]))[0]![
      "value"
    ],
  );
}

let counter = 0;

type Apply = {
  id?: string;
  allowPartial?: boolean;
  prepared?: Record<string, unknown>;
  shown?: Preview;
};

// 사람이 본 preview로 적용한다. 확인 handle은 command가 선언한 binding field로 만든다.
async function apply(h: LedgerHarness, run: string, options: Apply = {}) {
  const shown = options.shown ?? await preview(h, run);
  const items = value(
    await buildRevertInput(shown.groups, (group) => {
      const prepared = options.prepared;
      return Promise.resolve({
        ok: true as const,
        value: prepared !== undefined && group.before_ref?.["needs_prepared"]
          ? prepared as never
          : null,
      });
    }),
  );
  const input = {
    id: options.id ?? runId("rvt", 1),
    run,
    allow_partial: options.allowPartial ?? false,
    preview_hash: shown.binding_hash,
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
    compare: { preview_hash: shown.binding_hash },
    idempotency_key: `revert-k-${counter}`,
    prepared: [],
    confirmation: issued.confirmation,
  });
}

type Header = {
  id: string;
  outcome: string;
  result_seq: string | null;
  replayed: boolean;
};

async function list(h: LedgerHarness, run: string) {
  return (value(
    await h.read({ resource: "reverts", method: "list" }, user, { run }),
  ) as {
    reverts: {
      id: string;
      outcome: string;
      changes: {
        capability: string;
        result: string;
        owner: string;
        reason: string | null;
        restored_seqs: string[];
      }[];
    }[];
  }).reverts;
}

function eventTypes(h: LedgerHarness, after = 0) {
  return sql(h, "select type from events where seq > ? order by seq", [after])
    .then((rows) => rows.map((row) => String(row["type"])));
}

async function head(h: LedgerHarness): Promise<number> {
  return await count(h, "select coalesce(max(seq), 0) as n from events");
}

Deno.test("lophn-agent/revert#R4: 사전 검사에서 두 대상 중 하나만 충돌해도 어느 쪽도 복원하지 않고 blocked 결과가 남는다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      await note(h, RUN_1, NOTE_B, "b1");
    });
    // run이 끝난 뒤 B에 다른 주체의 변경이 생겼다. 값이 우연히 같아도 충돌이다.
    value(
      await h.command(
        user,
        envelope("RecordNote", { note: NOTE_B, value: "b1" }),
      ),
    );
    const shown = await preview(h, RUN_1);
    const capabilities = shown.groups.filter((group) =>
      group.owner === "fixture/notes"
    ).map((group) => [group.target, group.capability]);
    assertEquals(capabilities, [[NOTE_A, "reversible"], [NOTE_B, "conflict"]]);
    const before = await head(h);
    const done = value(await apply(h, RUN_1)) as { result: Header };
    assertEquals(done.result.outcome, "blocked");
    // 둘 다 그대로다. 복원 event는 없고 결과 event 하나만 남는다.
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals(await noteValue(h, NOTE_B), "b1");
    assertEquals(await eventTypes(h, before), ["RevertBlocked"]);
    const [revert] = await list(h, RUN_1);
    assertEquals(revert.outcome, "blocked");
    const notes = revert.changes.filter((change) =>
      change.owner === "fixture/notes"
    );
    assertEquals(notes.map((change) => change.result), [
      "unchanged",
      "conflict",
    ]);
    assertEquals(notes[0].reason, "blocked_conflict");
    assertEquals(notes[1].reason, "later_change");
    assert(revert.changes.every((change) => change.restored_seqs.length === 0));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R4: preview 뒤 대상이 바뀌면 사람이 본 내용을 고쳐 적용하지 않고 현재 판정의 blocked 결과를 남긴다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      await note(h, RUN_1, NOTE_B, "b1");
    });
    const shown = await preview(h, RUN_1);
    assertEquals(
      shown.groups.filter((group) => group.capability === "reversible").length,
      2,
    );
    // 사람이 본 뒤에 이 run의 새 사실이 생겼다. 복원 가능한 두 묶음은 그대로지만 본 내용과 다르다.
    value(await record(h, RUN_1, "RecordStranger", { subject: THING }));
    const before = await head(h);
    const stale = value(await apply(h, RUN_1, { shown })) as { result: Header };
    assertEquals(stale.result.outcome, "blocked");
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals(await noteValue(h, NOTE_B), "b1");
    assertEquals(await eventTypes(h, before), ["RevertBlocked"]);
    const [revert] = await list(h, RUN_1);
    const reversible = revert.changes.filter((change) =>
      change.capability === "reversible"
    );
    assertEquals(reversible.length, 2);
    assert(
      reversible.every((change) =>
        change.result === "unchanged" &&
        change.reason === "stale_preview"
      ),
    );
    // 사람이 본 뒤 대상 자체가 바뀌었으면 현재 판정은 충돌이고 그대로 기록한다.
    value(
      await h.command(
        user,
        envelope("RecordNote", { note: NOTE_A, value: "later" }),
      ),
    );
    const fresh = await preview(h, RUN_1);
    const changed = value(
      await apply(h, RUN_1, { shown: fresh, id: runId("rvt", 2) }),
    ) as { result: Header };
    assertEquals(changed.result.outcome, "blocked");
    assertEquals(await noteValue(h, NOTE_A), "later");
    const second = (await list(h, RUN_1)).find((item) =>
      item.id === runId("rvt", 2)
    )!;
    const conflicted = second.changes.find((change) =>
      change.capability === "conflict"
    );
    assertEquals(conflicted?.result, "conflict");
    assertEquals(conflicted?.reason, "later_change");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R4: 사전 검사 뒤 owner가 거절하면 앞서 복원한 것도 함께 취소되어 일부만 남지 않는다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      await note(h, RUN_1, NOTE_B, "b1");
    });
    const shown = await preview(h, RUN_1);
    assert(
      shown.groups.filter((group) => group.capability === "reversible")
        .length === 2,
    );
    // owner의 숨은 상태(event 없는 변화)가 바뀌어 B의 복원만 거절된다. 복원은 나중 변경부터
    // 하므로 B가 먼저, A가 나중이다: B를 거절시키면 시작도 안 하고, A를 거절시키면 B 복원이
    // 먼저 일어난 뒤에 취소돼야 한다.
    value(await h.command(machine, envelope("TouchNote", { note: NOTE_A })));
    const before = await head(h);
    const failed = await apply(h, RUN_1, { shown });
    code(failed, "conflict");
    assertEquals(await noteValue(h, NOTE_B), "b1");
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals(await eventTypes(h, before), []);
    assertEquals(await count(h, "select count(*) as n from reverts"), 0);
    assertEquals(
      await count(h, "select count(*) as n from revert_changes"),
      0,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R7: 복원 불가 변경이 섞이면 기본으로 아무것도 바꾸지 않고 명시 동의 뒤에는 복원 가능한 변경 전체만 적용한다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      await note(h, RUN_1, NOTE_B, "b1");
      value(await record(h, RUN_1, "RecordMail", { subject: MAIL }));
    });
    const shown = await preview(h, RUN_1);
    const mail = shown.groups.find((group) => group.owner === "fixture/mail");
    assertEquals(mail?.capability, "irreversible");
    assertEquals(mail?.reason, "external_effect");
    const before = await head(h);
    // 동의 없이는 막힌다.
    const refused = value(await apply(h, RUN_1, { shown })) as {
      result: Header;
    };
    assertEquals(refused.result.outcome, "blocked");
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals(await eventTypes(h, before), ["RevertBlocked"]);
    // blocked 뒤 새 시도: 남는 영향에 동의하면 독립적인 복원 가능 변경 전체가 적용된다.
    const agreed = value(
      await apply(h, RUN_1, {
        shown,
        id: runId("rvt", 2),
        allowPartial: true,
      }),
    ) as { result: Header };
    assertEquals(agreed.result.outcome, "applied");
    assertEquals(await noteValue(h, NOTE_A), "");
    assertEquals(await noteValue(h, NOTE_B), "");
    const applied = (await sql(
      h,
      "select payload from events where type = 'RevertApplied'",
    ))[0]!;
    const payload = JSON.parse(String(applied["payload"]));
    assertEquals(payload.partial, true);
    assertEquals(payload.allow_partial, true);
    // 복원 불가 영향은 복구했다고 하지 않고 그대로 남는다.
    const revert = (await list(h, RUN_1)).find((item) =>
      item.outcome === "applied"
    )!;
    const results = revert.changes.map((change) =>
      `${change.owner}:${change.result}`
    );
    assert(results.includes("fixture/mail:irreversible"));
    assertEquals(
      revert.changes.filter((change) => change.result === "restored").length,
      2,
    );
    assertEquals(
      revert.changes.filter((change) => change.result === "irreversible")
        .every((change) => change.restored_seqs.length === 0),
      true,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R7: 동의했어도 남는 영향에 의존하는 대상은 관계 검사에 실패해 전체가 막힌다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1", { mail: MAIL });
      await note(h, RUN_1, NOTE_B, "b1");
      value(await record(h, RUN_1, "RecordMail", { subject: MAIL }));
    });
    const done = value(await apply(h, RUN_1, { allowPartial: true })) as {
      result: Header;
    };
    assertEquals(done.result.outcome, "blocked");
    // 독립적인 B도 복원하지 않는다: 안전한 전체 묶음이 없으면 전체가 막힌다.
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals(await noteValue(h, NOTE_B), "b1");
    const [revert] = await list(h, RUN_1);
    assertEquals(
      revert.changes.filter((change) => change.capability === "reversible")
        .every((change) =>
          change.result === "unchanged" &&
          change.reason === "blocked_dependency"
        ),
      true,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R9: 복원에 필요한 준비가 없으면 owner 사전 검사가 막고 준비 결과를 실으면 적용된다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1", { needs_prepared: true });
    });
    const blocked = value(await apply(h, RUN_1)) as { result: Header };
    assertEquals(blocked.result.outcome, "blocked");
    assertEquals(await noteValue(h, NOTE_A), "a1");
    const [revert] = await list(h, RUN_1);
    assertEquals(
      revert.changes.find((change) => change.capability === "reversible")
        ?.reason,
      "blocked_not_prepared",
    );
    // 준비 결과(owner가 정의한 값)가 comparison.prepared에 실리면 같은 판정으로 적용된다.
    const applied = value(
      await apply(h, RUN_1, {
        id: runId("rvt", 2),
        prepared: { token: "prepared-note" },
      }),
    ) as { result: Header };
    assertEquals(applied.result.outcome, "applied");
    assertEquals(await noteValue(h, NOTE_A), "");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R6: 유지하는 사실과 복원 불가 영향은 복원했다고 기록하지 않고 복원 event는 소유 owner의 새 변경이다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
    });
    const originals = await sql(
      h,
      "select cast(seq as text) as seq, type, actor, run from events where run = ? order by seq",
      [RUN_1],
    );
    const before = await head(h);
    const done = value(await apply(h, RUN_1)) as { result: Header };
    assertEquals(done.result.outcome, "applied");
    // 원래 event는 그대로고, 복원은 사람(user)의 새 event다.
    assertEquals(
      await sql(
        h,
        "select cast(seq as text) as seq, type, actor, run from events where run = ? order by seq",
        [RUN_1],
      ),
      originals,
    );
    const added = await sql(
      h,
      "select type, actor, run from events where seq > ? order by seq",
      [before],
    );
    assertEquals(added.map((row) => row["type"]), [
      "NoteRestored",
      "RevertApplied",
    ]);
    for (const row of added) {
      assertEquals(row["actor"], "user");
      assertEquals(row["run"], null);
    }
    const payload = JSON.parse(String(
      (await sql(h, "select payload from events where type = 'RevertApplied'"))[
        0
      ]!["payload"],
    ));
    // 복원 불가 업무 변경이 없고 유지하는 감사 사실만 남았으므로 부분이 아니다.
    assertEquals(payload.partial, false);
    const [revert] = await list(h, RUN_1);
    for (const change of revert.changes) {
      if (change.capability === "retained") {
        assertEquals(change.result, "retained");
        assertEquals(change.restored_seqs, []);
        assertEquals(change.reason, "audit_fact");
      } else {
        assertEquals(change.result, "restored");
        assertEquals(change.restored_seqs.length, 1);
      }
    }
    // 복원 event는 compensation 표로 원래 묶음과 이어진다.
    assertEquals(
      await count(h, "select count(*) as n from revert_change_compensations"),
      1,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R8: 같은 요청은 저장된 결과를 돌려주고 한 번만 적용하며 blocked 뒤 새 시도는 새 ID로 한다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
    });
    // 사람이 본 preview는 한 번이다. 반복 요청은 같은 preview로 다시 보낸다.
    const shown = await preview(h, RUN_1);
    const first = value(await apply(h, RUN_1, { shown })) as { result: Header };
    assertEquals(first.result.replayed, false);
    assertEquals(first.result.outcome, "applied");
    const events = await count(h, "select count(*) as n from events");
    // 다른 idempotency key와 확인 handle이어도 같은 id의 같은 요청은 저장된 결과다.
    const again = value(await apply(h, RUN_1, { shown })) as {
      result: Header;
    };
    assertEquals(again.result.replayed, true);
    assertEquals(again.result.outcome, "applied");
    assertEquals(again.result.result_seq, first.result.result_seq);
    assertEquals(await count(h, "select count(*) as n from events"), events);
    // 같은 id의 다른 내용은 conflict다.
    const other = await apply(h, RUN_1, { shown, allowPartial: true });
    code(other, "conflict");
    // 이미 복원한 run은 다른 id로도 다시 복원하지 않는다.
    code(await apply(h, RUN_1, { shown, id: runId("rvt", 2) }), "conflict");
    assertEquals(await count(h, "select count(*) as n from reverts"), 1);
    assertEquals(await count(h, "select count(*) as n from events"), events);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R9: 어느 owner도 맡지 않은 event는 목록에서 빠지지 않고 복원 불가로 남아 기본으로 적용을 막는다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      value(await record(h, RUN_1, "RecordStranger", { subject: THING }));
    });
    const shown = await preview(h, RUN_1);
    const events = (await sql(
      h,
      "select cast(seq as text) as seq from events where run = ? order by seq",
      [RUN_1],
    )).map((row) => String(row["seq"]));
    const covered = shown.groups.flatMap((group) => group.source_seqs).sort((
      a,
      b,
    ) => Number(a) - Number(b));
    assertEquals(covered, events);
    const stranger = shown.groups.find((group) => group.target === THING);
    assertEquals(stranger?.capability, "irreversible");
    assertEquals(stranger?.owner, "unclassified");
    assertEquals(stranger?.reason, "unclassified_event");
    const done = value(await apply(h, RUN_1, { shown })) as { result: Header };
    assertEquals(done.result.outcome, "blocked");
    assertEquals(await noteValue(h, NOTE_A), "a1");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R3: preview는 command도 event도 만들지 않고 적용 전 분류와 적용 뒤 실제 결과를 따로 읽을 수 있다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
      value(await record(h, RUN_1, "RecordMail", { subject: MAIL }));
    });
    const before = await head(h);
    const shown = await preview(h, RUN_1);
    assertEquals(await head(h), before);
    assertEquals(await count(h, "select count(*) as n from reverts"), 0);
    assertEquals(await list(h, RUN_1), []);
    // 같은 조회는 같은 지문이다. 어느 변경도 시작하지 않았다.
    assertEquals((await preview(h, RUN_1)).binding_hash, shown.binding_hash);
    const capabilities = new Set(shown.groups.map((group) => group.capability));
    assert(capabilities.has("reversible"));
    assert(capabilities.has("irreversible"));
    // 적용 전에는 복원 가능이던 묶음이 막히면 unchanged로 남고, 불가 영향은 그대로 irreversible이다.
    value(await apply(h, RUN_1, { shown }));
    const [revert] = await list(h, RUN_1);
    const byCapability = (capability: string) =>
      revert.changes.filter((change) => change.capability === capability);
    assertEquals(byCapability("reversible").map((change) => change.result), [
      "unchanged",
    ]);
    assertEquals(byCapability("irreversible").map((change) => change.result), [
      "irreversible",
    ]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R1: 복원할 변경이 없는 run은 적용하지 않고 다른 run의 변경은 섞이지 않는다", async () => {
  const h = await open();
  try {
    await finished(h, RUN_1, 1, async () => {
      await note(h, RUN_1, NOTE_A, "a1");
    });
    await finished(h, RUN_2, 2, async () => {
      value(await record(h, RUN_2, "RecordStranger", { subject: THING }));
    });
    // run 하나의 변경만 목록에 있다.
    const first = await preview(h, RUN_1);
    assert(first.groups.every((group) => group.target !== THING));
    const second = await preview(h, RUN_2);
    assert(second.groups.every((group) => group.target !== NOTE_A));
    // run 2에는 복원할 변경이 없다(분류 안 된 영향만 있다). 동의해도 되돌릴 것이 없어 거절한다.
    code(
      await apply(h, RUN_2, { shown: second, allowPartial: true }),
      "invalid_input",
    );
    assertEquals(await count(h, "select count(*) as n from reverts"), 0);
  } finally {
    await h.close();
  }
});

const TOOL_CALL = runId("tcl", 1);
const INVOCATION = runId("inv", 1);
// 앱의 revert command 호출이 남긴 실제 Invocation이다(원래 write의 것과 다르다).
const REVERT_INVOCATION = runId("inv", 2);
const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);

// 되돌림 근거가 있는 앱 write 하나를 run의 ToolCall 기록으로 남긴다(app_command와 receipt).
async function appWrite(h: LedgerHarness, run: string) {
  const step = async (command: string, input: unknown, compare: unknown) =>
    value(
      await h.command(machine, {
        run,
        command,
        input,
        compare,
        idempotency_key: `${command}-${TOOL_CALL}`,
        prepared: [],
      }),
    );
  await step("RecordToolRequest", {
    id: TOOL_CALL,
    run,
    model_call: runId("mcl", 1),
    response_key: "call-1",
    response_order: 0,
    tool: "add_todo",
    definition_revision: "1",
    effect: "write",
    confirm: false,
    extension: null,
    input: HASH_A,
    retry_of: null,
    attempt: 0,
    app_command: {
      app: runId("app", 1),
      release: runId("rel", 1),
      command: "add_todo",
      blueprint_hash: HASH_A,
      definition_hash: HASH_B,
      permission_basis: {
        grant: runId("grt", 1),
        scope: "todos",
        basis_seq: "0",
      },
      context_binding: null,
      revert_command: "revert_todo",
    },
  }, { run_state_seq: "1", model_call_finished_seq: "1" });
  await step("DecideToolCall", {
    tool_call: TOOL_CALL,
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
  }, { state_seq: "0" });
  await step("StartToolCall", {
    tool_call: TOOL_CALL,
    started_at: new Date(RUN_NOW).toISOString(),
    approval: null,
  }, { state_seq: "1", run_state_seq: "1", assignment_revision: 1 });
  await step("FinishToolCall", {
    tool_call: TOOL_CALL,
    outcome: { kind: "success", code: "ok" },
    output: HASH_B,
    result: {
      status: "success",
      summary: "command add_todo of todo finished",
      content: {
        invocation: INVOCATION,
        revert: {
          invocation: INVOCATION,
          receipt: "change:1",
          expected_revision: "1",
        },
      },
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
    finished_at: new Date(RUN_NOW).toISOString(),
    duration_ms: 1,
  }, { state_seq: "2" });
}

// 앱 단계 하나와 ledger 묶음 하나(note)가 섞인 run을 사람이 본 판으로 적용한다. 적용은 applying으로
// 저장할 뿐 ledger 묶음을 바꾸지 않는다.
async function mixedApplying(h: LedgerHarness, run: string) {
  await finished(h, run, 1, async () => {
    await note(h, run, NOTE_A, "a1");
    await appWrite(h, run);
  });
  const shown = await preview(h, run);
  const step = shown.groups.find((group) => group.app_revert !== null)!;
  assertEquals(step.capability, "reversible");
  assertEquals(step.app_revert!.invocation, INVOCATION);
  const started = value(await apply(h, run, { shown })) as { result: Header };
  assertEquals(started.result.outcome, "applying");
  assertEquals(started.result.result_seq, null);
  assertEquals(await noteValue(h, NOTE_A), "a1");
  const revert = started.result.id;
  const items = value(
    await buildRevertInput(
      shown.groups,
      () => Promise.resolve({ ok: true as const, value: null }),
    ),
  );
  // 끝내기가 다시 받는 ledger 묶음의 복원 입력이다(앱 단계는 제외).
  const ledger = items.filter((_, index) =>
    shown.groups[index]!.capability === "reversible" &&
    shown.groups[index]!.app_revert === null
  );
  return {
    revert,
    key: step.app_revert!.step_key.replace(/^[^:]+/, revert),
    ledger,
  };
}

const finishBody = (
  revert: string,
  key: string,
  groups?: unknown[],
) => ({
  command: "FinishRevert",
  input: {
    revert,
    step_keys: [key],
    ...(groups === undefined ? {} : { groups }),
  },
  compare: {},
  idempotency_key: `finish-${revert}-${groups === undefined ? "bare" : "full"}`,
  prepared: [],
});

Deno.test("lophn-agent/revert#R11: 앱 단계가 실패하면 ledger 묶음은 복원하지 않고 앱의 실제 결과·미적용 묶음을 각각 남기며 전체를 applied로 표시하지 않는다", async () => {
  const h = await open();
  try {
    const { revert, key, ledger } = await mixedApplying(h, RUN_1);
    value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: key,
          invocation: null,
          result: "failure",
        },
        compare: {},
        idempotency_key: `ck-${revert}`,
        prepared: [],
      }),
    );
    const done = value(
      await h.command(machine, finishBody(revert, key, ledger)),
    ) as { result: Header };
    assertEquals(done.result.outcome, "partial");
    // ledger 묶음은 그대로다. 앱 단계가 끝나지 않아 시작하지 않은 것으로 남는다.
    assertEquals(await noteValue(h, NOTE_A), "a1");
    const [stored] = await list(h, RUN_1);
    assertEquals(stored.outcome, "partial");
    assertEquals(
      stored.changes.filter((change) => change.capability === "reversible")
        .map((change) => [change.owner, change.result, change.reason]),
      [
        ["fixture/notes", "unchanged", "app_not_started"],
        ["apps/invocations", "failure", "app_failed"],
      ],
    );
    assertEquals(
      await count(
        h,
        "select count(*) as n from events where type = 'RevertFinished'",
      ),
      1,
    );
    assertEquals(
      await count(
        h,
        "select count(*) as n from events where type = 'RevertApplied'",
      ),
      0,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R10: 앱 단계가 모두 복원되면 끝내기가 ledger 묶음을 준비 입력으로 복원하고 둘 다 복원돼야 applied다", async () => {
  const h = await open();
  try {
    const { revert, key, ledger } = await mixedApplying(h, RUN_1);
    // 복원했다는 기록은 revert 호출의 실제 Invocation이 있어야 한다.
    code(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: { revert, step_key: key, invocation: null, result: "restored" },
        compare: {},
        idempotency_key: `ck-none-${revert}`,
        prepared: [],
      }),
      "invalid_input",
    );
    value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: key,
          invocation: REVERT_INVOCATION,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-${revert}`,
        prepared: [],
      }),
    );
    // 단계 근거는 원래 write의 invocation을 그대로 두고 revert 호출의 invocation을 따로 남긴다.
    assertEquals(
      (await sql(
        h,
        `select json_extract(app_revert, '$.invocation') as original,
                json_extract(app_revert, '$.revert_invocation') as own
           from revert_changes where revert = ? and app_revert is not null`,
        [revert],
      )).map((row) => [row["original"], row["own"]]),
      [[INVOCATION, REVERT_INVOCATION]],
    );
    assertEquals(await noteValue(h, NOTE_A), "a1");
    const done = value(
      await h.command(machine, finishBody(revert, key, ledger)),
    ) as { result: Header };
    assertEquals(done.result.outcome, "applied");
    assertEquals(await noteValue(h, NOTE_A), "");
    const [stored] = await list(h, RUN_1);
    assertEquals(
      stored.changes.filter((change) => change.capability === "reversible")
        .map((change) => [change.owner, change.result, change.reason]),
      [
        ["fixture/notes", "restored", null],
        ["apps/invocations", "restored", null],
      ],
    );
    assertEquals(
      await count(
        h,
        "select count(*) as n from events where type = 'RevertApplied'",
      ),
      1,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R11: 앱 복원 뒤 ledger owner가 복원을 거절하면 끝내기가 취소되고 ledger 없이 끝내면 이미 성공한 앱 복원과 함께 partial로 남긴다", async () => {
  const h = await open();
  try {
    const { revert, key, ledger } = await mixedApplying(h, RUN_1);
    value(
      await h.command(machine, {
        command: "CheckpointRevert",
        input: {
          revert,
          step_key: key,
          invocation: REVERT_INVOCATION,
          result: "restored",
        },
        compare: {},
        idempotency_key: `ck-${revert}`,
        prepared: [],
      }),
    );
    // 앱 복원은 끝났고 그 사이 owner의 숨은 상태가 바뀌었다. owner가 복원을 거절하면 끝내기
    // 전체가 취소되어 어느 묶음도 바뀌지 않고 revert는 applying으로 남는다.
    value(await h.command(machine, envelope("TouchNote", { note: NOTE_A })));
    code(
      await h.command(machine, finishBody(revert, key, ledger)),
      "conflict",
    );
    assertEquals(await noteValue(h, NOTE_A), "a1");
    assertEquals((await list(h, RUN_1))[0]!.outcome, "applying");
    // 부르는 쪽은 ledger 묶음 없이 끝내 앱 결과만 확정한다: 앱 복원은 남고 ledger는 미적용이다.
    const done = value(
      await h.command(machine, finishBody(revert, key)),
    ) as { result: Header };
    assertEquals(done.result.outcome, "partial");
    assertEquals(await noteValue(h, NOTE_A), "a1");
    const [stored] = await list(h, RUN_1);
    assertEquals(
      stored.changes.filter((change) => change.capability === "reversible")
        .map((change) => [change.owner, change.result, change.reason]),
      [
        ["fixture/notes", "unchanged", "app_not_started"],
        ["apps/invocations", "restored", null],
      ],
    );
  } finally {
    await h.close();
  }
});
