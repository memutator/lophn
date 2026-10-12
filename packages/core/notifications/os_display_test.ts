import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openConnection } from "../storage/ledger/mod.ts";
import { notificationView } from "./model.ts";
import {
  createOsDeliveryObservations,
  OS_DELIVERY_FAILURE_REASONS,
  osDisplayRequest,
} from "./os-display.ts";
import { NOTIFICATIONS_SCHEMA_STEPS } from "./schema.ts";

const NOW = Date.parse("2026-10-06T00:00:00.000Z");
const NOW_TEXT = "2026-10-06T00:00:00.000Z";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const NTF = "ntf_01arz3ndektsv4rrffq69g5fav";

function questionView() {
  return notificationView(
    { id: NTF, source_seq: "1", read_at: null },
    "QuestionCreated",
    QUESTION,
    {
      session: "ses_01arz3ndektsv4rrffq69g5fav",
      // 이런 값은 notification 어디에도 복사되지 않는다. OS 요청에도 없어야 한다.
      answer: "sk-live-0123456789abcdef0123456789abcdef",
      input: "내 계좌 비밀번호는 1234",
      error: "ENOENT: /home/someone/.ssh/id_rsa",
    },
  );
}

async function ledger() {
  const dir = await Deno.makeTempDir({ prefix: "ntf-os-" });
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...NOTIFICATIONS_SCHEMA_STEPS],
    { clock: manualClock(NOW) },
  );
  assert(applied.ok, "migration");
  const opened = openConnection(path);
  assert(opened.ok, "open");
  const connection = opened.value;
  connection.sql.run(
    "insert into events (type, subject, actor, payload, at) values (?, ?, ?, ?, ?)",
    ["QuestionCreated", QUESTION, "machine", "{}", NOW_TEXT],
  );
  connection.sql.run(
    "insert into notifications (id, source_seq, read_at) values (?, 1, null)",
    [NTF],
  );
  return {
    connection,
    close: async () => {
      connection.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

function counts(connection: Awaited<ReturnType<typeof ledger>>["connection"]) {
  const events = connection.sql.get("select count(*) as n from events", []);
  const read = connection.sql.get(
    "select read_at from notifications where id = ?",
    [NTF],
  );
  return { events: events?.n, read_at: read?.read_at };
}

Deno.test("platform/notifications#R9: 사람이 켜지 않으면 OS 표시 요청을 만들지 않는다", () => {
  assertEquals(osDisplayRequest(questionView(), false), null);
});

Deno.test("platform/notifications#R9: 켠 뒤에는 최소 제목과 대상 열기만 나가고 입력·secret·원문이 빠진다", () => {
  const request = osDisplayRequest(questionView(), true);
  assert(request !== null);
  assertEquals(request, {
    notification: NTF,
    title: { kind: "QuestionCreated" },
    open: { kind: "question", id: QUESTION },
  });
  const wire = JSON.stringify(request);
  for (
    const leaked of [
      "sk-live",
      "계좌",
      "ENOENT",
      "id_rsa",
      "ses_01arz3ndektsv4rrffq69g5fav",
    ]
  ) {
    assert(!wire.includes(leaked), `${leaked}가 OS 요청에 있다`);
  }
});

Deno.test("platform/notifications#R9: 대상이 여럿인 계기도 열 곳 하나만 준다", () => {
  const view = notificationView(
    { id: NTF, source_seq: "2", read_at: null },
    "ProblemOpened",
    "prb_01arz3ndektsv4rrffq69g5fav",
    {
      app: "app_01arz3ndektsv4rrffq69g5fav",
      report: "rpt_01arz3ndektsv4rrffq69g5fav",
    },
  );
  const request = osDisplayRequest(view, true);
  assertEquals(request?.open, {
    kind: "problem",
    id: "prb_01arz3ndektsv4rrffq69g5fav",
  });
  assert(!JSON.stringify(request).includes("app_01arz3"));
  assert(!JSON.stringify(request).includes("rpt_01arz3"));
});

Deno.test("platform/notifications#R9: 열 곳을 모르는 계기는 대상 없이 제목만 나간다", () => {
  const view = {
    notification: { id: NTF, source_seq: "3", read_at: null },
    title: { kind: "QuestionCreated" },
    target: { kind: "unknown-kind", other: "x" },
  };
  assertEquals(osDisplayRequest(view, true), {
    notification: NTF,
    title: { kind: "QuestionCreated" },
    open: null,
  });
});

Deno.test("platform/notifications#R10: 표시 실패는 다음 조회에서 고정 안전 이유와 관측 시각으로 보인다", () => {
  const observations = createOsDeliveryObservations(manualClock(NOW));
  const recorded = observations.recordFailure(NTF, "show_failed");
  assert(recorded.ok);
  assertEquals(recorded.value.observed_at, NOW_TEXT);
  const first = observations.lookup(NTF, true);
  assertEquals(first, {
    state: "failed",
    reason: "show_failed",
    observed_at: NOW_TEXT,
  });
  // 조회는 읽기만 한다. 같은 답이 반복되고 다시 보내는 일이 없다.
  assertEquals(observations.lookup(NTF, true), first);
  assertEquals(observations.lookup("ntf_other", true), {
    state: "unconfirmed",
  });
});

Deno.test("platform/notifications#R10: OS 원문 오류나 모르는 이유는 기억하지 않는다", () => {
  const observations = createOsDeliveryObservations(manualClock(NOW));
  for (
    const reason of [
      "Error: spawn notify-send ENOENT /home/someone/bin",
      "",
      null,
      { kind: "show_failed" },
    ]
  ) {
    const recorded = observations.recordFailure(NTF, reason);
    assert(!recorded.ok);
    assertEquals(recorded.error.code, "invalid_input");
  }
  assertEquals(observations.lookup(NTF, true), { state: "unconfirmed" });
  for (const reason of OS_DELIVERY_FAILURE_REASONS) {
    assert(observations.recordFailure(NTF, reason).ok);
  }
});

Deno.test("platform/notifications#R10: 재시작 뒤나 관측이 없으면 성공으로 채우지 않고, 켜지 않았으면 요청 안 함이다", () => {
  const before = createOsDeliveryObservations(manualClock(NOW));
  assert(before.recordFailure(NTF, "unsupported").ok);
  // 재시작은 새 메모리다. 이전 결과를 확인할 수 없다.
  const after = createOsDeliveryObservations(manualClock(NOW));
  assertEquals(after.lookup(NTF, true), { state: "unconfirmed" });
  assertEquals(after.lookup(NTF, false), { state: "not_requested" });
  assertEquals(before.lookup(NTF, false), { state: "not_requested" });
  for (const state of [after.lookup(NTF, true), after.lookup(NTF, false)]) {
    assert(!JSON.stringify(state).includes("deliver"));
  }
});

Deno.test("platform/notifications#R10: 메모리 상한을 넘으면 오래된 관측부터 잊고 확인 불가가 된다", () => {
  const observations = createOsDeliveryObservations(manualClock(NOW), 2);
  assert(observations.recordFailure("ntf_a", "show_failed").ok);
  assert(observations.recordFailure("ntf_b", "show_failed").ok);
  assert(observations.recordFailure("ntf_c", "unsupported").ok);
  assertEquals(observations.lookup("ntf_a", true), { state: "unconfirmed" });
  assertEquals(observations.lookup("ntf_b", true).state, "failed");
  assertEquals(observations.lookup("ntf_c", true).state, "failed");
});

Deno.test("platform/notifications#R10: 표시 실패 뒤에도 notification은 그대로이고 ledger에 배달 상태·event가 늘지 않는다", async () => {
  const fixture = await ledger();
  try {
    const { connection } = fixture;
    const before = counts(connection);
    const columns = connection.sql.all(
      "select name from pragma_table_info('notifications') order by cid",
      [],
    ).map((row) => String(row["name"]));
    const observations = createOsDeliveryObservations(manualClock(NOW));
    assert(observations.recordFailure(NTF, "show_failed").ok);
    // 다음 조회는 같은 notification을 근거와 함께 그대로 읽는다.
    const row = connection.sql.get(
      "select id, cast(source_seq as text) as source_seq, read_at from notifications where id = ?",
      [NTF],
    );
    assertEquals(
      [row?.id, row?.source_seq, row?.read_at],
      [NTF, "1", null],
    );
    assertEquals(observations.lookup(NTF, true).state, "failed");
    assertEquals(counts(connection), before);
    assertEquals(columns, ["id", "source_seq", "read_at"]);
    const tables = connection.sql.all(
      "select name from sqlite_master where type = 'table' and (name like '%deliver%' or name like '%retry%')",
      [],
    );
    assertEquals(tables.length, 0);
  } finally {
    await fixture.close();
  }
});

Deno.test("platform/notifications#R12: 자동 표시 요청은 이동·읽음을 만들지 않고 열 곳을 가리키기만 한다", async () => {
  const fixture = await ledger();
  try {
    const { connection } = fixture;
    const before = counts(connection);
    const request = osDisplayRequest(questionView(), true);
    assert(request !== null);
    // 요청에는 focus·문서·앱을 바꾸라는 필드가 없다. 대상 열기는 사람이 Open을 골랐을 때
    // shell이 쓰는 참조일 뿐이다.
    assertEquals(Object.keys(request).sort(), [
      "notification",
      "open",
      "title",
    ]);
    assertEquals(Object.keys(request.open ?? {}).sort(), ["id", "kind"]);
    // 표시는 읽음·결정·새 event가 아니다.
    assertEquals(counts(connection), before);
  } finally {
    await fixture.close();
  }
});
