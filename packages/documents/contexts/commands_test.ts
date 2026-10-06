import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { type ContextCommandDeps, createContextCommands } from "./commands.ts";
import { contextFixture, ids, keep, userContext } from "./testing/mod.ts";

// apps blueprint read가 들어오기 전 test double. read command만 허용한다.
const readCommands: ContextCommandDeps = {
  appCommand: (app, command) => app === ids.app && command === "read_notes",
};

const commands = createContextCommands(readCommands);

function item(
  document: string,
  section: string | null,
  perspective: "basis" | "reference" | "watch",
  reason = "판단 근거",
): TestItem {
  return {
    target: section === null
      ? { kind: "document" as const, document, section: null }
      : { kind: "document" as const, document, section },
    perspective,
    reason,
  };
}

function appItem(
  perspective: "basis" | "reference" | "watch" = "reference",
): TestItem {
  return {
    target: {
      kind: "app_command" as const,
      app: ids.app,
      command: "read_notes",
    },
    perspective,
    reason: "앱 자료",
  };
}

type TestItem = {
  target:
    | { kind: "document"; document: string; section: string | null }
    | { kind: "app_command"; app: string; command: string };
  perspective: "basis" | "reference" | "watch";
  reason: string;
};

// event 출력의 document 가지 target. app_command 가지와 구별해서 본다.
function documentTarget(target: unknown) {
  return target as {
    kind: "document";
    document: string;
    section: string | null;
  };
}

function create(
  fixture: ReturnType<typeof contextFixture>,
  id = ids.context,
  items: readonly TestItem[] = [],
  actor = userContext(),
) {
  return fixture.transaction((tx) =>
    commands.create.handle(
      tx,
      actor,
      { id, title: "Notes", purpose: "기준 자료", items } as never,
      {},
    )
  );
}

Deno.test("documents/contexts#R1: 항목은 관점과 이유를 남기고 생성 출력에 그대로 보인다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const result = keep(
      create(fixture, ids.context, [
        item(ids.doc, null, "basis"),
        item(ids.doc, "요약", "watch", "변화 확인"),
        appItem("reference"),
      ]),
    );
    assertEquals(result.id, ids.context);
    assertEquals(result.status, "active");
    assertEquals(result.items.length, 3);
    assertEquals(result.items[0].perspective, "basis");
    assertEquals(documentTarget(result.items[0].target).section, null);
    assertEquals(result.items[1].perspective, "watch");
    assertEquals(result.items[1].target, {
      kind: "document",
      document: ids.doc,
      section: "요약",
    });
    assertEquals(result.items[2].reason, "앱 자료");
    assertEquals(fixture.emitted[0].type, "ContextCreated");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R2: 문서 전체·section·앱 read command는 대상이고 미추적 문서·write command는 거절한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    // 문서 전체와 section, 앱 read command는 받는다.
    keep(create(fixture, ids.context, [
      item(ids.doc, null, "basis"),
      item(ids.doc, "요약", "watch"),
      appItem(),
    ]));
    // 저장 판이 없는 문서는 invalid_input이다.
    const missing = create(fixture, ids.context2, [
      item(ids.doc, null, "basis"),
    ]);
    // 같은 context는 이미 있으므로 다른 context id로 문서 없음을 본다.
    // (create 후 같은 id는 conflict이므로 새 context로 미추적 문서를 본다.)
    const third = "ctx_01arz3ndektsv4rrffq69g5fb0";
    const untracked = fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: third,
          title: "Notes",
          purpose: "기준 자료",
          items: [
            item("doc_01zzzzzzzzzzzzzzzzzzzzzzzz", null, "basis"),
          ],
        } as never,
        {},
      )
    );
    assert(!untracked.ok);
    assertEquals(untracked.error.code, "invalid_input");
    // 앱 write command도 test double이 false를 내면 invalid_input이다.
    const write = createContextCommands({
      appCommand: () => false,
    });
    const denied = fixture.transaction((tx) =>
      write.create.handle(
        tx,
        userContext(),
        {
          id: "ctx_01arz3ndektsv4rrffq69g5fb1",
          title: "Notes",
          purpose: "기준 자료",
          items: [appItem()],
        } as never,
        {},
      )
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "invalid_input");
    // double이 없으면 fail-closed다.
    const closed = createContextCommands({});
    const closedResult = fixture.transaction((tx) =>
      closed.create.handle(
        tx,
        userContext(),
        {
          id: "ctx_01arz3ndektsv4rrffq69g5fb2",
          title: "Notes",
          purpose: "기준 자료",
          items: [appItem()],
        } as never,
        {},
      )
    );
    assert(!closedResult.ok);
    assertEquals(closedResult.error.code, "invalid_input");
    void missing;
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R3: 같은 문서를 두 context의 다른 관점으로 넣고 전체와 section은 별개 대상으로 다룬다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    keep(create(fixture, ids.context, [item(ids.doc, null, "basis")]));
    keep(create(fixture, ids.context2, [item(ids.doc, null, "reference")]));
    // 한 context 안에서 전체와 section은 별개 target(다른 position)이다.
    const setSection = keep(
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            item: {
              target: { kind: "document", document: ids.doc, section: "요약" },
              perspective: "watch",
              reason: "변화 확인",
            },
          } as never,
          { base_revision: "1" },
        )
      ),
    );
    assertEquals(setSection.items.length, 2);
    const whole = setSection.items.find((entry) =>
      documentTarget(entry.target).section === null
    );
    const section = setSection.items.find((entry) =>
      documentTarget(entry.target).section !== null
    );
    assert(whole !== undefined && section !== undefined);
    assertEquals(whole.perspective, "basis");
    assertEquals(section.perspective, "watch");
    // 같은 context에서 전체를 watch로 바꿔도 section은 그대로다.
    const flip = keep(
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            item: {
              target: { kind: "document", document: ids.doc, section: null },
              perspective: "watch",
              reason: "전체 변화",
            },
          } as never,
          { base_revision: setSection.revision },
        )
      ),
    );
    assertEquals(flip.items.length, 2);
    const sameSection = flip.items.find((entry) =>
      documentTarget(entry.target).section === "요약"
    );
    assertEquals(sameSection?.perspective, "watch");
    assertEquals(
      flip.items.find((entry) => documentTarget(entry.target).section === null)
        ?.perspective,
      "watch",
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R5: 항목 추가·변경·제거도 revision을 마지막 구성 변경으로 옮겨 같은 기준의 다른 변경은 conflict다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "basis")]),
    );
    const setItem = (item: unknown, base: string) =>
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          { context: ids.context, item } as never,
          { base_revision: base },
        )
      );
    const added = keep(setItem(appItem(), created.revision));
    assert(added.revision !== created.revision);
    // 낡은 기준으로 같은 항목을 다시 바꾸려는 변경은 기존 변경을 덮지 않는다.
    const stale = setItem(appItem(), created.revision);
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const changed = keep(
      setItem({ ...appItem(), reason: "다른 이유" }, added.revision),
    );
    assert(changed.revision !== added.revision);
    const removed = keep(
      fixture.transaction((tx) =>
        commands.removeItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            target: {
              kind: "app_command",
              app: ids.app,
              command: "read_notes",
            },
          } as never,
          { base_revision: changed.revision },
        )
      ),
    );
    assert(removed.revision !== changed.revision);
    const staleRemove = fixture.transaction((tx) =>
      commands.removeItem.handle(
        tx,
        userContext(),
        {
          context: ids.context,
          target: { kind: "document", document: ids.doc, section: null },
        } as never,
        { base_revision: changed.revision },
      )
    );
    assert(!staleRemove.ok);
    assertEquals(staleRemove.error.code, "conflict");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R5: 생성·변경·항목 추가·제거·보관·해제가 개별 동작으로 적용되고 충돌은 기존 변경을 덮지 않는다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "basis")]),
    );
    // 제목 변경
    const renamed = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { context: ids.context, title: "판단 기준" } as never,
          { base_revision: created.revision },
        )
      ),
    );
    assertEquals(renamed.title, "판단 기준");
    assertEquals(fixture.emitted.at(-1)?.type, "ContextUpdated");
    // 목적 변경 (base_revision 이전이면 conflict)
    const stale = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        userContext(),
        { context: ids.context, purpose: "옛 목적" } as never,
        { base_revision: created.revision },
      )
    );
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    const repurposed = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { context: ids.context, purpose: "새 목적" } as never,
          { base_revision: renamed.revision },
        )
      ),
    );
    assertEquals(repurposed.purpose, "새 목적");
    // 항목 추가(이유·관점 변경도 set_item으로)
    const added = keep(
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            item: appItem(),
          } as never,
          { base_revision: repurposed.revision },
        )
      ),
    );
    assertEquals(added.items.length, 2);
    // 항목 제거
    const removed = keep(
      fixture.transaction((tx) =>
        commands.removeItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            target: {
              kind: "app_command",
              app: ids.app,
              command: "read_notes",
            },
          } as never,
          { base_revision: added.revision },
        )
      ),
    );
    assertEquals(removed.items.length, 1);
    assertEquals(fixture.emitted.at(-1)?.type, "ContextItemRemoved");
    // 보관과 해제
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: removed.revision },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    assertEquals(fixture.emitted.at(-1)?.type, "ContextArchived");
    const unarchived = keep(
      fixture.transaction((tx) =>
        commands.unarchive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: archived.revision },
        )
      ),
    );
    assertEquals(unarchived.status, "active");
    assertEquals(fixture.emitted.at(-1)?.type, "ContextUnarchived");
    // agent는 run과 함께 편집한다.
    const agent = userContext(
      `agent:${ids.run.replace("run_", "asg_")}`,
      ids.run,
    );
    const agentEdit = keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          agent,
          { context: ids.context, title: "agent 제목" } as never,
          { base_revision: unarchived.revision },
        )
      ),
    );
    assertEquals(agentEdit.title, "agent 제목");
    const bareAgent = userContext(`agent:${ids.run.replace("run_", "asg_")}`);
    const bare = fixture.transaction((tx) =>
      commands.update.handle(
        tx,
        bareAgent,
        { context: ids.context, title: "제안 없음" } as never,
        { base_revision: agentEdit.revision },
      )
    );
    assert(!bare.ok);
    assertEquals(bare.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R6: coding agent의 직접 구성 변경은 forbidden이다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    keep(create(fixture, ids.context, [item(ids.doc, null, "basis")]));
    const codingAgent = userContext("cac_01arz3ndektsv4rrffq69g5fav");
    const denied = fixture.transaction((tx) =>
      commands.setItem.handle(
        tx,
        codingAgent,
        {
          context: ids.context,
          item: item(ids.doc, "요약", "watch"),
        } as never,
        { base_revision: "1" },
      )
    );
    assert(!denied.ok);
    assertEquals(denied.error.code, "forbidden");
    // 구성은 바뀌지 않았다.
    const count = fixture.sql.get(
      "SELECT COUNT(*) AS count FROM context_items WHERE context = ?",
      [ids.context],
    );
    assertEquals(count?.["count"], 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R7: 항목 제거·보관은 문서·판을 바꾸지 않는다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    keep(create(fixture, ids.context, [
      item(ids.doc, null, "basis"),
      appItem(),
    ]));
    const documentBefore = fixture.sql.get(
      "SELECT * FROM documents WHERE id = ?",
      [ids.doc],
    );
    const removed = keep(
      fixture.transaction((tx) =>
        commands.removeItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            target: {
              kind: "app_command",
              app: ids.app,
              command: "read_notes",
            },
          } as never,
          { base_revision: "1" },
        )
      ),
    );
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: removed.revision },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    // 대상 문서 행은 그대로다.
    const documentAfter = fixture.sql.get(
      "SELECT * FROM documents WHERE id = ?",
      [ids.doc],
    );
    assertEquals(documentAfter, documentBefore);
    // 항목 제거·보관을 지우는 길은 trigger가 막는다.
    assertThrowsAbort(() =>
      fixture.sql.run("DELETE FROM contexts WHERE id = ?", [ids.context])
    );
    assertThrowsAbort(() =>
      fixture.sql.run("UPDATE contexts SET id = ? WHERE id = ?", [
        ids.context2,
        ids.context,
      ])
    );
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R8: 역조회는 항목이 직접 든 context에서 계산되고 project 문서도 항목으로 들어간다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    // project 문서(source_kind project_file)도 저장 판이 있으면 대상이다.
    fixture.sql.run(
      `INSERT INTO documents
         (id, place_kind, place_id, name, title, source_kind,
          source_instruction_target, source_project, source_path,
          latest_version, revision, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "doc_01arz3ndektsv4rrffq69g5fb0",
        null,
        null,
        null,
        "Project notes",
        "project_file",
        null,
        "prj_01arz3ndektsv4rrffq69g5fav",
        "/work/notes/a.md",
        `ver_${"0".repeat(26)}`,
        "1",
        "active",
      ],
    );
    keep(create(fixture, ids.context, [item(ids.doc, null, "basis")]));
    keep(create(fixture, ids.context2, [
      item("doc_01arz3ndektsv4rrffq69g5fb0", null, "reference"),
      appItem(),
    ]));
    // target_key에서 관련 context를 계산한다.
    const whole = fixture.sql.all(
      "SELECT context FROM context_items WHERE document = ?",
      [ids.doc],
    );
    assertEquals(whole.map((row) => row["context"]), [ids.context]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R15: context는 자료 묶음이며 assignment를 만들거나 바꾸는 표면이 없다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    // 같은 project의 Operator 둘이 다른 context를 고른다: context.Create는
    // assignment를 만들지 않고, context 표에는 Operator·assignment 열이 없다.
    keep(create(fixture, ids.context, [item(ids.doc, null, "basis")]));
    keep(create(fixture, ids.context2, [item(ids.doc, null, "reference")]));
    const columns = fixture.sql.all("PRAGMA table_info(contexts)", []);
    const names = columns.map((row) => row["name"]);
    assert(!names.includes("assignment"));
    assert(!names.includes("operator"));
    assert(!names.includes("project"));
    // command 표면에도 assignment·run 시작이 없다.
    const names2 = Object.keys(commands);
    assert(!names2.includes("assign"));
    assert(!names2.includes("startRun"));
    // 보관해도 대상 문서는 그대로다.
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(
          tx,
          userContext(),
          { context: ids.context },
          { base_revision: "1" },
        )
      ),
    );
    assertEquals(archived.status, "archived");
    const row = fixture.sql.get("SELECT status FROM documents WHERE id = ?", [
      ids.doc,
    ]);
    assertEquals(row?.["status"], "active");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R2: 범위 밖 문서 항목은 없는 문서와 똑같이 거절한다", () => {
  const fixture = contextFixture((_ctx, _operation, target) => {
    const document = (target as { document?: string }).document;
    return document === ids.doc
      ? err({ code: "forbidden", message: "대상이 범위 밖이다" })
      : { ok: true as const, value: undefined };
  });
  try {
    fixture.seedDocument(ids.doc);
    const result = fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context,
          title: "Notes",
          purpose: "기준 자료",
          items: [item(ids.doc, null, "basis")],
        } as never,
        {},
      )
    );
    // forbidden을 invalid_input으로 바꾼다. 문서의 존재를 새지 않는다.
    assert(!result.ok);
    assertEquals(result.error.code, "invalid_input");
    assertEquals(result.error.message, "context item needs a stored document");
    const count = fixture.sql.get("SELECT COUNT(*) AS count FROM contexts", []);
    assertEquals(count?.["count"], 0);
    // 대상 문서 행이 있어도 같은 답이다(없는 문서와 똑같다).
    const untracked = fixture.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          id: ids.context,
          title: "Notes",
          purpose: "기준 자료",
          items: [item("doc_01zzzzzzzzzzzzzzzzzzzzzzzz", null, "basis")],
        } as never,
        {},
      )
    );
    assert(!untracked.ok);
    assertEquals(untracked.error.code, "invalid_input");
    assertEquals(
      untracked.error.message,
      "context item needs a stored document",
    );
  } finally {
    fixture.close();
  }
});

function assertThrowsAbort(run: () => unknown) {
  let thrown = false;
  try {
    run();
  } catch {
    thrown = true;
  }
  assert(thrown);
}

// ---- context.record_watch_change (documents#T24) ----

const VER_1 = "ver_01arz3ndektsv4rrffq69g5fav";
const VER_2 = "ver_01arz3ndektsv4rrffq69g5fb0";
const HASH_1 = "a".repeat(64);
const HASH_2 = "b".repeat(64);
const machine = userContext("machine");

type Fixture = ReturnType<typeof contextFixture>;

// 저장 event를 ledger에 남긴다. command는 이 event의 전후 판과 같은 비교만 받는다.
function save(
  fixture: Fixture,
  version = VER_2,
  previous: string | null = VER_1,
) {
  return fixture.recordEvent("DocumentSaved", ids.doc, {
    version,
    previous_version: previous,
    content_hash: HASH_2,
    format: { name: "document", module_hash: HASH_1 },
    source: null,
  });
}

function comparison(
  sourceSeq: string,
  revision: string,
  over: Record<string, unknown> = {},
) {
  return {
    context: ids.context,
    context_revision: revision,
    target: { kind: "document", document: ids.doc, section: null },
    source_seq: sourceSeq,
    before_version: VER_1,
    after_version: VER_2,
    result: "content_changed",
    before_hash: HASH_1,
    after_hash: HASH_2,
    module_hashes: { before: HASH_1, after: HASH_1 },
    unverified_reason: null,
    ...over,
  };
}

function record(
  fixture: Fixture,
  input: ReturnType<typeof comparison>,
  actor = machine,
) {
  return fixture.transaction((tx) =>
    commands.recordWatchChange.handle(tx, actor, input as never, {
      base_revision: input.context_revision,
    })
  );
}

function changedEvents(fixture: Fixture) {
  return fixture.emitted.filter((event) =>
    event.type === "ContextWatchedItemChanged"
  );
}

function changeCount(fixture: Fixture): unknown {
  return fixture.sql.get(
    "SELECT COUNT(*) AS count FROM context_watch_changes",
    [],
  )
    ?.["count"];
}

Deno.test("documents/contexts#R10: 확인된 변화는 전후 고정 판과 대상을 담은 event 하나와 기록 하나를 남기고 revision은 그대로다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, "요약", "watch")]),
    );
    const sourceSeq = save(fixture);
    const result = keep(record(
      fixture,
      comparison(sourceSeq, created.revision, {
        target: { kind: "document", document: ids.doc, section: "요약" },
        result: "section_missing",
        after_hash: null,
      }),
    ));
    // 기록은 구성 변경이 아니다.
    assertEquals(result, {
      id: ids.context,
      revision: created.revision,
      status: "active",
    });
    const events = changedEvents(fixture);
    assertEquals(events.length, 1);
    assertEquals(events[0].subject, ids.context);
    assertEquals(events[0].payload, {
      target: { kind: "document", document: ids.doc, section: "요약" },
      before_version: VER_1,
      after_version: VER_2,
      source_seq: sourceSeq,
      change_kind: "section_missing",
    });
    assertEquals(changeCount(fixture), 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R11: 같음·미확인 비교는 event도 기록도 만들지 않는다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    const sourceSeq = save(fixture);
    const same = record(
      fixture,
      comparison(sourceSeq, created.revision, {
        result: "unchanged",
        after_hash: HASH_1,
      }),
    );
    assert(!same.ok);
    assertEquals(same.error.code, "invalid_input");
    const unknown = record(
      fixture,
      comparison(sourceSeq, created.revision, {
        result: "unverified",
        before_hash: null,
        after_hash: null,
        unverified_reason: "after version: extraction failed",
      }),
    );
    assert(!unknown.ok);
    assertEquals(unknown.error.code, "invalid_input");
    assertEquals(changedEvents(fixture).length, 0);
    assertEquals(changeCount(fixture), 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R12: 같은 context·항목·새 판의 재전달은 event 하나만 남긴다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    const sourceSeq = save(fixture);
    const input = comparison(sourceSeq, created.revision);
    keep(record(fixture, input));
    // 같은 결과를 다시 받는다(응답이 늦거나 잃은 재시도).
    const again = keep(record(fixture, input));
    assertEquals(again.id, ids.context);
    assertEquals(changedEvents(fixture).length, 1);
    assertEquals(changeCount(fixture), 1);
    // 그 뒤 구성이 바뀌어도(보관) 이미 남은 기록의 재전달은 같은 결과다.
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { context: ids.context }, {
          base_revision: created.revision,
        })
      ),
    );
    const late = keep(record(
      fixture,
      comparison(sourceSeq, archived.revision),
    ));
    assertEquals(late.status, "archived");
    assertEquals(changedEvents(fixture).length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R12: 비교 중 관점·대상을 바꾸거나 보관하거나 저장 뒤에 추가한 항목의 결과는 거절한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [
        item(ids.doc, null, "watch"),
        item(ids.doc, "요약", "watch"),
      ]),
    );
    const sourceSeq = save(fixture);
    // 비교하는 동안 문서 전체 항목의 관점을 기준으로 바꿨다.
    const changed = keep(
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            item: item(ids.doc, null, "basis"),
          } as never,
          { base_revision: created.revision },
        )
      ),
    );
    const stale = record(fixture, comparison(sourceSeq, changed.revision));
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    // 바뀌지 않은 section 항목은 같은 시점의 결과를 받는다.
    keep(record(
      fixture,
      comparison(sourceSeq, changed.revision, {
        target: { kind: "document", document: ids.doc, section: "요약" },
      }),
    ));
    // 저장 뒤에 추가한 항목은 과거 변화의 대상이 아니다.
    const added = keep(
      fixture.transaction((tx) =>
        commands.setItem.handle(
          tx,
          userContext(),
          {
            context: ids.context,
            item: item(ids.doc, "위험", "watch"),
          } as never,
          { base_revision: changed.revision },
        )
      ),
    );
    const late = record(
      fixture,
      comparison(sourceSeq, added.revision, {
        target: { kind: "document", document: ids.doc, section: "위험" },
      }),
    );
    assert(!late.ok);
    assertEquals(late.error.code, "conflict");
    // 보관한 context의 변화는 기록하지 않는다(contexts#R7).
    const archived = keep(
      fixture.transaction((tx) =>
        commands.archive.handle(tx, userContext(), { context: ids.context }, {
          base_revision: added.revision,
        })
      ),
    );
    const next = "ver_01arz3ndektsv4rrffq69g5fb1";
    const afterArchive = save(fixture, next, VER_2);
    const inactive = record(
      fixture,
      comparison(afterArchive, archived.revision, {
        before_version: VER_2,
        after_version: next,
        target: { kind: "document", document: ids.doc, section: "요약" },
      }),
    );
    assert(!inactive.ok);
    assertEquals(inactive.error.code, "conflict");
    assertEquals(changedEvents(fixture).length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R12: context revision이 낡았거나 입력의 revision과 다르면 거절한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    const sourceSeq = save(fixture);
    // 비교하는 동안 제목이 바뀌어 revision이 앞섰다.
    keep(
      fixture.transaction((tx) =>
        commands.update.handle(
          tx,
          userContext(),
          { context: ids.context, title: "Renamed" },
          { base_revision: created.revision },
        )
      ),
    );
    const stale = record(fixture, comparison(sourceSeq, created.revision));
    assert(!stale.ok);
    assertEquals(stale.error.code, "conflict");
    // 입력의 비교 기준과 base_revision이 다르면 모양이 틀린 제출이다.
    const mismatch = fixture.transaction((tx) =>
      commands.recordWatchChange.handle(
        tx,
        machine,
        comparison(sourceSeq, created.revision) as never,
        { base_revision: "3" },
      )
    );
    assert(!mismatch.ok);
    assertEquals(mismatch.error.code, "invalid_input");
    assertEquals(changedEvents(fixture).length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R10: 기록은 machine만 하고 원래 저장 event와 전후 판이 다른 제출은 거절한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    const sourceSeq = save(fixture);
    for (const actor of ["user", "agent:run"]) {
      const denied = record(
        fixture,
        comparison(sourceSeq, created.revision),
        userContext(actor, actor === "user" ? undefined : ids.run),
      );
      assert(!denied.ok);
      assertEquals(denied.error.code, "forbidden");
    }
    // 저장 event가 아닌 seq, 다른 판을 가리키는 비교는 꾸민 근거다.
    const notSaved = record(fixture, comparison("1", created.revision));
    assert(!notSaved.ok);
    assertEquals(notSaved.error.code, "invalid_input");
    const wrongVersion = record(
      fixture,
      comparison(sourceSeq, created.revision, {
        after_version: "ver_01arz3ndektsv4rrffq69g5fb2",
      }),
    );
    assert(!wrongVersion.ok);
    assertEquals(wrongVersion.error.code, "invalid_input");
    assertEquals(changedEvents(fixture).length, 0);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R13: 앱 read command 항목의 watch는 변화 기록 대상이 아니다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(create(fixture, ids.context, [appItem("watch")]));
    const sourceSeq = save(fixture);
    // 앱 target으로는 비교를 제출할 수 없고, 같은 문서 항목이 없으니 기록도 없다.
    const app = record(
      fixture,
      comparison(sourceSeq, created.revision, {
        target: { kind: "app_command", app: ids.app, command: "read_notes" },
      }),
    );
    assert(!app.ok);
    assertEquals(app.error.code, "invalid_input");
    const document = record(fixture, comparison(sourceSeq, created.revision));
    assert(!document.ok);
    assertEquals(document.error.code, "conflict");
    assertEquals(changedEvents(fixture).length, 0);
    // 앱 호출이나 다른 event도 만들지 않는다.
    assertEquals(fixture.emitted.map((event) => event.type), [
      "ContextCreated",
    ]);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R12: event가 열 개를 넘어도 구성은 seq 순서(숫자)로 재생한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    let current = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    // 관점을 왔다 갔다 바꿔 seq를 두 자리까지 올리고 마지막은 watch로 둔다.
    for (let round = 0; round < 13; round += 1) {
      const perspective = round % 2 === 0 ? "watch" : "basis";
      current = keep(
        fixture.transaction((tx) =>
          commands.setItem.handle(
            tx,
            userContext(),
            {
              context: ids.context,
              item: item(ids.doc, null, perspective),
            } as never,
            { base_revision: current.revision },
          )
        ),
      );
    }
    const sourceSeq = save(fixture);
    assertEquals(Number(sourceSeq) > 10, true);
    keep(record(fixture, comparison(sourceSeq, current.revision)));
    assertEquals(changedEvents(fixture).length, 1);
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R10: 복원이 만든 새 판의 변화도 저장과 같은 전후 판 비교로 한 번 기록한다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const created = keep(
      create(fixture, ids.context, [item(ids.doc, null, "watch")]),
    );
    // VER_1을 복원해 새 최신 판(VER_2)이 생겼다. 비교 기준은 event 이름이 아니라 전후 판이다.
    const restoredSeq = fixture.recordEvent("DocumentRestored", ids.doc, {
      restore_version: VER_1,
      previous_version: VER_1,
      version: VER_2,
    });
    const input = comparison(restoredSeq, created.revision);
    keep(record(fixture, input));
    keep(record(fixture, input));
    const events = changedEvents(fixture);
    assertEquals(events.length, 1);
    assertEquals(
      (events[0].payload as { source_seq: string }).source_seq,
      restoredSeq,
    );
    // 복원 event의 판과 다른 비교는 거절한다.
    const wrong = record(
      fixture,
      comparison(restoredSeq, created.revision, {
        after_version: "ver_01arz3ndektsv4rrffq69g5fb2",
      }),
    );
    assert(!wrong.ok);
    assertEquals(wrong.error.code, "invalid_input");
  } finally {
    fixture.close();
  }
});

Deno.test("documents/contexts#R12: 없는 context는 not_found다", () => {
  const fixture = contextFixture();
  try {
    fixture.seedDocument(ids.doc);
    const sourceSeq = save(fixture);
    const missing = record(fixture, comparison(sourceSeq, "1"));
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
  } finally {
    fixture.close();
  }
});
